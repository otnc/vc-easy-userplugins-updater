# UserpluginUpdater

[English](README.md) | **日本語**

git clone したユーザープラグインの更新と Vencord の再ビルドを、Discord を離れずに行えます。

Vencord には自分自身を更新する仕組みがありますが、`src/userplugins` に置いたプラグインを更新する仕組みはありません。このプラグインは、組み込みの Updater タブが Vencord に対してやっていることをユーザープラグインに対して行います。`src/userplugins` 以下の git リポジトリをすべて見つけ、それぞれがどれだけ遅れているかを表示し、pull、依存関係の再インストール、Vencord の再ビルドを行ってから再起動を促します。

## 必要なもの

- **デスクトップアプリ** (Discord Desktop または Vesktop)。Web 版からは Node を使えません。
- Vencord の**ソースインストール** (リポジトリを clone して `pnpm build` + `pnpm inject` したもの)。スタンドアロンのインストーラー版では動きません。
- Discord を起動した環境から `git` と `node` を呼べること。*Run pnpm install before building* をオフにしない限り `pnpm` も必要です。

## インストール

このリポジトリを Vencord のチェックアウトに clone します。

```sh
cd <vencord>/src/userplugins
git clone <this repo> userpluginUpdater
cd <vencord>
pnpm build
```

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

```sh
pnpm install     # installs @vencord/types and friends, nothing else
pnpm typecheck   # tsc --noEmit
pnpm format      # prettier --write . (Markdown is excluded)
```

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
