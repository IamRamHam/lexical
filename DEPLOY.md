# Lexicalの公開と更新

GitHub Pagesで学習画面を公開し、Googleでログインした人の学習記録をSupabaseに保存します。同じGoogleアカウントでログインすると、別のブラウザーや端末でも学習を続けられます。ログインは任意です。

以下ではリポジトリ名を **lexical** とします。例に出てくる **OWNER** は実際のGitHubユーザー名、**PROJECT_REF** は作成したSupabaseプロジェクトの識別子に置き換えてください。GitHub Pagesが表示したURLを設定先に使います。

## 1. GitHub Pagesでゲスト版を公開する

1. GitHubにログインし、[GitHub Desktop](https://desktop.github.com/)をWindowsに用意します。GitHub Desktopの `File → Add local repository` から、`Lexicalを起動.cmd` がある `lexical` フォルダーを開きます。 [既存フォルダーを開く公式手順](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop?platform=windows)
2. `Changes` が表示されたら、登録されるファイルを確認し、概要に `Initial Lexical release` などを入力して `Commit to main` を押します。`data/release/site-data.json.gz` と `.github/workflows/pages.yml` が対象に含まれることを確認してください。圧縮原本、`.env`、`node_modules`、ビルド済みの `dist` はGitの除外設定に入っています。コミットのメール公開範囲は、GitHubの `Settings → Emails` で確認できます。 [メールアドレスの公開範囲](https://docs.github.com/en/account-and-profile/concepts/email-addresses)
3. `Publish repository` を押し、名前を `lexical` にします。GitHub FreeでPagesを使う場合は `Keep this code private` を外して公開リポジトリにします。このリポジトリを公開すると、ソースと公開用の単語データを閲覧できるようになります。 [リポジトリ公開の公式手順](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop?platform=windows) · [GitHub Pagesを使えるプラン](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
4. GitHub上のリポジトリで `Settings → Pages → Build and deployment → Source` を開き、**GitHub Actions** を選びます。同梱のワークフローを使います。 [公開元の設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
5. `Actions → Publish Lexical to GitHub Pages → Run workflow` で `main` を選び、実行します。最初のPushがPages設定前に走った場合も、この手動実行で公開を開始できます。実行が成功したら `Settings → Pages → Visit site` で開きます。通常のURLは `https://OWNER.github.io/lexical/` です。まずゲストで1問解き、再読み込み後の保存、スマートフォンの表示、発音を確認します。 [カスタムワークフローの公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

### コマンドで公開する場合

GitHub上で空の公開リポジトリ `lexical` を作成します。画面の初期化オプションは未選択にし、既存ファイルを含むPC側から最初にPushします。PowerShellは `lexical` フォルダーで開きます。すでにコミットがある場合は状態を確認してから、未コミットの手順だけを実行してください。

```powershell
git status
git add .
git diff --cached --name-only
git commit -m "Initial Lexical release"
git remote add origin "https://github.com/OWNER/lexical.git"
git push -u origin main
```

Gitの認証画面が表示されたら、ご自身のアカウントで操作してください。接続済みの `origin` には既存の設定を使います。 [既存コードをGitHubへ追加する手順](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github?platform=windows)

## 2. Supabaseに保存先を作る

1. [Supabase Dashboard](https://supabase.com/dashboard)で新しいプロジェクトを作成します。少人数で試す間はFreeプランを選べます。利用が少ないとプロジェクトが一時停止する場合があり、そのときはダッシュボードから再開します。 [無料プロジェクトの一時停止](https://supabase.com/docs/guides/platform/free-project-pausing)
2. 対象のプロジェクトで `SQL Editor → New query` を開き、[初期SQL](supabase/migrations/202611240001_lexical.sql)の内容全体を貼って **Run** を1回押します。既に適用したプロジェクトではこの初期SQLの再実行は不要です。テーブル、行レベルセキュリティ（RLS）、ログイン中の本人だけが使える保存用関数が作成されます。Lexicalの保存にはSupabaseのData APIを使用します。 [権限とRLSの公式説明](https://supabase.com/docs/guides/api/securing-your-api)
3. ダッシュボードの `Connect` または `Settings → API Keys` で **Project URL** と **Publishable key** を控えます。公開側で使うキーは `sb_publishable_…` です。データベースのパスワードと `sb_secret_…`／`service_role` は管理用に保管します。 [公開用と管理用のAPIキー](https://supabase.com/docs/guides/getting-started/api-keys)
4. `Authentication → URL Configuration` で **Site URL** を実際の公開URL（例 `https://OWNER.github.io/lexical/`）にします。**Redirect URLs** にも同じURLを登録します。PC版のゲスト記録を取り込む場合やローカルで動作確認する場合は `http://127.0.0.1:4173/` も追加します。リポジトリ名のパスと末尾の `/` まで一致させます。 [SupabaseのリダイレクトURL](https://supabase.com/docs/guides/auth/redirect-urls)

## 3. Googleログインを設定する

1. [Google Cloud](https://console.cloud.google.com/)で自分のプロジェクトを作成し、[Google Auth Platform](https://console.cloud.google.com/auth/overview)を開きます。`Branding` でアプリ名を **Lexical** にし、サポート・連絡用メールを指定します。ホームページには公開したLexicalのURL、プライバシーポリシーには `https://OWNER.github.io/lexical/privacy.html` を使えます。公開するページの案内文や運営者への連絡方法は `public/privacy.html` にあります。 [Googleのブランド設定・確認](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
2. `Audience` で **External** を選びます。招待リストを使わずに運用するときは、公開段階を **In production** にします。`Data Access` ではGoogleの基本プロフィールに必要な `openid`、`email`、`profile` に絞ります。ブランド確認を求められた場合は、画面の案内に沿って登録情報とドメインを確認してください。 [Googleのテスト・本番状態の違い](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
3. Supabaseの `Authentication → Sign In / Providers → Google` を開き、表示される **Callback URL** を控えます。
4. Google Auth Platformの `Clients → Create client → Web application` で、次の値を登録して作成します。

   | Googleの欄 | 設定する値 |
   | --- | --- |
   | 承認済みのJavaScript生成元 | `https://OWNER.github.io`。ホストまで入力し、`/lexical/` は含めません |
   | 承認済みのリダイレクトURI | Supabaseに表示されたCallback URL。通常は `https://PROJECT_REF.supabase.co/auth/v1/callback` |

5. 発行された **Client ID** と **Client Secret** をSupabaseのGoogleプロバイダー画面に入力し、Googleを有効にして保存します。Client Secretはこのプロバイダー設定で管理します。 [SupabaseのGoogleプロバイダー設定](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)

Googleに登録するリダイレクトURIは、認証を受け取るSupabaseのURLです。ブラウザーを最終的に戻すLexicalのURLは、手順2のSupabase側に登録します。

## 4. GitHub PagesとSupabaseをつなぐ

GitHubのリポジトリで `Settings → Secrets and variables → Actions → Variables → New repository variable` を開き、次の値を登録します。サイトから読み込む公開用の値です。 [GitHubのリポジトリ変数](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables#creating-configuration-variables-for-a-repository)

| 名前 | 値 |
| --- | --- |
| `LEXICAL_SUPABASE_URL` | SupabaseのProject URL |
| `LEXICAL_SUPABASE_PUBLISHABLE_KEY` | SupabaseのPublishable key |
| `LEXICAL_PHONETIC_URL` | 公開済みのPhoneticのURL。公開先がある場合に追加 |

変数を登録したら `Actions → Publish Lexical to GitHub Pages → Run workflow` を `main` で実行します。公開版を再読み込みし、`設定 → Googleでログイン` を選びます。PhoneticのURLを登録するとヘッダーにリンクが表示されます。Lexicalの単語を読み上げる音声は同梱しています。

## 5. 公開版の動作を確認する

1. ログイン前にゲストで1問正解し、`今日の学習` が増えることを確認します。同じブラウザーでGoogleログインして再読み込みし、その記録を引き継げることを確認します。
2. 同じGoogleアカウントを別のブラウザーで使い、学習記録と途中のセットが見えることを確認します。
3. 別のブラウザープロファイルで異なるGoogleアカウントを使い、最初のアカウントの進捗や苦手タグが出ないことを確認します。
4. スマートフォンからも公開URLを開き、Googleから戻ったときにそのアカウントで学習できることを確認します。

PCの `http://127.0.0.1:4173/` で作ったゲスト記録を移す場合は、まずPCの `.env.example` を `.env` にコピーし、同じSupabaseのProject URLとPublishable keyを記入して `pnpm build` を実行します。同じアドレス・同じブラウザーでLexicalを起動し、そこで一度Googleログインしてください。その後、公開URLで同じGoogleアカウントを使えば記録を共有できます。ゲストの保存先はアドレスごとに分かれています。

## 日常の修正と再公開

PCの `lexical` フォルダーを編集し、確認してからコミットします。`main` にPushすると、GitHub Actionsがビルド、検査、自動テストを行い、通った `dist` を公開します。Pull Requestでは検査まで実行します。設定変数だけを変えたときは手動でワークフローを実行します。公開済みの変更を戻す場合は対象のコミットをRevertし、その取り消しコミットをPushします。 [GitHub Pagesの公開ワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

```powershell
pnpm build
pnpm check
pnpm test
```

| 変更するもの | 編集先・操作 |
| --- | --- |
| ヘッダーとフッターのロゴ | `public/lexical-logo.png` を差し替えます。現行は640×152ピクセルの透過PNGです。比率やファイル名も変える場合は `public/index.html` のヘッダー・フッター両方の `img` を更新します |
| ブラウザーのタブに出るアイコン | `public/book.svg`。別名のファイルに変更する場合は `public/index.html` と `public/privacy.html` の `rel="icon"` を更新します |
| 配色・余白・ロゴの表示幅 | `public/style.css` |
| 学習画面や動き | 主に `src/views.mjs`、`src/main.mjs`、`src/study.mjs` |
| 単語データ | PCに保持した原本を更新し、`pnpm data:release` を実行して公開用データを再生成します |
| DBの構造 | `supabase/migrations/` に変更用SQLを追加し、本番での適用を確認してから、依存する画面を公開します |

ロゴを差し替えたら `pnpm build` で公開用ファイルが更新されます。PC版は `Lexicalを起動.cmd` で開き、すでに開いている場合は再読み込みします。外観だけの変更ならSupabaseやGoogleの設定操作は不要です。

単語原本の差し替えは、元ファイルを別に保管し、PCで `node scripts/import-source.mjs "原本.jsonのパス" "Phoneticフォルダーのパス"` を実行します。その後 `pnpm data:release`、`pnpm build`、`pnpm check`、`pnpm test` を実行し、`data/release/site-data.json.gz` と `data/source/original.sha256` をコミットします。単語IDは保存済みの学習記録に紐づくので維持してください。GitHubには表示・採点・出典に必要な生成データを載せます。

## うまくいかないとき

- **Googleでログインが表示されない** — GitHub側の2変数とワークフローの完了を確認し、公開版の設定を開き直します。
- **Googleの `redirect_uri_mismatch`** — Googleの承認済みリダイレクトURIをSupabaseに表示されたCallback URLと照合します。
- **Googleから戻るURLが違う** — SupabaseのSite URLとRedirect URLsの `/lexical/` を確認します。 `localhost` と `127.0.0.1` は別のアドレスとして扱います。
- **ログインできるが読み込みや保存に失敗する** — 初期SQLを対象プロジェクトに適用したか、Data APIが有効か、プロジェクトが稼働中かを確認します。
- **ロゴだけ古い** — `public` を変更したことと最新Pushのデプロイ成功を確認し、強制再読み込みを試します。

公開用の単語データには出典・使用版・改変区分を付けています。Wiktionary・NGSL・TSL由来の翻案部分はCC BY-SA 4.0を引き継ぎ、WordNetや音声関連の表示は各ライセンスに従います。サイトの「出典・ライセンス」から確認できます。 [Wiktionary](https://en.wiktionary.org/wiki/Wiktionary:Copyrights) · [NGSL](https://www.newgeneralservicelist.com/new-general-service-list) · [TSL](https://www.newgeneralservicelist.com/toeic-service-list) · [WordNet](https://wordnet.princeton.edu/license-and-commercial-use)
