# UserpluginUpdater

**English** | [日本語](README.ja.md)

Update your git-cloned userplugins and rebuild Vencord without leaving Discord.

Vencord ships an updater for itself, but nothing for the plugins you dropped into `src/userplugins`. This plugin does for them what the built-in Updater tab does for Vencord: it finds every git repository under `src/userplugins`, shows what each one is behind by, pulls them, reinstalls dependencies, rebuilds Vencord and offers to restart.

## Requirements

- The **desktop app** (Discord Desktop or Vesktop). The web build has no Node access.
- A **source install** of Vencord (cloned repo + `pnpm build` + `pnpm inject`), not the standalone installer build.
- `git` and `node` reachable from the environment Discord was launched in. `pnpm` too, unless you turn off *Run pnpm install before building*.

## Install

Clone this repository into your Vencord checkout:

```sh
cd <vencord>/src/userplugins
git clone <this repo> userpluginUpdater
cd <vencord>
pnpm build
```

Restart Discord, then enable **UserpluginUpdater** in Settings → Plugins.

The first build has to be done by hand — the plugin's native module cannot exist before Vencord has been built with the plugin present. After that the plugin can rebuild itself.

> A symlink or directory junction into `src/userplugins` does **not** work: esbuild resolves the link to its real path, which lands outside the Vencord tree, and the `@utils/...` path aliases stop resolving. Use a real clone or copy.

`node_modules/` is not committed and is not needed for the plugin to build — it only exists so the repository type-checks on its own. See [Development](#development).

## Usage

The plugin adds a **Userplugins** entry to the Vencord section of Discord's settings, and an *Open Userplugin Updater* action to the Vencord Toolbox.

- **Check for Updates** — `git fetch` in every repository, then show how far behind each is.
- **Update All** / per-repository **Update** — runs the pipeline below.

The pipeline:

1. `git pull --ff-only` in each selected repository
2. `pnpm install --frozen-lockfile` in the Vencord root (optional, on by default)
3. `node scripts/build/build.mjs` — the same thing `pnpm build` runs
4. a prompt to restart Discord

`pnpm inject` is deliberately not re-run. It only patches Discord's `app` folder to load Vencord from `dist/`, which stays true across rebuilds; you only need it once per install.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Check on startup | on | Fetches every repository ~10s after Discord starts |
| Notify when updates are found | on | Notification after the startup check, click to open the tab |
| Run pnpm install before building | on | Turn off if your dependencies never change — makes updates much faster |
| Pull mode | fast-forward only | `--ff-only`, `--no-rebase` or `--rebase` |
| pnpm command | `pnpm` | Set an absolute path if pnpm is not on Discord's `PATH` |

## Behaviour worth knowing

- **Repositories with uncommitted changes are skipped**, and *Update All* will not touch them. Commit or stash first. This is why fast-forward only is the default pull mode.
- **The rebuild only runs if at least one repository actually moved.** A failed pull does not block the others, but it does show up in the log.
- **A restart is required.** The running Discord already has the old `dist/` in memory; rewriting it changes nothing until the app reloads.
- Repositories are discovered by looking for a `.git` entry in each direct child of `src/userplugins`, and one level deeper if the child itself is not a repository. Plugins copied in as loose files cannot be updated — there is nothing to pull.

## Development

Userplugins are normally written inside a Vencord checkout, where every `@utils/...` import resolves against Vencord's own sources. This repository is set up to be editable on its own as well:

```sh
pnpm install     # installs @vencord/types and friends, nothing else
pnpm typecheck   # tsc --noEmit
pnpm format      # prettier --write . (Markdown is excluded)
```

`tsconfig.json` lists each Vencord alias twice — the in-tree relative path first, the `@vencord/types` copy second — and both TypeScript and esbuild take the first entry that exists on disk. That single file therefore covers both situations:

| | resolves via |
| --- | --- |
| editing here, standalone | `./node_modules/@vencord/types/...` |
| built inside `src/userplugins/` | `../../utils/...`, i.e. Vencord's real sources |

Two things are worth knowing before touching that file:

- esbuild reads the **nearest** `tsconfig.json` to each source file, and its `paths` replace the root config's entirely rather than merging. Dropping an alias from this file breaks the Vencord build for this plugin, even for aliases it does not use directly.
- `@vencord/types` trails Vencord's `main` branch, and its `globals.d.ts` omits the build-time flags. `vencord-globals.d.ts` fills in the ones this plugin uses. If the published types ever disagree with your Vencord, the editor complains but the build is still fine — the build never looks at `@vencord/types`.

To test a change, commit and push it here, then pull it into the Vencord checkout with this plugin's own *Update* button (or `git pull` in `<vencord>/src/userplugins/<this plugin>`).

> [!WARNING]
> Do not copy edited files straight into a clone that already lives in `src/userplugins/`. The copied files show up as uncommitted changes in that clone, so the updater skips it and its *Update* button stays disabled, even after you push the same changes. If that has already happened, discard the copied changes there (`git checkout -- .`) and pull again.
>
> A plain copy (not a git clone) is fine for a quick local test, but the updater cannot update it.

The English and Japanese READMEs are generated with [kiritan](https://www.npmjs.com/package/kiritan). Edit `base/README.base.md`, then run `pnpm readme` to regenerate `README.md` and `README.ja.md`.
