/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import { settings } from "./settings";
import type { RepoInfo, ToolVersions } from "./types";

export const UpdaterLogger = new Logger("UserpluginUpdater", "#b6e3a1");

type Native = PluginNative<typeof import("./native")>;

/**
 * The native module is keyed by the plugin's `name`. It only exists once Vencord has
 * been rebuilt with this plugin present, so fail with something readable until then.
 */
export function getNative(): Native {
    if (IS_WEB) throw new Error("This plugin only works in the desktop app, since it needs to run git and node.");

    const native = (VencordNative.pluginHelpers as Record<string, any>)?.UserpluginUpdater;
    if (!native) throw new Error("Native module not found. Rebuild Vencord once by hand ('pnpm build'), then restart Discord.");

    return native as Native;
}

/** Trims a command's output down to something that fits in the UI. */
export function firstLines(text: string, count = 4) {
    const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
    return lines.slice(0, count).join("\n") || "unknown error";
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

export function getToolVersions(): Promise<ToolVersions> {
    return getNative().getToolVersions(settings.store.pnpmCommand);
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

/**
 * Pulls the given repositories, then reinstalls dependencies and rebuilds Vencord.
 * The build is what actually makes the new plugin code take effect, so it always runs
 * last and only if at least one repository moved.
 */
export async function runUpdate(targets: RepoInfo[], log: (line: string) => void): Promise<UpdateResult> {
    const native = getNative();
    const { pullMode, runInstall, pnpmCommand } = settings.store;

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
    }

    if (result.pulled.length === 0) {
        log("Nothing was pulled, skipping the rebuild.");
        await checkForUpdates(false).catch(() => { });
        return result;
    }

    if (runInstall) {
        log(`> ${pnpmCommand} install --frozen-lockfile`);
        const install = await native.installDeps(pnpmCommand);

        if (!install.ok) {
            log(`  failed: ${firstLines(install.stderr)}`);
            await checkForUpdates(false).catch(() => { });
            return result;
        }

        log("  dependencies are up to date");
    }

    log("> node scripts/build/build.mjs");
    const build = await native.buildVencord();

    if (!build.ok) {
        log(`  build failed: ${firstLines(build.stderr)}`);
        await checkForUpdates(false).catch(() => { });
        return result;
    }

    log("  build finished");
    result.built = true;
    result.ok = result.failed.length === 0;

    await checkForUpdates(false).catch(() => { });

    return result;
}
