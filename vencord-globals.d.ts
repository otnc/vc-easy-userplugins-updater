/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 otoneko.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Vencord replaces these at build time, and its own `src/globals.d.ts` declares them.
 * The published `@vencord/types` package ships a stripped globals file that only covers
 * `Vencord` and `VencordNative`, so they have to be declared here to type-check outside a
 * Vencord checkout.
 *
 * Inside a checkout this file is redundant but harmless: the types match Vencord's own
 * declarations exactly, and identical `var` declarations merge rather than conflict.
 * Keep them in sync with `src/globals.d.ts` if you ever add more.
 */
declare global {
  export var IS_WEB: boolean;
  export var IS_DEV: boolean;
}

export {};
