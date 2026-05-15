# メール管理システム

## プロジェクト概要
社内メールをAI（Claude）で自動解析・分類・転送するシステム。
Power Automate Desktop と連携して業務自動化を実現。

## 起動方法
```bash
cd C:\Users\ysk-f\Desktop\claud\email-management
docker-compose up -d --build   # 変更反映時
docker-compose up -d           # 再起動のみ
```
アクセス: http://localhost（社内: http://192.168.2.116 / 外部: https://sys.yskmail.jp）

## 技術構成
- **バックエンド**: FastAPI (Python 3.12) / PostgreSQL / APScheduler
- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **AI**: Claude Haiku (claude-haiku-4-5-20251001)
- **インフラ**: Docker Compose (backend / frontend / nginx / db)

## 主要ファイル
| ファイル | 役割 |
|---------|------|
| `backend/app/main.py` | FastAPIアプリ起動・ミドルウェア設定 |
| `backend/app/models.py` | DBモデル定義 |
| `backend/app/schemas.py` | リクエスト/レスポンスのスキーマ |
| `backend/app/api/` | APIエンドポイント（auth/emails/accounts/labels/forwarding/users） |
| `backend/app/services/ai_service.py` | Claude APIによるメール解析 |
| `backend/app/services/imap_service.py` | IMAP受信処理 |
| `backend/app/services/smtp_service.py` | SMTP転送処理 |
| `backend/app/tasks/worker.py` | 定期ポーリング・AI解析・転送のスケジューラ |
| `frontend/src/pages/` | 各画面（Dashboard/EmailList/EmailDetail/Accounts/Labels/ForwardingRules/Users/Login/Register） |
| `frontend/src/api/client.ts` | APIクライアント |
| `backend/.env` | 環境変数（APIキー・DB接続情報） |

## 実装済み機能
- JWT認証・ユーザー登録（/register）・ユーザー管理
- メールアカウント管理（IMAP/SMTP）
- AI解析：要約・カテゴリ・メーカー・優先度・ラベル自動付与
- ラベル管理・転送ルール
- メール一覧・詳細・ステータス管理・アクティビティログ
- ダッシュボード統計

## ネットワーク公開設定
- 社内LAN: `http://192.168.2.116`（Windowsファイアウォール Port 80 開放済み）
- 外部公開: `https://sys.yskmail.jp`（Cloudflare Tunnel使用）
  - ドメイン: yskmail.jp（エックスサーバー取得・Cloudflare DNS管理）
  - トンネルID: 538ebfc6-f78f-48e7-92c1-ca7707149286
  - 設定ファイル: `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`
  - 自動起動: タスクスケジューラ「CloudflaredTunnel」（SYSTEM・スタートアップ時）

## 変更を本番に反映する手順
1. コードを修正
2. `docker-compose up -d --build` を実行（約1〜2分）
3. http://localhost で確認
