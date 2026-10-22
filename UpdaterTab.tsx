/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import { ErrorCard } from "@components/ErrorCard";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading, HeadingSecondary } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { relaunch } from "@utils/native";
import { ConfirmModal, openModal, showToast, useEffect, useState } from "@webpack/common";

import { settings } from "./settings";
import type { RepoInfo, ToolName, Tools } from "./types";
import {
    checkForUpdates,
    getOutdated,
    getTools,
    lastCheckedAt,
    lastError,
    repos,
    runRebuild,
    runUpdate,
    subscribe,
    UpdaterLogger
} from "./updater";

const cl = (className: string) => `vc-upu-${className}`;

const TOOL_NAMES: ToolName[] = ["git", "node", "pnpm"];

type ToastVariant = "default" | "success" | "critical";

// Vencord replaced the Toasts helper with an object-taking showToast, but @vencord/types
// (1.15.1) still declares the old positional signature.
const showToastCompat = showToast as unknown as (data: { text: string; variant?: ToastVariant; position?: "top" | "bottom"; }) => void;

function toast(text: string, variant: ToastVariant = "default") {
    showToastCompat({ text, variant, position: "bottom" });
}

function promptRestart() {
    openModal(props => (
        <ConfirmModal
            {...props}
            title="Rebuild finished"
            subtitle="Discord needs to restart before the updated userplugins load. Restart now?"
            confirmText="Restart"
            cancelText="Later"
            variant="primary"
            onConfirm={relaunch}
        />
    ));
}

function CommitList({ repo }: { repo: RepoInfo; }) {
    return (
        <Card className={cl("commits")} defaultPadding={false}>
            {repo.commits.map(({ hash, author, message }) => (
                <div key={hash} className={cl("commit")}>
                    <code>
                        {repo.remoteUrl
                            ? <Link href={`${repo.remoteUrl}/commit/${hash}`}>{hash}</Link>
                            : hash}
                    </code>
                    <span className={cl("commit-message")}>{message} — {author}</span>
                </div>
            ))}
        </Card>
    );
}

function RepoCard({ repo, busy, onUpdate }: { repo: RepoInfo; busy: boolean; onUpdate(): void; }) {
    const isOutdated = repo.behind > 0;

    return (
        <Card variant={repo.error ? "warning" : isOutdated ? "info" : "normal"} className={cl("repo")}>
            <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="0.5em">
                <div>
                    <HeadingSecondary className={cl("repo-name")}>
                        {repo.remoteUrl ? <Link href={repo.remoteUrl}>{repo.name}</Link> : repo.name}
                    </HeadingSecondary>
                    <Paragraph className={cl("repo-meta")}>
                        {repo.branch ?? "unknown branch"}
                        {repo.upstream && ` → ${repo.upstream}`}
                        {" · "}
                        {isOutdated
                            ? `${repo.behind} commit${repo.behind === 1 ? "" : "s"} behind`
                            : "up to date"}
                        {repo.ahead > 0 && ` · ${repo.ahead} local commit${repo.ahead === 1 ? "" : "s"}`}
                        {repo.dirty && " · uncommitted changes"}
                    </Paragraph>
                </div>

                {isOutdated && (
                    <Button size="small" disabled={busy || repo.dirty} onClick={onUpdate}>
                        Update
                    </Button>
                )}
            </Flex>

            {repo.error && (
                <Paragraph className={classes(cl("repo-error"), Margins.top8)}>{repo.error}</Paragraph>
            )}

            {repo.dirty && isOutdated && (
                <Paragraph className={classes(cl("repo-error"), Margins.top8)}>
                    This repository has uncommitted changes and will be skipped. Commit or stash them first.
                </Paragraph>
            )}

            {isOutdated && repo.commits.length > 0 && <CommitList repo={repo} />}
        </Card>
    );
}

/**
 * Discord inherits only the persistent system PATH. Version managers that set PATH from a
 * shell hook - fnm, mise, asdf, nvm.sh - are therefore invisible to it, which is a confusing
 * failure to hit when the exact same command works in a terminal. Always show what was
 * actually resolved so the cause is obvious.
 */
function Toolchain({ nonce }: { nonce: number; }) {
    const [tools, setTools] = useState<Tools | null>(null);

    useEffect(() => {
        let cancelled = false;

        getTools()
            .then(resolved => { if (!cancelled) setTools(resolved); })
            .catch(e => UpdaterLogger.error("Failed to resolve the toolchain", e));

        return () => { cancelled = true; };
    }, [nonce]);

    if (!tools) return null;

    const missing = TOOL_NAMES.filter(name => !tools[name]);
    // pnpm is optional: the install step is skipped without it, the build still runs
    const blocking = missing.filter(name => name !== "pnpm");

    return (
        <>
            {blocking.length > 0 && (
                <ErrorCard className={Margins.bottom16}>
                    <Paragraph>
                        <b>{blocking.join(" and ")}</b> could not be found. Discord only inherits the
                        system PATH, so a version manager that sets PATH from a shell hook — fnm, mise,
                        asdf, nvm.sh — stays invisible to it even though it works in a terminal.
                        Set an absolute path in this plugin's settings.
                    </Paragraph>
                </ErrorCard>
            )}

            {missing.includes("pnpm") && (
                <Card variant="warning" className={Margins.bottom16}>
                    <Paragraph>
                        pnpm could not be found, so the install step will be skipped. That is harmless
                        unless a Vencord dependency changed — the build will say so if it matters.
                    </Paragraph>
                </Card>
            )}

            <Paragraph className={cl("toolchain")}>
                {TOOL_NAMES.map(name => {
                    const tool = tools[name];
                    return `${name}: ${tool ? `${tool.version ?? "found"} — ${tool.source}` : "not found"}`;
                }).join("\n")}
            </Paragraph>
        </>
    );
}

function UserpluginUpdater() {
    const { checkOnStartup, notifyOnUpdatesFound, runInstall, pendingRebuild } =
        settings.use(["checkOnStartup", "notifyOnUpdatesFound", "runInstall", "pendingRebuild"]);

    const [list, setList] = useState<RepoInfo[]>(repos);
    const [error, setError] = useState<string | null>(lastError);
    const [isChecking, setIsChecking] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [toolNonce, setToolNonce] = useState(0);

    useEffect(() => subscribe(() => setList([...repos])), []);

    const appendLog = (line: string) => setLog(prev => [...prev, line]);

    async function check(doFetch: boolean, quiet = false) {
        setIsChecking(true);
        try {
            const next = await checkForUpdates(doFetch);
            setError(null);

            if (!quiet) {
                const outdated = getOutdated(next);
                toast(outdated.length
                    ? `${outdated.length} userplugin${outdated.length === 1 ? " has" : "s have"} updates`
                    : "All userplugins are up to date");
            }
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setIsChecking(false);
        }
    }

    // seed the list the first time the tab is opened, without hitting the network
    useEffect(() => {
        if (lastCheckedAt === null) void check(false, true);
    }, []);

    /** Re-probes the toolchain, so fixing a PATH problem shows up without reopening the tab. */
    const refreshTools = () => setToolNonce(nonce => nonce + 1);

    async function update(targets: RepoInfo[]) {
        if (targets.length === 0) return;

        setIsUpdating(true);
        setLog([]);

        try {
            const result = await runUpdate(targets, appendLog);

            if (result.built) promptRestart();
            else if (result.failed.length > 0) toast("Some repositories could not be updated", "critical");
        } catch (e: any) {
            UpdaterLogger.error("Update failed", e);
            appendLog(`error: ${e?.message ?? e}`);
        } finally {
            setIsUpdating(false);
            refreshTools();
        }
    }

    async function rebuild() {
        setIsUpdating(true);
        setLog([]);

        try {
            if (await runRebuild(appendLog)) promptRestart();
            else toast("Rebuild failed, see the log", "critical");
        } catch (e: any) {
            UpdaterLogger.error("Rebuild failed", e);
            appendLog(`error: ${e?.message ?? e}`);
        } finally {
            setIsUpdating(false);
            refreshTools();
        }
    }

    const outdated = getOutdated(list).filter(repo => !repo.dirty);
    const busy = isChecking || isUpdating;

    return (
        <SettingsTab>
            <Card variant="info" className={Margins.bottom20}>
                <HeadingSecondary>How this works</HeadingSecondary>
                <Paragraph>
                    Every git repository under <code>src/userplugins</code> is pulled, then Vencord is
                    rebuilt with <code>node scripts/build/build.mjs</code>. A restart is needed afterwards
                    for the new code to load. <code>pnpm inject</code> is not re-run — it only needs to
                    happen once per install.
                </Paragraph>
            </Card>

            {pendingRebuild && (
                <Card variant="warning" className={Margins.bottom16}>
                    <HeadingSecondary>Rebuild pending</HeadingSecondary>
                    <Paragraph>
                        Repositories have been pulled but Vencord has not been rebuilt since. The updated
                        plugin code will not load until it is.
                    </Paragraph>
                </Card>
            )}

            <Toolchain nonce={toolNonce} />

            <FormSwitch
                title="Check on startup"
                description="Fetch every userplugin repository when Discord starts"
                value={checkOnStartup}
                onChange={v => settings.store.checkOnStartup = v}
            />
            <FormSwitch
                title="Notify when updates are found"
                description="Show a notification after the startup check"
                value={notifyOnUpdatesFound}
                onChange={v => settings.store.notifyOnUpdatesFound = v}
                disabled={!checkOnStartup}
            />
            <FormSwitch
                title="Run pnpm install before building"
                description="Runs 'pnpm install --frozen-lockfile'. Skipped automatically if pnpm cannot be found"
                value={runInstall}
                onChange={v => settings.store.runInstall = v}
            />

            <Divider className={classes(Margins.top16, Margins.bottom16)} />

            <Flex className={Margins.bottom16} alignItems="center" flexWrap="wrap">
                <Button disabled={busy} onClick={() => check(true)}>
                    {isChecking ? "Checking…" : "Check for Updates"}
                </Button>
                <Button
                    variant="primary"
                    disabled={busy || outdated.length === 0}
                    onClick={() => update(outdated)}
                >
                    {isUpdating ? "Working…" : `Update All${outdated.length ? ` (${outdated.length})` : ""}`}
                </Button>
                {/*
                  * Always available, not just after a failure: once a pull has landed there is
                  * no outdated repository left for "Update All" to act on, so this is the only
                  * way back to the build step.
                  */}
                <Button
                    variant={pendingRebuild ? "primary" : "secondary"}
                    disabled={busy}
                    onClick={rebuild}
                >
                    Rebuild Vencord
                </Button>
            </Flex>

            {error && (
                <ErrorCard className={Margins.bottom16}>
                    <Paragraph>{error}</Paragraph>
                </ErrorCard>
            )}

            {log.length > 0 && (
                <Card className={classes(cl("log"), Margins.bottom16)}>
                    {log.map((line, i) => <div key={i}>{line}</div>)}
                </Card>
            )}

            <Heading tag="h5">Repositories</Heading>

            {list.length === 0
                ? (
                    <Paragraph>
                        No git repositories found under <code>src/userplugins</code>. Plugins copied in as
                        plain files cannot be updated automatically.
                    </Paragraph>
                )
                : list.map(repo => (
                    <RepoCard
                        key={repo.id}
                        repo={repo}
                        busy={busy}
                        onUpdate={() => update([repo])}
                    />
                ))}
        </SettingsTab>
    );
}

export default wrapTab(UserpluginUpdater, "Userplugin Updater");
