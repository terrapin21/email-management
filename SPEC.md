# メール管理システム 仕様書

最終更新: 2026-05-22

---

## 1. システム概要

社内に届くメール（主にメーカーからの回収依頼等）を自動的に受信・AI解析・分類し、添付書類からデータを抽出してExcelに書き込み、Power Automate Desktop（PAD）と連携して業務システムへの入力を自動化するシステム。

### アクセスURL

| 環境 | URL |
|------|-----|
| 社内LAN | http://192.168.2.125 |
| 外部（どこからでも） | https://sys.yskmail.jp |

---

## 2. インフラ構成

### サーバーPC
- OS: Windows 11 Home
- WSL2 (Ubuntu) 内で Docker を直接運用（Docker Desktop不使用）
- プロジェクトパス（WSL内）: `~/email-management`

### Docker Compose 構成

```
nginx (Port 80)
├── frontend  (React/Vite)
├── backend   (FastAPI/Python)
└── db        (PostgreSQL 16)
```

### 自動起動設定（タスクスケジューラ）

| タスク名 | 内容 | トリガー |
|----------|------|----------|
| DockerAutoStart | WSL2内Dockerを自動起動 | スタートアップ時 |
| CloudflaredTunnel | Cloudflare Tunnelを自動起動 | スタートアップ時 |
| NAS同期 | sync_nas.vbs を実行（1分ごと繰り返し） | ログオン時 |

### Cloudflare Tunnel
- ドメイン: yskmail.jp（エックスサーバー取得・Cloudflare DNS管理）
- トンネルID: 538ebfc6-f78f-48e7-92c1-ca7707149286
- 設定ファイル: `C:\Users\PC\.cloudflared\config.yml`

---

## 3. 技術スタック

| 区分 | 技術 |
|------|------|
| バックエンド | FastAPI (Python 3.12) |
| フロントエンド | React + TypeScript + Vite + Tailwind CSS |
| データベース | PostgreSQL 16 |
| AI | Claude Haiku (`claude-haiku-4-5-20251001`) |
| スケジューラ | APScheduler（5分ごとにメールポーリング） |
| NAS連携 | robocopy（Windows） |
| 外部公開 | Cloudflare Tunnel |

---

## 4. 主要機能

### 4-1. メール受信・AI解析

APSchedulerが5分ごとに全アクティブアカウントのIMAPをポーリングし、新着メールを処理する。

**処理フェーズ（1メールごと）:**

| フェーズ | 内容 |
|----------|------|
| 1 | メール保存 → AI解析 → 転送ルール実行 |
| 2 | 暗号化添付ファイル（PPAP）の検出・登録 |
| 3 | パスワードメールによる待機中ZIPの解凍 |
| 4 | メーカー設定がある場合の自動抽出・Excel書き込み |

**AI解析項目:**

| 項目 | 内容 |
|------|------|
| summary | メールの要約（日本語） |
| category | カテゴリ分類 |
| manufacturer | メーカー名 |
| priority | 優先度（high/medium/low） |
| key_info | 重要情報（JSON） |
| suggested_label_ids | 付与すべきラベルのID一覧 |
| extracted_fields | 抽出フィールド（現場コード等） |

### 4-2. ラベル管理

ラベルには以下の種別がある：

| 種別 | 用途 |
|------|------|
| manufacturer | メーカー識別用 |
| category | カテゴリ分類用 |
| priority | 優先度用 |
| custom | 任意用途 |

AIが解析結果に基づいてラベルを自動付与。ユーザーが手動で追加・削除も可能。

### 4-3. 転送ルール

ラベルに紐付けて転送先メールアドレスを設定できる。

- 件名テンプレート: `{subject}` 等の変数が使える
- 添付ファイルの転送可否を選択可能
- 重複転送防止あり（ForwardingLogで管理）

### 4-4. メールステータス管理

| ステータス | 意味 |
|-----------|------|
| unread | 未読 |
| read | 既読 |
| in_progress | 対応中 |
| completed | 完了 |
| pending | 保留 |
| escalated | エスカレーション |
| replied | 返信済み |
| needs_review | 要確認（抽出結果に問題あり） |

### 4-5. 返信テンプレート

定型文テンプレートを登録してメールに返信できる。  
件名・本文に `{件名}` `{送信元メールアドレス}` 等の変数が使える。

### 4-6. 暗号化アーカイブ対応（PPAP）

ZIP/7zの暗号化ファイルを自動検出し、パスワードメールと照合して自動解凍する。

### 4-7. CSVアップロード・照合

CSVをアップロードして、メールから抽出した発注No等と照合できる。

---

## 5. 書類抽出機能（メーカー別設定）

### 概要

メールに添付された依頼書類（PDF/Excel/画像）をClaude APIで解析し、指定フィールドのデータを抽出してExcelに書き込む機能。

### 抽出設定（MakerExtractionConfig）

メーカーごとに設定を登録する。

| 設定項目 | 内容 |
|----------|------|
| メーカー名 | AIが解析したai_manufacturerと照合するキーワード |
| Excelファイルパス | 書き込み先ExcelのNASパス（例: `\\192.168.1.195\disk1\emailsys\automation\パナソニックホームズ\pad.xlsx`） |
| 地図保存パス | 案内図の保存先NASディレクトリ |
| 地図日付フィールド | ファイル名生成に使う日付フィールド名（デフォルト: 回収日） |
| 地図必須 | チェックONの場合、地図ファイルがないと「要確認」扱い |

### 抽出フィールド設定（ExtractionField）

| 設定項目 | 内容 |
|----------|------|
| フィールド名 | Excelの列名になる（例: コード、回収日） |
| フィールド種別 | text / code / date |
| 必須 | ONの場合、取得できなければ「要確認」扱い |
| 並び順 | Excelの列順 |
| 別名キーワード | AIへのヒント（例: 「施主コード」「現場コード」→「コード」として取得） |

### Excelファイル構成（pad.xlsx）

抽出フィールドの順番通りに列が並び、末尾に「処理済」列が追加される。

```
| コード | 回収日 | 担当者 | ... | 処理済 |
|--------|--------|--------|-----|--------|
| ABC123 | 2026-06-15 | 田中 | ... |        |  ← 抽出時は空白
| DEF456 | 2026-06-20 | 鈴木 | ... | 済     |  ← PAD処理後に「済」を記入
```

### 地図ファイルの命名規則

`{コード}_{回収日}.pdf` の形式で保存される。  
例: `ABC123_2026-06-15.pdf`

### 抽出処理フロー

```
メール受信
↓
AI解析でai_manufacturerを取得
↓
MakerExtractionConfigと照合（ilike検索）
↓
添付ファイルを種別判定
├── Excel/PDF → Claude API で解析（PDF: document API / Excel: テキスト変換）
├── 画像 → Claude Vision API で3回解析して信頼度確認
├── ZIP/7z → パスワードメールと照合して解凍後に解析
└── 添付なし → メール本文から抽出
↓
必須フィールドが揃っていれば「completed」、不足なら「needs_review」
↓
completed の場合 → pad.xlsx に追記・地図ファイルをNASにコピー
needs_review の場合 → メールステータスを「要確認」に変更・手動確認待ち
```

### 手動確認フロー

「要確認」になったメールは画面から確認・修正できる。  
確認完了ボタンを押すとExcelへの書き込みが実行される。

---

## 6. NAS連携・PAD連携

### NASへの書き込み仕組み

SMBによる直接書き込みはNASがSMB1のみ対応のため不可。以下の迂回方式を採用:

```
Docker backend
  ↓ Dockerボリューム
/app/nas_output/  (= WSL /home/pc/nas_output/)
  ↓ robocopy（Windows）
\\192.168.1.195\disk1\  (NAS)
```

**ディレクトリ対応表:**

| Dockerパス | NASパス |
|-----------|---------|
| `/app/nas_output/emailsys/automation/...` | `Z:\emailsys\automation\...` |

### robocopy同期スクリプト

ファイル: `C:\Users\PC\sync_nas.vbs`

```vbs
' robocopy実行（完了まで待機）
exitCode = objShell.Run("robocopy ""\\wsl$\Ubuntu\home\pc\nas_output"" ""\\192.168.1.195\disk1"" /E /B", 0, True)

' ファイルがコピーされた場合のみトリガーファイルを作成（exitCode 1〜7）
If exitCode >= 1 And exitCode < 8 Then
    ' Z:\emailsys\automation\_pad_trigger.txt を作成
End If
```

### PADトリガーファイル

- パス: `Z:\emailsys\automation\_pad_trigger.txt`
- robocopyで実際にファイルが同期されたときだけ作成・更新される
- PADフロー処理後に削除すること

### PADフロー構成（作成予定）

```
[開始]
↓
_pad_trigger.txt が存在するか確認
存在しない → フロー終了
↓
pad.xlsx を開く
↓
全行をループ
  「処理済」列が空白の行だけ処理
  ↓
  業務システム（ブラウザ）にログイン
  ↓
  各フィールドを入力・送信
  ↓
  Excelの「処理済」列に「済」を書き込む
↓
Excel保存・閉じる
↓
_pad_trigger.txt を削除
[終了]
```

---

## 7. APIエンドポイント一覧

| パス | メソッド | 説明 |
|------|----------|------|
| `/api/auth/login` | POST | ログイン（JWTトークン取得） |
| `/api/auth/me` | GET | 現在のユーザー情報 |
| `/api/users` | GET/POST | ユーザー一覧・作成 |
| `/api/accounts` | GET/POST/PUT/DELETE | メールアカウント管理 |
| `/api/emails` | GET | メール一覧（フィルタ・ページネーション） |
| `/api/emails/{id}` | GET | メール詳細 |
| `/api/emails/{id}/status` | PUT | ステータス更新 |
| `/api/emails/{id}/labels` | POST/DELETE | ラベル付与・削除 |
| `/api/labels` | GET/POST/PUT/DELETE | ラベル管理 |
| `/api/forwarding/rules` | GET/POST/PUT/DELETE | 転送ルール管理 |
| `/api/extraction/configs` | GET/POST/PUT/DELETE | 抽出設定管理 |
| `/api/extraction/process/{email_id}` | POST | 手動で抽出処理を実行 |
| `/api/extraction/results/{email_id}` | GET | 抽出結果取得 |
| `/api/extraction/results/{result_id}/confirm` | PUT | 要確認→確認済みにしてExcel書き込み |
| `/api/documents/analyze` | POST | 書類アップロード・解析 |
| `/api/reply/templates` | GET/POST/PUT/DELETE | 返信テンプレート管理 |
| `/api/reply/send` | POST | テンプレートで返信 |
| `/api/archives` | GET | 暗号化アーカイブ一覧 |
| `/api/csv` | POST | CSVアップロード・照合 |

---

## 8. データベーステーブル一覧

| テーブル名 | 説明 |
|-----------|------|
| users | ユーザー |
| email_accounts | メールアカウント（IMAP/SMTP設定） |
| emails | 受信メール |
| email_labels | メール↔ラベルの紐付け |
| email_status_records | メールのステータス管理 |
| email_activities | メールに対する操作ログ |
| email_fields | AIが抽出したフィールド（現場コード等） |
| email_attachments | 添付ファイルメタデータ |
| labels | ラベルマスタ |
| forwarding_rules | 転送ルール |
| forwarding_logs | 転送実行ログ |
| reply_templates | 返信テンプレート |
| reply_logs | 返信実行ログ |
| encrypted_archives | 暗号化アーカイブ管理 |
| extracted_files | 解凍済みファイル |
| csv_uploads | CSVアップロード履歴 |
| csv_records | CSV行データ |
| email_csv_matches | メール↔CSV照合結果 |
| maker_extraction_configs | メーカー別抽出設定 |
| extraction_fields_config | 抽出フィールド定義 |
| extraction_results | 抽出結果 |

---

## 9. 環境変数（backend/.env）

| 変数名 | 内容 |
|--------|------|
| DATABASE_URL | PostgreSQL接続文字列 |
| SECRET_KEY | JWT署名キー |
| ANTHROPIC_API_KEY | Claude API キー |
| POLL_INTERVAL_MINUTES | ポーリング間隔（分、デフォルト5） |
| FIRST_ADMIN_EMAIL | 初回起動時に作成する管理者メールアドレス |
| FIRST_ADMIN_PASSWORD | 初回起動時に作成する管理者パスワード |
| NAS_HOST | NASのIPアドレス（192.168.1.195） |
| NAS_SHARE | NAS共有名（disk1） |
| NAS_USERNAME | NASユーザー名 |
| NAS_PASSWORD | NASパスワード |

---

## 10. 運用手順

### コードを変更して本番に反映する

```bash
# サーバーPCのWSL内で実行
cd ~/email-management
docker-compose up -d --build   # 変更を反映（約1〜2分）
docker-compose up -d           # 設定変更のみ（再起動のみ）
```

### ログを確認する

```bash
docker-compose logs backend --tail=50 -f   # バックエンドのリアルタイムログ
docker-compose logs -f                     # 全コンテナのログ
```

### 手動でNAS同期を実行する

```
wscript.exe C:\Users\PC\sync_nas.vbs
```

### 添付ファイルの保存場所

- キャッシュ（Docker内）: `/app/attachments/cache/{attachment_id}.bin`
- NAS出力先（WSL内）: `/home/pc/nas_output/emailsys/automation/`
- NAS（Windows側）: `Z:\emailsys\automation\`
