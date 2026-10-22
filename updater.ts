/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import { settings } from "./settings";
import type { RepoInfo, Tools } from "./types";

export const UpdaterLogger = new Logger("UserpluginUpdater", "#b6e3a1");

type Native = PluginNative<typeof import("./native")>;

/**
 * The native module is keyed by the plugin's `name`. It only exists once Vencord has been rebuilt with this plugin present, so fail with something readable until then.
 */
export function getNative(): Native {
  if (IS_WEB) throw new Error("This plugin only works in the desktop app, since it needs to run git and node.");

  const native = (VencordNative.pluginHelpers as Record<string, any>)?.UserpluginUpdater;
  if (!native)
    throw new Error("Native module not found. Rebuild Vencord once by hand ('pnpm build'), then restart Discord.");

  return native as Native;
}

/** Trims a command's output down to something that fits in the UI. */
export function firstLines(text: string, count = 4) {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  return lines.slice(0, count).join("\n") || "unknown error";
}

/**
 * esbuild writes its bundle size report to stderr before any error, so the first lines of a failed build are just noise. Start from the first error marker instead.
 */
export function buildErrorLines(text: string, count = 8) {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const start = lines.findIndex(line => /\[ERROR\]|✘|Build failed|^error/i.test(line));

  if (start === -1) return lines.slice(-count).join("\n") || "unknown error";
  return lines.slice(start, start + count).join("\n");
}

// --- shared state, so the settings tab and the startup check agree on what they saw ---

export let repos: RepoInfo[] = [];
export let lastCheckedAt: number | null = null;
export let lastError: string | null = null;

const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

export function getOutdated(list = repos) {
  return list.filter(repo => repo.behind > 0);
}

export async function checkForUpdates(doFetch = true): Promise<RepoInfo[]> {
  try {
    repos = await getNative().scanRepos(doFetch);
    lastError = null;
  } catch (e: any) {
    lastError = e?.message ?? String(e);
    UpdaterLogger.error("Failed to scan userplugin repositories", e);
    throw e;
  } finally {
    lastCheckedAt = Date.now();
    emit();
  }

  return repos;
}

export function getTools(): Promise<Tools> {
  const { nodeCommand, pnpmCommand } = settings.store;
  return getNative().getTools(nodeCommand, pnpmCommand);
}

export interface UpdateResult {
  /** Whether the whole pipeline, including the build, succeeded. */
  ok: boolean;
  /** Repositories that were actually fast-forwarded/merged. */
  pulled: string[];
  /** Repositories that failed to pull or were skipped because they were dirty. */
  failed: string[];
  /** Whether a rebuild ran and succeeded, i.e. whether a restart is worth offering. */
  built: boolean;
}

/** Whether a pull has landed that no successful build has picked up yet. */
export function isRebuildPending() {
  return settings.store.pendingRebuild === true;
}

/**
 * Reinstalls dependencies and rebuilds Vencord. Split out from {@link runUpdate} so a rebuild that failed - a missing node, a broken build - can be retried on its own. Once the repositories have been pulled there is nothing left for `runUpdate` to do, so without this the UI would offer no way forward.
 */
export async function runRebuild(log: (line: string) => void): Promise<boolean> {
  const native = getNative();
  const { runInstall, nodeCommand, pnpmCommand } = settings.store;

  if (runInstall) {
    log("> pnpm install --frozen-lockfile");
    const install = await native.installDeps(nodeCommand, pnpmCommand);

    // Deliberately not fatal. Updating a userplugin practically never changes Vencord's own dependencies, so refusing to build because pnpm is missing would strand the tree in a pulled-but-not-built state. If deps really did change, the build below fails with a much clearer error anyway.
    if (install.ok) log("  dependencies are up to date");
    else log(`  skipped: ${firstLines(install.stderr, 2)}`);
  }

  log("> node scripts/build/build.mjs");
  const build = await native.buildVencord(nodeCommand);

  if (!build.ok) {
    log(`  build failed: ${buildErrorLines(build.stderr)}`);
    return false;
  }

  log("  build finished");
  settings.store.pendingRebuild = false;
  emit();

  return true;
}

/**
 * Pulls the given repositories, then rebuilds. The build is what actually makes the new plugin code take effect, so it always runs last and only if at least one repository moved.
 */
export async function runUpdate(targets: RepoInfo[], log: (line: string) => void): Promise<UpdateResult> {
  const native = getNative();
  const { pullMode } = settings.store;

  const result: UpdateResult = { ok: false, pulled: [], failed: [], built: false };

  for (const repo of targets) {
    if (repo.dirty) {
      log(`- ${repo.name}: skipped, the working tree has uncommitted changes`);
      result.failed.push(repo.name);
      continue;
    }

    log(`> git pull (${repo.name})`);
    const pull = await native.pullRepo(repo.id, pullMode);

    if (!pull.ok) {
      log(`  failed: ${firstLines(pull.stderr, 2)}`);
      result.failed.push(repo.name);
      continue;
    }

    log(`  ${repo.name} updated`);
    result.pulled.push(repo.name);
    // The tree has moved; record that before anything downstream can fail.
    settings.store.pendingRebuild = true;
  }

  if (result.pulled.length === 0 && !isRebuildPending()) {
    log("Nothing was pulled, skipping the rebuild.");
    await checkForUpdates(false).catch(() => {});
    return result;
  }

  result.built = await runRebuild(log);
  result.ok = result.built && result.failed.length === 0;

  await checkForUpdates(false).catch(() => {});

  return result;
}
