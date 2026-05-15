# メール管理システム セットアップガイド

## 必要なもの
- Docker Desktop for Windows（推奨）

## 起動方法

```bash
# 1. .env ファイルを作成
copy backend\.env.example backend\.env

# 2. .env を編集（ANTHROPIC_API_KEY を必ず設定）
notepad backend\.env

# 3. ビルドして起動（初回は数分かかります）
docker-compose up -d --build

# 4. ブラウザでアクセス
# このPC:          http://localhost
# 社内他のPC:      http://192.168.x.x  （このPCのIPアドレス）
# APIドキュメント: http://localhost/docs
```

### このPCのIPアドレスを調べる方法
```
ipconfig
# → IPv4 アドレスの値 (例: 192.168.1.10)
```

社内の他のスタッフは `http://192.168.1.10`（実際のIP）をブラウザで開くだけでアクセスできます。

### 停止・再起動
```bash
docker-compose down      # 停止（データは保持）
docker-compose up -d     # 再起動
docker-compose down -v   # 停止＋データ完全削除
```

---

## 方法2: ローカル環境で起動

### バックエンド

```bash
cd backend

# 仮想環境作成
python -m venv venv
venv\Scripts\activate   # Windows

# 依存関係インストール
pip install -r requirements.txt

# .env 作成・編集
copy .env.example .env
notepad .env

# 起動（PostgreSQL が起動している前提）
uvicorn app.main:app --reload --port 8000
```

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

---

## .env 設定項目

| 項目 | 説明 |
|------|------|
| `DATABASE_URL` | PostgreSQL接続URL |
| `SECRET_KEY` | JWT署名キー（ランダムな長い文字列に変更） |
| `ANTHROPIC_API_KEY` | Claude APIキー（必須） |
| `POLL_INTERVAL_MINUTES` | IMAPポーリング間隔（分）デフォルト5 |
| `FIRST_ADMIN_USERNAME` | 初期管理者ユーザー名 |
| `FIRST_ADMIN_PASSWORD` | 初期管理者パスワード（必ず変更） |
| `FIRST_ADMIN_EMAIL` | 初期管理者メールアドレス |

---

## 初期設定手順

1. **ログイン** — `FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` でログイン

2. **ラベル作成** — 「ラベル管理」からメーカー名・カテゴリ等のラベルを作成
   - 例: `山田製作所`（種類: メーカー）、`受注`（種類: カテゴリ）

3. **メールアカウント追加** — 「メールアカウント」からIMAP設定を登録
   - 接続テストで確認後、「今すぐ取得」で初回取得

4. **転送ルール設定** — 「転送ルール」からラベルと転送先を紐付け
   - 例: ラベル「受注」→ `order@example.com`
   - 件名テンプレート例: `[受注]{manufacturer} {subject}`

5. **Power Automate Desktop 連携**
   - PADで転送先メールアドレスの受信をトリガーとするフローを作成
   - 件名のパターン（例: `[受注]`）でフィルタリング
   - メール本文のAI要約・キー情報を使って自動入力処理を組む

---

## システム構成

```
IMAP受信
  ↓
AI解析 (Claude API)
  ├─ メーカー特定
  ├─ カテゴリ分類
  ├─ 優先度判定
  └─ 要約生成
  ↓
ラベル自動付与
  ↓
転送ルール判定
  ↓
SMTP転送（件名カスタマイズ済み）
  ↓
Power Automate Desktop トリガー発動
  ↓
自動入力処理完了
```

---

## API ドキュメント

起動後 http://localhost:8000/docs でSwagger UIが確認できます。
