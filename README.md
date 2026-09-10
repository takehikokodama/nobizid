# nobizid

ローカル開発用の GBizID（法人共通認証基盤）互換ダミー OpenID Provider。GBizID の
Authorization Code フロー・UserInfo エンドポイントを模倣し、実際の RP 実装をローカルで
テストできるようにする。[nognito](https://github.com/takehikokodama/nognito)（Amazon
Cognito版の同種ツール）と同じ設計思想（単一プロセス・インメモリ・秘匿情報なし）。

詳しい仕様と、GBizID実仕様との対応・差分は [gbizid-dummy-op-spec.md](./gbizid-dummy-op-spec.md) を参照。

## セットアップ

前提: Node.js 22+, pnpm。

```bash
pnpm install
pnpm dev
```

`http://localhost:7999` で起動する。

Docker:
```bash
docker compose up --build
```

`main`へのpush時にGitHub ActionsがDockerイメージをGHCRへ自動publishする。ビルドせずに直接pullして起動することも可能:
```bash
docker pull ghcr.io/takehikokodama/nobizid:latest
docker run -d --name nobizid -p 7999:7999 ghcr.io/takehikokodama/nobizid:latest
```

イメージには`users.yaml`のデフォルト4ユーザーが同梱されている（`yamada`/`tanaka`/`suzuki`/`sato`、
パスワードはいずれも`password`）。自分の`users.yaml`を使いたい場合はボリュームマウントで上書きする:
```bash
docker run -d --name nobizid -p 7999:7999 \
  -v $(pwd)/users.yaml:/app/users.yaml \
  ghcr.io/takehikokodama/nobizid:latest
```

起動確認:
```bash
curl http://localhost:7999/oauth/.well-known/openid-configuration
```

## 設定（環境変数）

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PORT` | `7999` | 待受ポート |
| `GBIZID_ISSUER` | `http://localhost:${PORT}/oauth/` | `iss`・discoveryの基準URL（末尾スラッシュ必須） |
| `GBIZID_CLIENT_ID` | `local-client-id` | 固定クライアントID |
| `GBIZID_CLIENT_SECRET` | `local-client-secret` | 固定クライアントシークレット |
| `GBIZID_REDIRECT_URI` | `http://localhost:3000/callback` | 許可するコールバックURL（完全一致） |
| `GBIZID_USERS_FILE` | `./users.yaml` | ユーザー定義YAMLのパス |
| `GBIZID_GRANTED_OPTIONAL_SCOPES` | `jp_gbizid_v1_ida,role,delegation_info` | 「事前申請済み」として扱うオプションスコープ |

## ユーザーを自由に定義する

[users.yaml](./users.yaml) にログイン候補ユーザーとその属性（UserInfoで返す値）を定義する。
gBizIDプライム（法人／個人事業主）・gBizIDメンバー・gBizIDエントリーの4パターンを実例として
同梱しているので、コピーして書き換えるだけで新しいユーザーを追加できる。編集後はサーバーを
再起動すること。

## エンドポイント

| メソッド | パス |
|---|---|
| GET | `/oauth/.well-known/openid-configuration` |
| GET | `/oauth/.well-known/jwks.json` |
| GET/POST | `/oauth/authorize` |
| POST | `/oauth/token` |
| GET | `/oauth/userinfo` |
| GET | `/logout` |
| GET | `/admin/logins` |

## ログイン履歴画面

`http://localhost:7999/admin/logins` で、直近のセッション(既定5件、`?limit=N`で変更可、最大20件
保持)を確認できる。「セッション」は`GET /oauth/authorize`を起点に、ログイン成功・失敗の試行、
`POST /oauth/token`（`authorization_code`/`refresh_token`）、`GET /oauth/userinfo`までをひとまとめ
にしたもので、パスワード間違いや`invalid_grant`、不正なBearerなど**失敗した試行も記録される**。

一覧の行をクリックすると詳細が展開し、以下を確認できる:
- Authorization Request〜UserInfoまでの時系列タイムライン（各ステップのパラメータ・JWTクレーム・
  エラー内容）
- サマリー（所要時間・client_id・最終結果・client認証方式・PKCE有無）
- 整合性チェック（state一致・nonce一致・PKCE検証・redirect_uri一致・id_tokenのaud/iss/exp）

RP側の実装を繋ぎ込む際、どのステップでどんなパラメータが送られ、失敗した場合はどこで崩れたかを
1画面で追える。認証なし・手動リロード・インメモリ（再起動で消える）。

## テスト用RP (rp-sample)

[rp-sample/](./rp-sample) に、scope選択・PKCE on/off・scope省略などを画面から切り替えて試せる
テスト用RPを同梱している。ログイン成功時にはid_tokenのクレームとUserInfoのレスポンス全文を表示する。

```bash
pnpm --filter rp-sample dev   # http://localhost:3000
```

rp-sampleはDockerイメージには含まれないため、リポジトリをclone/pullして`pnpm install`した状態で
起動する。rp-sampleの既定値（`GBIZID_ISSUER=http://localhost:7999/oauth/`、
`GBIZID_REDIRECT_URI=http://localhost:3000/callback`）は上記の`docker run`の既定設定とそのまま
一致するため、GHCRから起動したコンテナに対しても環境変数の設定なしで接続できる。

詳細は [rp-sample/README.md](./rp-sample/README.md) を参照。

## テスト

```bash
pnpm dev              # 別ターミナルで起動しておく
pnpm smoke-test       # authorize→token→userinfo→refreshのE2E確認
pnpm typecheck
```

## 制限事項

- 単一クライアント固定（複数RPの模擬は不可）
- 委任情報取得API・委任区分設定API（GBizID PDF 3.4.2/3.4.3）は未実装
- インメモリ状態のみ（再起動で消える）

詳細は [gbizid-dummy-op-spec.md](./gbizid-dummy-op-spec.md) の「実装上の意図的な差分・簡略化」を参照。

## ライセンス

[MIT](./LICENSE)
