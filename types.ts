/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Types shared between the renderer (index/UpdaterTab) and native (Node) sides. */

/**
 * The Electron IPC event every native handler receives as its first argument.
 *
 * Typed loosely on purpose: `electron` is only present inside a Vencord checkout, and
 * pulling it in as a dependency here would download the whole Electron binary just for
 * this one type. Vencord strips the parameter off before the renderer sees these
 * functions anyway, so nothing ever reads it.
 */
export type IpcEvent = unknown;

export type PullMode = "ff-only" | "merge" | "rebase";

export interface CommitInfo {
  hash: string;
  author: string;
  message: string;
}

export interface RepoInfo {
  /** Posix path relative to the Vencord root, e.g. `src/userplugins/myPlugin`. Used as a stable id. */
  id: string;
  /** The folder name of the repository. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  branch: string | null;
  /** e.g. `origin/main`, or null when the branch has no upstream. */
  upstream: string | null;
  /** Normalised to a browsable https url when possible. */
  remoteUrl: string | null;
  /** Whether the working tree has uncommitted changes. */
  dirty: boolean;
  ahead: number;
  behind: number;
  /** The commits that `git pull` would bring in. */
  commits: CommitInfo[];
  error: string | null;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type ToolName = "git" | "node" | "pnpm";

export interface ResolvedTool {
  /** Absolute path when the tool was found on disk, otherwise the bare command name. */
  command: string;
  /** Prefix arguments, e.g. `["exec", "--using=default", "--", "node"]` when going through fnm. */
  args: string[];
  /** Whether the command has to go through a shell. True for Windows `.cmd`/`.bat` shims. */
  shell: boolean;
  version: string | null;
  /** Where it was found. Shown in the diagnostics panel so failures are debuggable. */
  source: string;
}

export type Tools = Record<ToolName, ResolvedTool | null>;
