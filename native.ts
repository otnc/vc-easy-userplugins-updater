/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile as cpExecFile, ExecFileOptions } from "child_process";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { homedir } from "os";
import { basename, dirname, join, relative, sep } from "path";
import { promisify } from "util";

import type { CommandResult, CommitInfo, IpcEvent, PullMode, RepoInfo, ResolvedTool, ToolName, Tools } from "./types";

const execFile = promisify(cpExecFile);

// The main bundle lives at <vencord>/dist/patcher.js, so its parent is the repo root.
// This is the same assumption Vencord's own updater (src/main/updater/git.ts) makes.
const VENCORD_SRC_DIR = join(__dirname, "..");
const USERPLUGINS_DIR = join(VENCORD_SRC_DIR, "src", "userplugins");

const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;
const isWindows = process.platform === "win32";

if (process.platform === "darwin") process.env.PATH = `/usr/local/bin:${process.env.PATH}`;

// pnpm install / build produce a lot of output, the 1MB default is not enough
const BASE_OPTS: ExecFileOptions = { maxBuffer: 64 * 1024 * 1024 };

/** Folders that can never be a userplugin repository. */
const IGNORED_DIRS = new Set(["node_modules", ".git", ".github", ".vscode", "dist"]);

/** Characters that must never reach a shell. Used to vet configured command paths. */
const UNSAFE_SHELL_CHARS = /["&|;<>^`$()\n\r]/;

function toStr(value: unknown) {
  return value == null ? "" : String(value);
}

async function tryRun(file: string, args: string[], opts: ExecFileOptions = {}): Promise<CommandResult> {
  const options = { ...BASE_OPTS, ...opts };

  try {
    const { stdout, stderr } = isFlatpak
      ? await execFile("flatpak-spawn", ["--host", file, ...args], options)
      : await execFile(file, args, options);

    return { ok: true, stdout: toStr(stdout), stderr: toStr(stderr) };
  } catch (e: any) {
    return {
      ok: false,
      stdout: toStr(e?.stdout),
      stderr: toStr(e?.stderr) || toStr(e?.message) || String(e)
    };
  }
}

// #region tool discovery

/*
 * Discord is started from Explorer or a shortcut, so it only inherits the persistent machine/user PATH. Version managers that inject their shims from a shell hook - fnm, mise, asdf, nvm.sh, and corepack shims that live inside a managed node install - are invisible to it even though they work perfectly in a terminal. nvm-windows happened to work only because it maintains a symlink at a fixed location that is on the real PATH.
 *
 * So: try PATH, but do not trust it. Fall back to the well-known install locations, and finally to `fnm exec`, since fnm's own binary usually is on PATH even when the node it manages is not.
 */

const HOME = homedir();
const { APPDATA, LOCALAPPDATA, FNM_DIR, VOLTA_HOME, ProgramFiles } = process.env;

const exeName = (name: string) => (isWindows ? `${name}.exe` : name);

/** Where fnm keeps the binaries of the version aliased to `default`. */
function fnmDefaultBinDirs() {
  const roots: string[] = [];

  if (FNM_DIR) roots.push(FNM_DIR);
  if (isWindows) {
    if (APPDATA) roots.push(join(APPDATA, "fnm"));
    if (LOCALAPPDATA) roots.push(join(LOCALAPPDATA, "fnm"));
  } else {
    roots.push(join(HOME, ".fnm"), join(HOME, ".local", "share", "fnm"));
  }

  // Windows installs put the binaries straight into the install dir, unix uses bin/
  return roots.map(root => isWindows
    ? join(root, "aliases", "default")
    : join(root, "aliases", "default", "bin"));
}

function nodeCandidates() {
  const out = fnmDefaultBinDirs().map(dir => join(dir, exeName("node")));

  if (isWindows) {
    if (VOLTA_HOME) out.push(join(VOLTA_HOME, "bin", "node.exe"));
    if (LOCALAPPDATA) out.push(join(LOCALAPPDATA, "Volta", "bin", "node.exe"));
    // where both nvm-windows' symlink and the official installer put node
    if (ProgramFiles) out.push(join(ProgramFiles, "nodejs", "node.exe"));
  } else {
    out.push(
      join(HOME, ".volta", "bin", "node"),
      join(HOME, ".local", "share", "mise", "shims", "node"),
      join(HOME, ".asdf", "shims", "node"),
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/bin/node"
    );
  }

  return out;
}

function pnpmCandidates(nodeDir: string | null) {
  const out: string[] = [];

  // corepack drops its shims right next to the node binary it belongs to
  if (nodeDir) out.push(join(nodeDir, isWindows ? "pnpm.cmd" : "pnpm"));

  if (isWindows) {
    if (LOCALAPPDATA) out.push(join(LOCALAPPDATA, "pnpm", "pnpm.exe"));
  } else {
    out.push(
      join(HOME, ".local", "share", "pnpm", "pnpm"),
      "/usr/local/bin/pnpm",
      "/opt/homebrew/bin/pnpm"
    );
  }

  return out;
}

function gitCandidates() {
  if (!isWindows) return ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

  const roots = [ProgramFiles, process.env["ProgramFiles(x86)"], LOCALAPPDATA && join(LOCALAPPDATA, "Programs")];
  return roots.filter(Boolean).map(root => join(root as string, "Git", "cmd", "git.exe"));
}

/** execFile cannot launch .cmd/.bat shims, and on Windows a bare name usually resolves to one. */
function needsShell(command: string) {
  return isWindows && !command.toLowerCase().endsWith(".exe");
}

function quoteIfNeeded(command: string) {
  return needsShell(command) && command.includes(" ") ? `"${command}"` : command;
}

function runTool(tool: ResolvedTool, args: string[], opts: ExecFileOptions = {}) {
  return tryRun(quoteIfNeeded(tool.command), [...tool.args, ...args], { shell: tool.shell, ...opts });
}

/** Runs `<command> <args> --version` and, if that works, reports the tool as usable. */
async function probe(command: string, args: string[], source: string): Promise<ResolvedTool | null> {
  if (UNSAFE_SHELL_CHARS.test(command)) return null;

  const tool: ResolvedTool = { command, args, shell: needsShell(command), version: null, source };
  const res = await runTool(tool, ["--version"], { cwd: VENCORD_SRC_DIR });
  if (!res.ok) return null;

  tool.version = res.stdout.trim().split("\n")[0] || null;
  return tool;
}

async function resolveTool(name: ToolName, configured: string, candidates: string[]): Promise<ResolvedTool | null> {
  // A configured path wins, but only if it actually works - otherwise a stale setting would permanently mask a perfectly good installation elsewhere.
  const wanted = configured.trim();
  if (wanted) {
    const fromSetting = await probe(wanted, [], "plugin setting");
    if (fromSetting) return fromSetting;
  }

  const fromPath = await probe(name, [], "PATH");
  if (fromPath) return fromPath;

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const found = await probe(candidate, [], candidate);
    if (found) return found;
  }

  if (name !== "git") {
    const viaFnm = await probe("fnm", ["exec", "--using=default", "--", name], "fnm exec");
    if (viaFnm) return viaFnm;
  }

  return null;
}

async function resolveTools(nodeCommand: string, pnpmCommand: string): Promise<Tools> {
  const [git, node] = await Promise.all([
    resolveTool("git", "", gitCandidates()),
    resolveTool("node", nodeCommand, nodeCandidates())
  ]);

  // Absolute paths tell us where corepack's pnpm shim would live; a bare "node" does not.
  const nodeDir = node?.command.includes(sep) ? dirname(node.command) : null;

  let pnpm = await resolveTool("pnpm", pnpmCommand, pnpmCandidates(nodeDir));

  if (!pnpm && nodeDir) {
    const corepack = join(nodeDir, isWindows ? "corepack.cmd" : "corepack");
    if (existsSync(corepack)) pnpm = await probe(corepack, ["pnpm"], `${corepack} pnpm`);
  }

  return { git, node, pnpm };
}

// git is needed for every scan, so remember where it is rather than probing each time.
let cachedGit: ResolvedTool | null | undefined;

async function getGit() {
  if (cachedGit === undefined) cachedGit = await resolveTool("git", "", gitCandidates());
  return cachedGit;
}

// #endregion

const gitIn = (git: ResolvedTool, cwd: string) => (...args: string[]) => runTool(git, args, { cwd });

function toId(dir: string) {
  return relative(VENCORD_SRC_DIR, dir).split(sep).join("/");
}

function emptyRepoInfo(dir: string): RepoInfo {
  return {
    id: toId(dir),
    name: basename(dir),
    path: dir,
    branch: null,
    upstream: null,
    remoteUrl: null,
    dirty: false,
    ahead: 0,
    behind: 0,
    commits: [],
    error: null
  };
}

/**
 * Finds every git repository under src/userplugins. A direct child that contains a .git entry is a repository; otherwise we look one level deeper, which covers layouts where clones are grouped inside a folder.
 */
async function findRepoDirs(): Promise<string[]> {
  if (!existsSync(USERPLUGINS_DIR)) return [];

  const found: string[] = [];
  const entries = await readdir(USERPLUGINS_DIR, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;

    const dir = join(USERPLUGINS_DIR, entry.name);
    // .git is a directory for normal clones and a file for worktrees/submodules
    if (existsSync(join(dir, ".git"))) {
      found.push(dir);
      continue;
    }

    const nested = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const child of nested) {
      if (!child.isDirectory() || child.name.startsWith(".") || IGNORED_DIRS.has(child.name)) continue;
      if (existsSync(join(dir, child.name, ".git"))) found.push(join(dir, child.name));
    }
  }

  return found;
}

/** Resolves an id coming from the renderer back to a path we actually discovered ourselves. */
async function resolveRepoId(id: string): Promise<string | null> {
  const dirs = await findRepoDirs();
  return dirs.find(dir => toId(dir) === id) ?? null;
}

async function getRepoInfo(gitTool: ResolvedTool, dir: string, doFetch: boolean): Promise<RepoInfo> {
  const git = gitIn(gitTool, dir);
  const info = emptyRepoInfo(dir);

  const remote = await git("remote", "get-url", "origin");
  if (remote.ok) {
    info.remoteUrl = remote.stdout.trim()
      .replace(/^git@(.+?):/, "https://$1/")
      .replace(/\.git$/, "");
  }

  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  if (!branch.ok) {
    info.error = branch.stderr.trim() || "Failed to read the current branch";
    return info;
  }
  info.branch = branch.stdout.trim();

  const status = await git("status", "--porcelain");
  info.dirty = status.ok && status.stdout.trim().length > 0;

  if (doFetch) {
    const fetched = await git("fetch", "--prune");
    if (!fetched.ok) info.error = fetched.stderr.trim() || "git fetch failed";
  }

  const upstream = await git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
  if (!upstream.ok) {
    info.error ??= `No upstream configured for '${info.branch}'. Run: git branch --set-upstream-to=origin/${info.branch}`;
    return info;
  }
  info.upstream = upstream.stdout.trim();

  const counts = await git("rev-list", "--left-right", "--count", `HEAD...${info.upstream}`);
  if (counts.ok) {
    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    info.ahead = Number.isFinite(ahead) ? ahead : 0;
    info.behind = Number.isFinite(behind) ? behind : 0;
  }

  if (info.behind > 0) {
    // \x1f as separator so commit messages containing slashes survive intact
    const log = await git("log", `HEAD..${info.upstream}`, "--pretty=format:%h%x1f%an%x1f%s");
    if (log.ok) {
      info.commits = log.stdout.trim().split("\n").filter(Boolean).map(line => {
        const [hash, author, message] = line.split("\x1f");
        return { hash, author, message } as CommitInfo;
      });
    }
  }

  return info;
}

export function getVencordDir(_: IpcEvent): string {
  return VENCORD_SRC_DIR;
}

export function getTools(_: IpcEvent, nodeCommand: string, pnpmCommand: string): Promise<Tools> {
  cachedGit = undefined; // an explicit tool check should re-look, not trust the cache
  return resolveTools(nodeCommand, pnpmCommand);
}

export async function scanRepos(_: IpcEvent, doFetch: boolean): Promise<RepoInfo[]> {
  const dirs = await findRepoDirs();
  const git = await getGit();

  if (!git) {
    return dirs.map(dir => ({
      ...emptyRepoInfo(dir),
      error: "git could not be found. Set an absolute path in this plugin's settings."
    }));
  }

  const infos = await Promise.all(dirs.map(dir => getRepoInfo(git, dir, doFetch)));
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}

export async function pullRepo(_: IpcEvent, id: string, mode: PullMode): Promise<CommandResult> {
  const git = await getGit();
  if (!git) return { ok: false, stdout: "", stderr: "git could not be found" };

  const dir = await resolveRepoId(id);
  if (!dir) return { ok: false, stdout: "", stderr: `Unknown repository: ${id}` };

  const args = ["pull"];
  if (mode === "rebase") args.push("--rebase");
  else if (mode === "merge") args.push("--no-rebase");
  else args.push("--ff-only");

  return runTool(git, args, { cwd: dir });
}

export async function installDeps(_: IpcEvent, nodeCommand: string, pnpmCommand: string): Promise<CommandResult> {
  const { pnpm } = await resolveTools(nodeCommand, pnpmCommand);
  if (!pnpm) return { ok: false, stdout: "", stderr: "pnpm could not be found" };

  return runTool(pnpm, ["install", "--frozen-lockfile"], { cwd: VENCORD_SRC_DIR });
}

export async function buildVencord(_: IpcEvent, nodeCommand: string): Promise<CommandResult> {
  const node = await resolveTool("node", nodeCommand, nodeCandidates());
  if (!node) {
    return {
      ok: false,
      stdout: "",
      stderr: "node could not be found. Discord only sees the system PATH, so shell-managed "
        + "installs (fnm, mise, asdf) may be invisible to it. Set an absolute path to node "
        + "in this plugin's settings."
    };
  }

  const args = ["scripts/build/build.mjs"];
  if (IS_DEV) args.push("--dev");

  const res = await runTool(node, args, { cwd: VENCORD_SRC_DIR });
  // build.mjs can report a failure without a non-zero exit code
  if (res.ok && res.stderr.includes("Build failed")) return { ...res, ok: false };

  return res;
}
