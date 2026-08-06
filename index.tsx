/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { showNotification } from "@api/Notifications";
import { openSettingsTabModal } from "@components/settings";
import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import definePlugin, { IconProps } from "@utils/types";

import { settings } from "./settings";
import { checkForUpdates, getOutdated, UpdaterLogger } from "./updater";
import UpdaterTab from "./UpdaterTab";

const ENTRY_KEY = "vencord_userplugin_updater";

// Discord is still mounting things right after start(), and fetching every repository
// touches disk and network, so hold off for a moment.
const STARTUP_CHECK_DELAY = 10_000;

function UserpluginUpdaterIcon(props: IconProps) {
    return (
        <svg
            className={props.className}
            width={props.width ?? 24}
            height={props.height ?? 24}
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <path
                fill="currentColor"
                d="M12 2a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V3a1 1 0 0 1 1-1Z"
            />
            <path
                fill="currentColor"
                d="M4 15a1 1 0 0 1 1 1v3h14v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z"
            />
        </svg>
    );
}

export default definePlugin({
    name: "UserpluginUpdater",
    description: "Update your git-cloned userplugins and rebuild Vencord without leaving Discord",
    authors: [{ name: "otoneko.", id: 236727759672442880n }],
    tags: ["Utility", "Developers"],

    settings,

    startupCheckTimeout: undefined as ReturnType<typeof setTimeout> | undefined,

    toolboxActions: {
        "Open Userplugin Updater": () => openSettingsTabModal(UpdaterTab)
    },

    start() {
        SettingsPlugin.customEntries.push({
            key: ENTRY_KEY,
            title: "Userplugins",
            panelTitle: "Userplugin Updater",
            Component: UpdaterTab,
            Icon: UserpluginUpdaterIcon
        });

        if (!IS_WEB && settings.store.checkOnStartup)
            this.startupCheckTimeout = setTimeout(() => this.runStartupCheck(), STARTUP_CHECK_DELAY);
    },

    stop() {
        clearTimeout(this.startupCheckTimeout);
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === ENTRY_KEY);
    },

    async runStartupCheck() {
        try {
            const outdated = getOutdated(await checkForUpdates(true));
            if (outdated.length === 0 || !settings.store.notifyOnUpdatesFound) return;

            showNotification({
                title: `${outdated.length} userplugin${outdated.length === 1 ? " has" : "s have"} updates`,
                body: outdated.map(repo => `${repo.name} (${repo.behind})`).join(", "),
                onClick: () => openSettingsTabModal(UpdaterTab)
            });
        } catch (e) {
            UpdaterLogger.error("Startup update check failed", e);
        }
    }
});
