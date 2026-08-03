# サーバーデプロイガイド

> Voxel Link サーバーパッケージ（`voxel-link-server-*.zip`、本リポジトリの Releases で配布）向けのドキュメントです。

## 概要

サーバーはスタンドアロンの Node.js プロセスで、以下を提供します：

- **`/ws`** — WebSocket マルチプレイのエンドポイント（ゲームのメインチャネル）
- **`/status`** — HTTP の状態確認。JSON を返します（オンライン / 人数 / ワールド / バージョン）
- **ワールド永続化** — 編集したブロックは `saves/` ディレクトリに自動保存されます

クライアントとサーバーは分離しています。Web クライアントは GitHub Pages や任意の静的サーバーでホストできます。サーバーは `/ws`（と必要に応じて `/status`）を公開するだけで十分です。

## 必要環境

- Node.js 20 以降：<https://nodejs.org>

## インストール

1. リポジトリの **Releases** から `voxel-link-server-v0.6.3.zip` をダウンロードして解凍します（例：`D:\voxel-link-server`）。
2. 初回起動時に `npm install` が自動実行されます（ネットワーク接続が必要）。手動でも実行できます：

   ```powershell
   cd 解凍先ディレクトリ
   npm install
   ```

## 設定（任意）

サーバーは同ディレクトリの `server-config.json` を読み込みます。ファイルが無い場合は組み込みのデフォルト値を使用します。サンプルをコピーして編集します：

```powershell
copy server-config.example.json server-config.json
```

| フィールド | デフォルト | 説明 |
| --- | --- | --- |
| `port` | `3000` | HTTP / WebSocket の待受ポート |
| `host` | `0.0.0.0` | バインド先アドレス（既定は全インターフェース） |
| `maxPlayers` | `4` | 同時接続人数の上限 |
| `password` | `""` | 参加パスワード（空なら不要） |
| `activeWorldSlot` | `1` | 有効なワールドスロット（1–3） |
| `worldSlots` | ワールド名 3 つ | ワールドスロットのディレクトリ名 |
| `dayLengthSeconds` | `1200` | ゲーム内 1 日の長さ（秒） |
| `allowedOrigins` | `[]` | ブラウザ Origin のホワイトリスト（空配列 = すべて許可） |
| `motd` | `Voxel Link` | `/status` と挨拶に表示されるサーバー名 |
| `autosaveSeconds` | `20` | 自動保存の間隔（秒） |

## 起動

`start-server.bat` をダブルクリック（Windows）、またはパッケージのディレクトリで：

```powershell
node server.mjs
```

起動すると、コンソールにローカルアドレスと WebSocket アドレスが表示されます。ワールドスロットの切り替え：

```powershell
node tools/select-world.mjs 1
```

または `select-world.bat` をダブルクリックします。

## 動作確認

- ブラウザで `http://127.0.0.1:3000/status` にアクセスし、JSON が返ることを確認します。
- クライアントのメニューに `ws://127.0.0.1:3000/ws` を入力してローカルでテストします。

## 公開デプロイ

### 方法 A：VPS + リバースプロキシ（推奨）

1. VPS でサーバーを起動します（既定ではポート 3000 で待受）。
2. 前面に Caddy または nginx を置き、TLS を提供して `/ws` を `wss://` にします。

**Caddy の例**（HTTPS 証明書は自動取得・自動更新）：

```
your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

クライアント側のアドレス：`wss://your-domain.com/ws`

**nginx の例**（`Upgrade` ヘッダーが必要）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ""      close;
}
server {
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

### 方法 B：内網トンネル（開発中・友人と遊ぶ場合）

SakuraFrp / FRP で `127.0.0.1:3000` を公開します。公開エントリの HTTPS/WSS はトンネルノードが提供します。詳細はサーバーパッケージ内の **`SAKURAFRP.md`** を参照してください。

## トラブルシューティング

- **ページが HTTPS なのにマルチプレイに接続できない**：HTTPS ページは `wss://` にしか接続できません。`ws://` は使えません。
- **`/status` は見えるが WebSocket に接続できない**：リバースプロキシが WebSocket のアップグレードに対応している必要があります（上記 nginx 設定参照）。
- **参加後すぐ切断される**：パスワード、名前の重複、人数上限、`allowedOrigins` を確認してください。
- **外網から一切アクセスできない**：まずホストマシンで `http://127.0.0.1:3000/status` にアクセスし、次にファイアウォールが Node.js のポートを許可しているか確認してください。
- **ポートが使用中**：`server-config.json` の `port` を変更してください。