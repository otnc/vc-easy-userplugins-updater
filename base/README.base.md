# UserpluginUpdater

:::kiritan{locale=en}
Update your git-cloned userplugins and rebuild Vencord without leaving Discord.

Vencord ships an updater for itself, but nothing for the plugins you dropped into `src/userplugins`. This plugin does for them what the built-in Updater tab does for Vencord: it finds every git repository under `src/userplugins`, shows what each one is behind by, pulls them, reinstalls dependencies, rebuilds Vencord and offers to restart.

## Requirements

- The **desktop app** (Discord Desktop or Vesktop). The web build has no Node access.
- A **source install** of Vencord (cloned repo + `pnpm build` + `pnpm inject`), not the standalone installer build.
- `git` and `node` reachable from the environment Discord was launched in. `pnpm` too, unless you turn off *Run pnpm install before building*.

## Install

Clone this repository into your Vencord checkout:
:::
:::kiritan{locale=ja}
git clone したユーザープラグインの更新と Vencord の再ビルドを、Discord を離れずに行えます。

Vencord には自分自身を更新する仕組みがありますが、`src/userplugins` に置いたプラグインを更新する仕組みはありません。このプラグインは、組み込みの Updater タブが Vencord に対してやっていることをユーザープラグインに対して行います。`src/userplugins` 以下の git リポジトリをすべて見つけ、それぞれがどれだけ遅れているかを表示し、pull、依存関係の再インストール、Vencord の再ビルドを行ってから再起動を促します。

## 必要なもの

- **デスクトップアプリ** (Discord Desktop または Vesktop)。Web 版からは Node を使えません。
- Vencord の**ソースインストール** (リポジトリを clone して `pnpm build` + `pnpm inject` したもの)。スタンドアロンのインストーラー版では動きません。
- Discord を起動した環境から `git` と `node` を呼べること。*Run pnpm install before building* をオフにしない限り `pnpm` も必要です。

## インストール

このリポジトリを Vencord のチェックアウトに clone します。
:::

```sh
cd <vencord>/src/userplugins
git clone <this repo> userpluginUpdater
cd <vencord>
pnpm build
```

:::kiritan{locale=en}
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
:::
:::kiritan{locale=ja}
Discord を再起動し、設定 → プラグインで **UserpluginUpdater** を有効にします。

初回のビルドだけは手動で行う必要があります。このプラグインのネイティブモジュールは、プラグインを置いた状態で Vencord をビルドして初めて生成されるためです。それ以降はプラグイン自身が再ビルドできます。

> `src/userplugins` へのシンボリックリンクやディレクトリジャンクションでは**動きません**。esbuild がリンクを実体のパスに解決するため Vencord のツリーの外を指すことになり、`@utils/...` のパスエイリアスが解決できなくなります。実体のクローンかコピーを置いてください。

`node_modules/` はコミットしておらず、プラグインのビルドにも不要です。このリポジトリを単体で型チェックするためだけにあります。[開発](#開発)を参照してください。

## 使い方

Discord の設定の Vencord セクションに **Userplugins** という項目が、Vencord Toolbox に *Open Userplugin Updater* というアクションが追加されます。

- **Check for Updates**: すべてのリポジトリで `git fetch` し、それぞれがどれだけ遅れているかを表示します。
- **Update All** / リポジトリごとの **Update**: 以下のパイプラインを実行します。

パイプライン:

1. 選択した各リポジトリで `git pull --ff-only`
2. Vencord のルートで `pnpm install --frozen-lockfile` (省略可能、既定でオン)
3. `node scripts/build/build.mjs` (`pnpm build` が実行するものと同じ)
4. Discord の再起動の確認

`pnpm inject` はあえて再実行しません。これは Discord の `app` フォルダーを書き換えて `dist/` から Vencord を読み込ませるだけで、その状態は再ビルドしても変わらないため、インストールごとに一度実行すれば十分です。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| Check on startup | オン | Discord の起動から約 10 秒後にすべてのリポジトリを fetch します |
| Notify when updates are found | オン | 起動時のチェック後に通知を出します。クリックするとタブが開きます |
| Run pnpm install before building | オン | 依存関係が変わらないならオフにしてください。更新がかなり速くなります |
| Pull mode | fast-forward only | `--ff-only`、`--no-rebase`、`--rebase` のいずれか |
| pnpm command | `pnpm` | Discord の `PATH` に pnpm がない場合は絶対パスを指定してください |

## 知っておきたい挙動

- **未コミットの変更があるリポジトリはスキップされ**、*Update All* も手を付けません。先にコミットするか stash してください。既定の pull モードが fast-forward only なのもこのためです。
- **再ビルドは、少なくとも 1 つのリポジトリが実際に進んだときだけ実行されます。** pull に失敗したリポジトリがあっても他のリポジトリは止まりませんが、ログには表示されます。
- **再起動が必要です。** 起動中の Discord は古い `dist/` をすでにメモリに読み込んでいるため、書き換えてもアプリを再読み込みするまで何も変わりません。
- リポジトリは `src/userplugins` の直下の各フォルダーにある `.git` を探して見つけます。そのフォルダー自体がリポジトリでなければ、もう 1 階層下も探します。ファイルをそのままコピーしただけのプラグインは pull するものがないため更新できません。

## 開発

ユーザープラグインは普通 Vencord のチェックアウトの中で書き、`@utils/...` の import はすべて Vencord 本体のソースに解決されます。このリポジトリは単体でも編集できるように設定してあります。
:::

```sh
pnpm install     # installs @vencord/types and friends, nothing else
pnpm typecheck   # tsc --noEmit
pnpm format      # prettier --write . (Markdown is excluded)
```

:::kiritan{locale=en}
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
:::
:::kiritan{locale=ja}
`tsconfig.json` は Vencord の各エイリアスを 2 回ずつ定義しています。1 つ目がツリー内の相対パス、2 つ目が `@vencord/types` 内のコピーで、TypeScript も esbuild もディスク上に存在する最初のエントリを使います。そのため、この 1 ファイルで両方の状況に対応できます。

| | 解決先 |
| --- | --- |
| このリポジトリを単体で編集するとき | `./node_modules/@vencord/types/...` |
| `src/userplugins/` の中でビルドするとき | `../../utils/...` (Vencord 本体のソース) |

このファイルを触る前に知っておくべきことが 2 つあります。

- esbuild は各ソースファイルから**最も近い** `tsconfig.json` を読み、その `paths` はルートの設定とマージされず完全に置き換わります。このファイルからエイリアスを消すと、このプラグインが直接使っていないエイリアスであっても、Vencord のビルドが壊れます。
- `@vencord/types` は Vencord の `main` ブランチより遅れており、その `globals.d.ts` にはビルド時のフラグが含まれていません。このプラグインが使うものは `vencord-globals.d.ts` で補っています。公開されている型が手元の Vencord と食い違ってもエディターが警告を出すだけで、ビルドは `@vencord/types` を見ないため問題ありません。

変更を試すときは、このリポジトリでコミットして push し、Vencord 側のクローンにはこのプラグインの *Update* ボタン (または `<vencord>/src/userplugins/<このプラグイン>` での `git pull`) で取り込んでください。

> [!WARNING]
> 編集したファイルを、`src/userplugins/` にすでにあるクローンへ直接コピーしないでください。コピーしたファイルはそのクローンの未コミットの変更になるため、同じ変更を push した後でもアップデーターはそのリポジトリをスキップし、*Update* ボタンは押せないままになります。コピーしてしまった場合は、そのクローンで `git checkout -- .` を実行してコピーした変更を捨ててから pull し直してください。
>   
> git のクローンではない単なるコピーなら、ちょっとしたローカルでの動作確認には使えます。ただしアップデーターでは更新できません。

英語版と日本語版の README は [kiritan](https://www.npmjs.com/package/kiritan) で生成しています。`base/README.base.md` を編集してから `pnpm readme` を実行すると、`README.md` と `README.ja.md` が再生成されます。
:::
