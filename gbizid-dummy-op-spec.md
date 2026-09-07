# nobizid 仕様書

ローカル開発用に GBizID（法人共通認証基盤）を模倣する OpenID Provider サーバー。設計思想は
[nognito](https://github.com/takehikokodama/nognito)（Amazon Cognito版）を踏襲: 単一プロセス・
インメモリ状態・秘匿情報なし・公開リポジトリ向け。

一次情報は [GBizID開発者ガイドラインPDF](https://gbiz-id.go.jp/top/manual/pdf/Developer_guideline.pdf)
（「G ビズ ID 接続システム向けガイドライン」2.9版, 2026/7/9）の 3.4.1「OpenID Connectについて」
(本文 p.33-64)。本ドキュメントの各項目は原則としてこの節に基づく。**確認できなかった箇所は「未確認」
と明記**しており、そこは便宜的な実装で埋めている。

## 前提

- Node.js 22+ / TypeScript / Hono / `jose`
- ポート: `7999`（デフォルト）
- 単一プロセス・インメモリ状態（永続化不要）
- 公開リポジトリ向けのため機密情報なし

## エンドポイント一覧

| メソッド | パス | 役割 | 出典 |
|---|---|---|---|
| GET | `/oauth/.well-known/openid-configuration` | Discovery | 便宜的追加（※1） |
| GET | `/oauth/.well-known/jwks.json` | JWKS（公開鍵） | 便宜的パス（※2） |
| GET | `/oauth/authorize` | 認証画面表示 | PDF 3.4.1.2 |
| POST | `/oauth/authorize` | ログイン処理（フォーム送信） | PDF 3.4.1.2 |
| POST | `/oauth/token` | トークン発行（`authorization_code`/`refresh_token`） | PDF 3.4.1.3 / 3.4.1.5 |
| GET | `/oauth/userinfo` | 属性情報取得 | PDF 3.4.1.4 |
| GET | `/logout` | ログアウト | 未確認（※3） |

※1 discoveryの実URLはPDF未記載。ただし本文に「公開鍵は`https://認証基盤のドメイン/oauth/.well-known/openid-configuration`の`jwks_uri`パラメータの値で示される」との記述があり(3.3.3.1参照)、`issuer`(`https://gbiz-id.go.jp/oauth/`)+ `.well-known/openid-configuration` という標準OIDC Discovery仕様どおりの組み立てになっている。本実装も`issuer`からこの規則で導出している。
※2 `jwks_uri`の実際の値はPDFに記載なし。discoveryドキュメント内で示される想定のため、便宜的に`{issuer}.well-known/jwks.json`とした。
※3 ログアウトエンドポイントの記載はPDF内に見つからなかった。nognito同様の便宜的な実装。

## 接続情報の例

```
GBIZID_ISSUER=http://localhost:7999/oauth/
GBIZID_CLIENT_ID=local-client-id
GBIZID_CLIENT_SECRET=local-client-secret
GBIZID_REDIRECT_URI=http://localhost:3000/callback
```

## authorize（PDF 3.4.1.2）

`GET /oauth/authorize`

| パラメータ | 必須 | 備考 |
|---|---|---|
| `response_type` | ○ | `code` のみ |
| `client_id` | ○ | 固定値と一致確認 |
| `redirect_uri` | - | 省略時は`GBIZID_REDIRECT_URI`。指定時は完全一致必須 |
| `scope` | - | 下記参照。**省略時は基本スコープ＋事前申請済みオプションスコープが自動付与される**（PDFに明記された現行仕様、将来廃止予定） |
| `state` / `nonce` | 推奨 | そのままコールバック/id_tokenに反映 |
| `code_challenge` / `code_challenge_method` | 推奨 | PKCE。指定する場合`S256`のみ許可（**必須ではない**。nognitoはS256必須だったが本実装では任意） |
| `prompt=login` | - | 再認証強制（本実装は常にログインフォームを出すため実質的に無視） |
| `login_hint` | - | ログインフォームのアカウントIDに事前入力 |

エラー（`redirect_uri`へリダイレクト、`error`/`error_description`/`state`/`scope`付き）: `invalid_request`, `access_denied`(未実装/該当ケースなし), `invalid_scope`, `unsupported_response_type`。
`invalid_grant`（redirect_uri不一致）と`invalid_client`（client_id不正）は**リダイレクトせず**エラーページを表示。

ログイン成功時: `{redirect_uri}?code={22桁英数字}&state=...` へ302。**認可コードの有効期限は5分**。

## token（PDF 3.4.1.3 / 3.4.1.5）

`POST /oauth/token`、`Authorization: Basic base64(client_id:client_secret)`（`client_secret_basic`）。

### `grant_type=authorization_code`
`code`, `redirect_uri`（必須）、`code_verifier`（`code_challenge`指定時のみ必須）。

### `grant_type=refresh_token`
`refresh_token`（必須）、`scope`（省略時は元の付与scope全て。指定時は元のscopeの部分集合かつ`openid`必須）。

### レスポンス
`access_token`（RS256署名JWT）, `token_type=Bearer`, `refresh_token`（`offline_access`指定時のみ発行／refresh時は毎回ローテーション）, `expires_in=3600`, `scope`, `id_token`（RS256署名JWT）。

**access_tokenクレーム**: `sub`, `azp`(=client_id), `iss`, `exp`, `iat`, `jti`。scopeクレームは含まない（PDFのサンプルどおり）。
**id_tokenクレーム**: `sub`, `aud`(=client_id), `iss`, `exp`, `iat`, `auth_time`, `nonce`, `jti`。**氏名・メールアドレス等の個人情報は一切含めない**（PDF 3.3.3.3に明記された方針）。
**refresh_tokenの形式**: 署名なし疑似JWT `{"alg":"none"}.{"exp":...,"jti":...}.`（PDFのサンプルと同一形式を再現）。

### エラー
| コード | HTTP | 説明 |
|---|---|---|
| `unauthorized` | 401 | クライアント認証不可 |
| `invalid_request` | 400 | パラメータ不正 |
| `invalid_grant` | 400 | 認可コード/redirect_uriが不正 |
| `unsupported_grant_type` | 400 | 未対応のgrant_type |
| `invalid_token`（refresh時） | 401 | リフレッシュトークンが不正・期限切れ |
| `invalid_scope`（refresh時） | 401 | 要求scopeが元の付与範囲外 |

## userinfo（PDF 3.4.1.4）

`GET /oauth/userinfo`、`Authorization: Bearer {access_token}`。

エラー: `invalid_token`(401), `insufficient_scope`(403)。

### スコープ一覧（PDF 3.4.1.2 Scope一覧 + 3.4.1.4 属性取得リクエスト）

| scope | 必須申請 | UserInfoで解放されるキー |
|---|---|---|
| `openid` | 不要 | `sub` |
| `profile` | 不要 | `account_type`, `corp_type`, `parent_id`(メンバーのみ), `corporate_number`, `name`, `en_name`, `prefecture_name`, `address1`, `address2`, `rep_last_nm`, `rep_first_nm`, `rep_last_nm_kana`, `rep_first_nm_kana`, `birthday_ymd` |
| `user` | 不要 | `user_last_nm`, `user_first_nm`, `user_last_nm_kana`, `user_first_nm_kana`, `user_post_code`, `user_prefecture_name`, `user_address1/2/3`, `user_department`, `user_tel_no_contact`, `user_birthday_ymd` |
| `mandate` | 不要 | `mandate_info: [{client_id}]` |
| `email` | 不要 | `user_email`（非推奨）, `email` |
| `offline_access` | 不要 | (refresh_token発行のトリガーのみ) |
| `jp_gbizid_v1_ida` | **要事前申請** | `verified_claims`（本人確認情報） |
| `role` | **要事前申請** | `role`（組織情報） |
| `delegation_info` | **要事前申請** | `delegation_info`（委任情報） |

`account_type`: `1`=gBizIDエントリー, `2`=gBizIDプライム, `3`=gBizIDメンバー。
`corp_type`: `1`=法人, `2`=個人事業主。

### `verified_claims`（`jp_gbizid_v1_ida`, PDF [1]審査情報のレスポンス詳細）

アカウント種別・事業形態で構造が変わる。`users.yaml`にはこの4パターンの実例を同梱している:

- **gBizIDエントリー**: `assurance_level=ial1`。`time`/`assurance_process`は返却しない。`claims: {}`。
- **gBizIDプライム・法人**: `assurance_level=ial2`, `assurance_process.procedure`は`jp_gbizid_document_corporation`/`jp_gbizid_online_corporation`/`jp_gbizid_one_stop_service`のいずれか。`claims`に`family_name,given_name,birthdate,authority.applies_to.registration_number,authority.permission:[{role:"prime"}]`。
- **gBizIDプライム・個人事業主**: `procedure`は`jp_gbizid_document_sole_proprietorship`/`jp_gbizid_online_sole_proprietorship`。`claims`に`family_name,given_name,birthdate,address{...,country:"JP"}`（`authority`は含まない）。
- **gBizIDメンバー**: `procedure=jp_gbizid_member`。`claims`は`authority.applies_to.registration_number,authority.permission:[{role:"member"}]`のみ（氏名・生年月日は含まない）。

### `role`（PDF [2]組織情報のレスポンス詳細）

`applies_to.levels[{level,branch_name}]`（所属組織階層）、`permission[{role}]`。`role`固定値: `jp_gbizid_prime`（プライム）/ `jp_gbizid_administrator`（管理者）/ `jp_gbizid_member`（一般メンバー）。エントリーは`{}`。

### `delegation_info`（PDF [3]委任情報のレスポンス詳細）

代理人ログイン中の委任情報。エントリー、または代理人ログイン設定なしの場合は`{}`。フィールド一覧は`users.yaml`のsuzukiユーザーの例を参照。

## 実装上の意図的な差分・簡略化

- **access_tokenのscope管理**: 実際のGBizIDのaccess_tokenにはscopeクレームが含まれないが（PDFのデコード例で確認）、UserInfoでどのscopeを返すか判定する必要があるため、本実装ではサーバー内のインメモリストアに`access_tokenのjti → 付与scope`を保持し、UserInfo呼び出し時にそこから引いている。実際のGBizIDもサーバー側セッション相当の仕組みで同様のことをしていると推測される。
- **PKCE**: PDFでは「セキュリティの観点から設定することが推奨される」＝任意。本実装も`code_challenge`が指定された場合のみ検証する（nognitoはS256を必須にしていたが、本実装ではGBizIDの実仕様に合わせて任意にした）。
- **discoveryとJWKSの実URL**: 上記の通りPDFに明記がないため、標準的なOIDC Discoveryの規則から導出した便宜的なパスを使用している。
- **委任情報取得API（PDF 3.4.2）・委任区分設定API（PDF 3.4.3）は未実装**: これらはOAuthのBearerトークンではなく`client_key`/`client_token`による別建てのREST APIで、UserInfoの`delegation_info`/`role`スコープとは別物。本ダミーOPの主目的（OIDCログイン＋UserInfo）の範囲外としてスコープアウトした。
- **ログアウトエンドポイント**: PDFに記載が見つからなかったため、nognito同様の便宜的な`/logout`（`logout_uri`へリダイレクト）を用意した。

## ユーザー定義ファイル (`users.yaml`)

`GBIZID_USERS_FILE`環境変数で指定（既定は`./users.yaml`）。トップレベルに`users`配列を持つYAML。
各要素の`username`/`password`/`sub`/`account_type`/`corp_type`/`email`は必須。`profile`/`user`/
`mandate_info`/`verified_claims`/`role`/`delegation_info`はUserInfoレスポンスにそのまま反映される
（コード側で構造を検証・加工しない）ので、上記の`verified_claims`の条件分岐などは書く側が正しい形に
する必要がある。ファイルが存在しない・不正な場合は組み込みの2ユーザー（`operator`/`admin`）に
フォールバックする。

## 制限事項

- `refresh_token`・`access_token`のグラント情報はインメモリのみで、プロセス再起動で消える。
- 単一クライアント（`GBIZID_CLIENT_ID`/`GBIZID_CLIENT_SECRET`/`GBIZID_REDIRECT_URI`固定）のみ対応。複数RPの模擬はできない。
- 委任情報取得API・委任区分設定API（PDF 3.4.2/3.4.3）は未実装。
- HTTPS不要（ローカル開発専用）。
