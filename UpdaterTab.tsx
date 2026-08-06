/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
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
import { useAwaiter } from "@utils/react";
import { ConfirmModal, openModal, Toasts, useEffect, useState } from "@webpack/common";

import { settings } from "./settings";
import type { RepoInfo } from "./types";
import {
    checkForUpdates,
    getOutdated,
    getToolVersions,
    lastCheckedAt,
    lastError,
    repos,
    runUpdate,
    subscribe,
    UpdaterLogger
} from "./updater";

const cl = (className: string) => `vc-upu-${className}`;

function toast(message: string, type: string = Toasts.Type.MESSAGE) {
    Toasts.show({
        message,
        type,
        id: Toasts.genId(),
        options: { position: Toasts.Position.BOTTOM }
    });
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

function Diagnostics() {
    const [versions] = useAwaiter(getToolVersions, {
        fallbackValue: null,
        onError: e => UpdaterLogger.error("Failed to read tool versions", e)
    });

    if (!versions) return null;

    const missing = Object.entries(versions).filter(([, v]) => v == null).map(([name]) => name);
    if (missing.length === 0) return null;

    return (
        <ErrorCard className={Margins.bottom16}>
            <Paragraph>
                Not runnable from Discord's environment: <b>{missing.join(", ")}</b>.
                {missing.includes("pnpm") && " Set an absolute path in this plugin's 'pnpmCommand' setting, or turn off 'Run pnpm install'."}
            </Paragraph>
        </ErrorCard>
    );
}

function UserpluginUpdater() {
    const { checkOnStartup, notifyOnUpdatesFound, runInstall } =
        settings.use(["checkOnStartup", "notifyOnUpdatesFound", "runInstall"]);

    const [list, setList] = useState<RepoInfo[]>(repos);
    const [error, setError] = useState<string | null>(lastError);
    const [isChecking, setIsChecking] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [log, setLog] = useState<string[]>([]);

    useEffect(() => subscribe(() => setList([...repos])), []);

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

    async function update(targets: RepoInfo[]) {
        if (targets.length === 0) return;

        setIsUpdating(true);
        setLog([]);

        try {
            const result = await runUpdate(targets, line => setLog(prev => [...prev, line]));

            if (result.built) promptRestart();
            else if (result.failed.length > 0) toast("Some repositories could not be updated", Toasts.Type.FAILURE);
        } catch (e: any) {
            UpdaterLogger.error("Update failed", e);
            setLog(prev => [...prev, `error: ${e?.message ?? e}`]);
        } finally {
            setIsUpdating(false);
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

            <Diagnostics />

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
                description="Runs 'pnpm install --frozen-lockfile'. Turn off if your dependencies never change"
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
                    {isUpdating ? "Updating…" : `Update All${outdated.length ? ` (${outdated.length})` : ""}`}
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
