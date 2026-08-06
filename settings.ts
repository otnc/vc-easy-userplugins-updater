/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import type { PullMode } from "./types";

export const settings = definePluginSettings({
    checkOnStartup: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Check all userplugin repositories for updates when Discord starts"
    },
    notifyOnUpdatesFound: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show a notification when the startup check finds updates"
    },
    runInstall: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Run 'pnpm install --frozen-lockfile' before building"
    },
    pullMode: {
        type: OptionType.SELECT,
        description: "How to pull. Fast-forward only refuses to touch local commits",
        options: [
            { label: "Fast-forward only (safest)", value: "ff-only", default: true },
            { label: "Merge", value: "merge" },
            { label: "Rebase", value: "rebase" }
        ] as { label: string; value: PullMode; default?: boolean; }[]
    },
    pnpmCommand: {
        type: OptionType.STRING,
        default: "pnpm",
        description: "Command used to run pnpm. Set an absolute path if pnpm is not on your PATH"
    }
});
