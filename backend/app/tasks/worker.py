"""
APSchedulerベースのバックグラウンドタスク。
- IMAP定期ポーリング
- AI解析
- 転送ルール実行
"""
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app import models
from app.services import imap_service, ai_service, smtp_service, archive_service
from app.config import settings

_SITE_ID_KEYWORDS = [
    "施主", "工事番号", "現場コード", "現場no", "発注no", "案件no", "物件コード",
    "site id", "site no", "site code", "genba no",
]

def _is_site_id_field(name: str) -> bool:
    n = name.lower()
    return any(k in n for k in _SITE_ID_KEYWORDS)

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()


def run_email_poll():
    """全アクティブアカウントのメールを取得してAI解析・転送を実行する。"""
    db: Session = SessionLocal()
    try:
        accounts = db.query(models.EmailAccount).filter(
            models.EmailAccount.is_active == True
        ).all()

        for account in accounts:
            logger.info(f"ポーリング開始: {account.email_address}")
            new_emails = imap_service.fetch_new_emails(account, db)
            logger.info(f"  {len(new_emails)}件の新着メール")

            # フェーズ1: 全メールを保存してAI解析・転送
            saved_batch = []
            for email_data in new_emails:
                email_obj = _save_email(db, email_data)
                if email_obj:
                    _run_ai_analysis(db, email_obj)
                    _run_forwarding(db, email_obj)
                    saved_batch.append((email_obj, email_data.get("attachments", [])))

            # フェーズ2: 暗号化アーカイブの検出・登録（全メールがDB登録済みの状態で実行）
            for email_obj, raw_attachments in saved_batch:
                try:
                    archive_service.process_encrypted_attachments(db, email_obj, raw_attachments)
                except Exception as e:
                    db.rollback()
                    logger.error(f"フェーズ2エラー (email_id={email_obj.id}): {e}")

            # フェーズ3: パスワードメールで待機中アーカイブを解凍
            for email_obj, _ in saved_batch:
                try:
                    archive_service.try_extract_pending_archives_for_sender(db, email_obj)
                except Exception as e:
                    db.rollback()
                    logger.error(f"フェーズ3エラー (email_id={email_obj.id}): {e}")

            # フェーズ4: メーカー設定がある場合は自動抽出・Excel書き込み
            for email_obj, _ in saved_batch:
                try:
                    _run_extraction(db, email_obj)
                except Exception as e:
                    db.rollback()
                    logger.error(f"フェーズ4エラー (email_id={email_obj.id}): {e}")
    except Exception as e:
        logger.error(f"ポーリングエラー: {e}")
    finally:
        db.close()


def _save_email(db: Session, data: dict) -> models.Email | None:
    try:
        email_obj = models.Email(
            account_id=data["account_id"],
            message_id=data["message_id"],
            subject=data["subject"],
            from_address=data["from_address"],
            from_name=data["from_name"],
            to_addresses=data["to_addresses"],
            cc_addresses=data["cc_addresses"],
            body_text=data["body_text"],
            body_html=data["body_html"],
            received_at=data["received_at"],
        )
        db.add(email_obj)
        db.flush()

        # 初期ステータスレコード作成
        status_rec = models.EmailStatusRecord(
            email_id=email_obj.id,
            status=models.EmailStatusEnum.unread,
        )
        db.add(status_rec)
        db.commit()
        db.refresh(email_obj)

        # 添付ファイルを保存
        _save_attachments(db, email_obj, data.get("attachments", []))

        return email_obj
    except Exception as e:
        db.rollback()
        from sqlalchemy.exc import IntegrityError
        if isinstance(e, IntegrityError):
            logger.debug(f"メール重複スキップ (message_id={data.get('message_id', '')[:40]})")
        else:
            logger.error(f"メール保存エラー: {e}")
        return None


_ATT_CACHE = Path("/app/attachments/cache")

def _save_attachments(db: Session, email_obj: models.Email, attachments: list):
    """添付ファイルのメタデータをDBに保存し、バイナリをキャッシュディレクトリに書き出す。"""
    if not attachments:
        return
    for att in attachments:
        try:
            data: bytes = att.get("data") or b""
            att_obj = models.EmailAttachment(
                email_id=email_obj.id,
                filename=att.get("filename", "attachment"),
                content_type=att.get("content_type", "application/octet-stream"),
                file_size=len(data),
            )
            db.add(att_obj)
            db.flush()  # IDを確定させてからキャッシュ保存
            if data:
                _ATT_CACHE.mkdir(parents=True, exist_ok=True)
                (_ATT_CACHE / f"{att_obj.id}.bin").write_bytes(data)
        except Exception as e:
            logger.error(f"添付メタデータ保存エラー (email_id={email_obj.id}): {e}")
    db.commit()


def _run_ai_analysis(db: Session, email_obj: models.Email):
    try:
        labels = db.query(models.Label).filter(models.Label.is_active == True).all()
        available_labels = [
            {"id": lb.id, "name": lb.name, "label_type": lb.label_type.value, "description": lb.description or ""}
            for lb in labels
        ]

        result = ai_service.analyze_email(
            subject=email_obj.subject or "",
            from_address=email_obj.from_address or "",
            from_name=email_obj.from_name or "",
            body_text=email_obj.body_text or "",
            available_labels=available_labels,
        )

        email_obj.ai_analyzed = True
        email_obj.ai_summary = result.get("summary")
        email_obj.ai_category = result.get("category")
        email_obj.ai_manufacturer = result.get("manufacturer")
        email_obj.ai_priority = result.get("priority")
        email_obj.ai_key_info = result.get("key_info", {})

        # 既存の抽出フィールドを削除して再保存
        db.query(models.EmailField).filter(models.EmailField.email_id == email_obj.id).delete()
        for field_name, field_value in result.get("extracted_fields", {}).items():
            if field_name and field_value:
                fv = str(field_value)
                group_id = None
                if _is_site_id_field(str(field_name)):
                    codes = [c.strip() for c in fv.split(",") if c.strip()]
                    if len(codes) > 1:
                        group_id = str(uuid.uuid4())
                db.add(models.EmailField(
                    email_id=email_obj.id,
                    field_name=str(field_name),
                    field_value=fv,
                    group_id=group_id,
                ))

        # AIが提案したラベルを付与
        for label_id in result.get("suggested_label_ids", []):
            exists = db.query(models.EmailLabel).filter(
                models.EmailLabel.email_id == email_obj.id,
                models.EmailLabel.label_id == label_id,
            ).first()
            if not exists:
                el = models.EmailLabel(
                    email_id=email_obj.id,
                    label_id=label_id,
                    assigned_by="ai",
                )
                db.add(el)

        db.commit()
        logger.info(f"AI解析完了: email_id={email_obj.id}")
    except Exception as e:
        db.rollback()
        logger.error(f"AI解析エラー (email_id={email_obj.id}): {e}")


def _run_extraction(db: Session, email_obj: models.Email):
    """AIが解析したメーカー名に対応する抽出設定があれば自動抽出する。"""
    maker = email_obj.ai_manufacturer
    if not maker:
        return

    config = db.query(models.MakerExtractionConfig).filter(
        models.MakerExtractionConfig.maker_name.ilike(f"%{maker}%")
    ).first()
    if not config:
        return

    from app.services.extraction_service import process_email_extraction
    result = process_email_extraction(email_obj.id, db)
    logger.info(f"自動抽出: email_id={email_obj.id}, status={result.get('status')}")


def _run_forwarding(db: Session, email_obj: models.Email):
    """メールに付いたラベルに対応する転送ルールを実行する。"""
    try:
        label_ids = [el.label_id for el in email_obj.email_labels]
        if not label_ids:
            return

        rules = db.query(models.ForwardingRule).filter(
            models.ForwardingRule.label_id.in_(label_ids),
            models.ForwardingRule.is_active == True,
        ).all()

        account = db.query(models.EmailAccount).get(email_obj.account_id)
        if not account or not account.smtp_host:
            return

        # 抽出フィールドをdict形式で取得
        field_records = db.query(models.EmailField).filter(
            models.EmailField.email_id == email_obj.id
        ).all()
        extracted = {f.field_name: f.field_value for f in field_records}

        # 添付ファイルのメタデータ確認（ルールごとに必要な場合のみIMAPから取得）
        has_attachments = db.query(models.EmailAttachment).filter(
            models.EmailAttachment.email_id == email_obj.id
        ).first()

        for rule in rules:
            # 重複転送防止
            already = db.query(models.ForwardingLog).filter(
                models.ForwardingLog.rule_id == rule.id,
                models.ForwardingLog.email_id == email_obj.id,
                models.ForwardingLog.success == True,
            ).first()
            if already:
                continue

            # ルールの attach_files フラグに応じて添付ファイルを取得
            attachment_data = []
            if rule.attach_files and has_attachments and account.smtp_host and email_obj.message_id:
                attachment_data = imap_service.fetch_attachments_for_message(account, email_obj.message_id)

            success, error = smtp_service.forward_email(account, rule, email_obj, extracted, attachment_data)
            log = models.ForwardingLog(
                rule_id=rule.id,
                email_id=email_obj.id,
                forwarded_to=rule.destination_email,
                forwarded_subject=smtp_service.build_subject(rule.subject_template, email_obj, extracted),
                success=success,
                error_message=error or None,
            )
            db.add(log)
            if success:
                rule.forward_count += 1

            # アクティビティ記録
            activity = models.EmailActivity(
                email_id=email_obj.id,
                action="forwarded",
                detail=f"→ {rule.destination_email} (ルール: {rule.name})"
                if success else f"転送失敗: {error}",
            )
            db.add(activity)

        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"転送処理エラー (email_id={email_obj.id}): {e}")


def start_scheduler():
    scheduler.add_job(
        run_email_poll,
        "interval",
        minutes=settings.POLL_INTERVAL_MINUTES,
        id="email_poll",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(f"スケジューラ起動 (間隔: {settings.POLL_INTERVAL_MINUTES}分)")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown()
