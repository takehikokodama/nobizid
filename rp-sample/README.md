# rp-sample

nobizid（GBizIDダミーOP）に接続する最小構成のテスト用RP（Relying Party）です。ログイン・
コールバック・ログアウトまでのOIDC Authorization Codeフローを、nobizidルートの環境変数の
既定値だけでそのまま試せます。

画面から以下を切り替えて、色々なOIDCパターンを試せます:

- 要求する **scope** の選択（`openid`は常時必須、GBizID固有の`jp_gbizid_v1_ida`/`role`/
  `delegation_info`は「要事前申請」バッジ付き）
- **scopeパラメータ自体を送信しない** トグル（nobizidの「省略時は基本+事前申請済みオプション
  scopeが自動付与される」仕様を確認できる）
- **PKCE（code_challenge / S256）を使うかどうか** のトグル（nobizidはPKCEを必須にしていない
  ため、オフでもログインできることを確認できる）
- `login_hint`（任意）

ログインに成功すると、`id_token`のクレーム（個人情報を含まない設計になっていることが確認
できる）と、`/oauth/userinfo`から取得した実際のレスポンス全文を画面に表示します。

## 起動方法

ルートディレクトリ（`nobizid/`）でまとめて依存をインストールします（pnpmワークスペースの
メンバーです）。

```bash
pnpm install
pnpm dev                       # nobizid本体を :7999 で起動（別ターミナル）
pnpm --filter rp-sample dev    # rp-sampleを :3000 で起動
```

`rp-sample`ディレクトリ内で直接 `pnpm dev` を実行しても構いません。

## 使い方

1. ブラウザで `http://localhost:3000/` を開く
2. scope・PKCE・login_hintを好みの組み合わせに設定して「ログイン」
3. nobizidのログインフォームで `users.yaml` に定義されたアカウント（例: `yamada` / `password`）でログイン
4. `http://localhost:3000/callback` に戻り、id_tokenのクレームとUserInfoのレスポンスが表示される
5. 「ログアウトして別の設定で試す」からnobizidの`/logout`を経由してログアウトし、別の設定で試せる

nobizid側の `http://localhost:7999/admin/logins` を開くと、ここで行ったログインが要求scope・
PKCE有無・token交換履歴つきで記録されているのが確認できます。

## 実装している検証

- PKCE（任意。オンの場合のみ`code_verifier`/`code_challenge`を生成）
- `state`の検証（コールバック時に発行時の値と一致するか確認）
- `nonce`の検証（id_token内のnonceと発行時の値が一致するか確認）
- `id_token`の署名検証（nobizidのJWKSを使用、`jose`の`createRemoteJWKSet`）
- `/oauth/userinfo`への実際のリクエストとレスポンス表示

セッションはメモリ上の`Map`（cookieの`sid`をキーに保持）で管理しており、永続化はしていません。

## 環境変数

| 変数名 | 既定値 |
|---|---|
| `PORT` | `3000` |
| `GBIZID_ISSUER` | `http://localhost:7999/oauth/`（nobizid本体の既定`GBIZID_ISSUER`と一致） |
| `GBIZID_CLIENT_ID` | `local-client-id` |
| `GBIZID_CLIENT_SECRET` | `local-client-secret` |
| `GBIZID_REDIRECT_URI` | `http://localhost:3000/callback`（nobizid本体の既定`GBIZID_REDIRECT_URI`と一致） |
| `GBIZID_LOGOUT_URI` | `http://localhost:3000/`（ログアウト後に戻る先） |

nobizid本体の設定（`GBIZID_CLIENT_ID`など）を変更した場合は、同じ値をこちらにも設定してください。
