/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile as cpExecFile, ExecFileOptions } from "child_process";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { basename, join, relative, sep } from "path";
import { promisify } from "util";

import type { CommandResult, CommitInfo, IpcEvent, PullMode, RepoInfo, ToolVersions } from "./types";

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

/** Characters that must never reach a shell. Used to vet the user configured pnpm command. */
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

const gitIn = (cwd: string) => (...args: string[]) => tryRun("git", args, { cwd });

function toId(dir: string) {
    return relative(VENCORD_SRC_DIR, dir).split(sep).join("/");
}

/**
 * Finds every git repository under src/userplugins. A direct child that contains a
 * .git entry is a repository; otherwise we look one level deeper, which covers
 * layouts where clones are grouped inside a folder.
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

async function getRepoInfo(dir: string, doFetch: boolean): Promise<RepoInfo> {
    const git = gitIn(dir);

    const info: RepoInfo = {
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

/**
 * execFile refuses to launch .cmd/.bat shims without a shell, and pnpm is a .cmd on
 * Windows. Vet the command and quote it so a shell can be used safely.
 */
function prepareShellCommand(command: string) {
    const cmd = command.trim() || "pnpm";
    if (UNSAFE_SHELL_CHARS.test(cmd)) return null;
    return isWindows && cmd.includes(" ") ? `"${cmd}"` : cmd;
}

export function getVencordDir(_: IpcEvent): string {
    return VENCORD_SRC_DIR;
}

export async function scanRepos(_: IpcEvent, doFetch: boolean): Promise<RepoInfo[]> {
    const dirs = await findRepoDirs();
    const infos = await Promise.all(dirs.map(dir => getRepoInfo(dir, doFetch)));
    return infos.sort((a, b) => a.name.localeCompare(b.name));
}

export async function pullRepo(_: IpcEvent, id: string, mode: PullMode): Promise<CommandResult> {
    const dir = await resolveRepoId(id);
    if (!dir) return { ok: false, stdout: "", stderr: `Unknown repository: ${id}` };

    const args = ["pull"];
    if (mode === "rebase") args.push("--rebase");
    else if (mode === "merge") args.push("--no-rebase");
    else args.push("--ff-only");

    return tryRun("git", args, { cwd: dir });
}

export async function installDeps(_: IpcEvent, pnpmCommand: string): Promise<CommandResult> {
    const cmd = prepareShellCommand(pnpmCommand);
    if (!cmd) return { ok: false, stdout: "", stderr: `Refusing to run unsafe pnpm command: ${pnpmCommand}` };

    return tryRun(cmd, ["install", "--frozen-lockfile"], { cwd: VENCORD_SRC_DIR, shell: isWindows });
}

export async function buildVencord(_: IpcEvent): Promise<CommandResult> {
    const args = ["scripts/build/build.mjs"];
    if (IS_DEV) args.push("--dev");

    const res = await tryRun("node", args, { cwd: VENCORD_SRC_DIR });
    // build.mjs can report a failure without a non-zero exit code
    if (res.ok && res.stderr.includes("Build failed")) return { ...res, ok: false };

    return res;
}

export async function getToolVersions(_: IpcEvent, pnpmCommand: string): Promise<ToolVersions> {
    const pnpmCmd = prepareShellCommand(pnpmCommand);

    const [git, node, pnpm] = await Promise.all([
        tryRun("git", ["--version"], { cwd: VENCORD_SRC_DIR }),
        tryRun("node", ["--version"], { cwd: VENCORD_SRC_DIR }),
        pnpmCmd
            ? tryRun(pnpmCmd, ["--version"], { cwd: VENCORD_SRC_DIR, shell: isWindows })
            : Promise.resolve({ ok: false, stdout: "", stderr: "" } as CommandResult)
    ]);

    return {
        git: git.ok ? git.stdout.trim() : null,
        node: node.ok ? node.stdout.trim() : null,
        pnpm: pnpm.ok ? pnpm.stdout.trim() : null
    };
}
