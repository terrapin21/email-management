import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks

logger = logging.getLogger(__name__)
from sqlalchemy.orm import Session, joinedload

# 添付ファイルのローカルキャッシュ先（コンテナの永続 volume）
_ATT_CACHE = Path("/app/attachments/cache")
from sqlalchemy import desc, or_
from typing import Optional, List
from datetime import datetime, timezone
from app.database import get_db
from app import models
from app.auth import get_current_user
from app.schemas import (
    EmailOut, EmailListItem, PaginatedEmails, EmailStatusUpdate,
    EmailLabelAssign, StatsOut, EmailActivityOut, EmailAttachmentOut
)
from app.tasks.worker import _run_ai_analysis, _run_forwarding
from app.services.smtp_service import forward_email, build_subject

router = APIRouter(prefix="/api/emails", tags=["emails"])


@router.get("", response_model=PaginatedEmails)
def list_emails(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    account_id: Optional[int] = None,
    label_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    q = db.query(models.Email).options(
        joinedload(models.Email.email_labels).joinedload(models.EmailLabel.label),
        joinedload(models.Email.status_record).joinedload(models.EmailStatusRecord.confirmer),
        joinedload(models.Email.account),
    )

    if account_id:
        q = q.filter(models.Email.account_id == account_id)
    if label_id:
        q = q.join(models.EmailLabel).filter(models.EmailLabel.label_id == label_id)
    if status:
        q = q.join(models.EmailStatusRecord).filter(models.EmailStatusRecord.status == status)
    if priority:
        q = q.filter(models.Email.ai_priority == priority)
    if search:
        q = q.filter(or_(
            models.Email.subject.ilike(f"%{search}%"),
            models.Email.from_address.ilike(f"%{search}%"),
            models.Email.from_name.ilike(f"%{search}%"),
            models.Email.ai_summary.ilike(f"%{search}%"),
        ))

    total = q.count()
    emails = q.order_by(desc(models.Email.received_at)).offset((page - 1) * per_page).limit(per_page).all()

    # 転送済みID・CSV照合ステータスを一括取得
    email_ids = [e.id for e in emails]
    forwarded_ids: set = set()
    registration_map: dict = {}  # email_id -> "registered"
    reflection_map: dict = {}    # email_id -> "reflected" | "not_reflected" | None
    has_attachment_ids: set = set()

    if email_ids:
        forwarded_ids = {
            row[0] for row in
            db.query(models.ForwardingLog.email_id)
            .filter(
                models.ForwardingLog.email_id.in_(email_ids),
                models.ForwardingLog.success == True,
            )
            .distinct().all()
        }
        matches = db.query(
            models.EmailCsvMatch.email_id,
            models.EmailCsvMatch.reflection_status,
        ).filter(
            models.EmailCsvMatch.email_id.in_(email_ids)
        ).all()

        for eid, ref_status in matches:
            registration_map[eid] = "registered"
            if eid not in reflection_map:
                reflection_map[eid] = ref_status

        has_fields_ids = {
            row[0] for row in
            db.query(models.EmailField.email_id)
            .filter(models.EmailField.email_id.in_(email_ids))
            .distinct().all()
        }
        for eid in has_fields_ids:
            if eid not in registration_map:
                registration_map[eid] = "not_registered"

        has_attachment_ids = {
            row[0] for row in
            db.query(models.EmailAttachment.email_id)
            .filter(models.EmailAttachment.email_id.in_(email_ids))
            .distinct().all()
        }

    items = []
    for e in emails:
        labels = [el.label for el in e.email_labels if el.label and el.label.is_active]
        status_val = e.status_record.status if e.status_record else models.EmailStatusEnum.unread
        confirmed_name = None
        if e.status_record and e.status_record.confirmer:
            confirmed_name = e.status_record.confirmer.full_name or e.status_record.confirmer.username

        reg_status = registration_map.get(e.id)
        ref_status = reflection_map.get(e.id) if reg_status == "registered" else None

        items.append(EmailListItem(
            is_forwarded=e.id in forwarded_ids,
            has_attachments=e.id in has_attachment_ids,
            id=e.id,
            account_id=e.account_id,
            subject=e.subject,
            from_address=e.from_address,
            from_name=e.from_name,
            received_at=e.received_at,
            ai_analyzed=e.ai_analyzed,
            ai_summary=e.ai_summary,
            ai_category=e.ai_category,
            ai_manufacturer=e.ai_manufacturer,
            ai_priority=e.ai_priority,
            created_at=e.created_at,
            labels=labels,
            status=status_val,
            confirmed_by_name=confirmed_name,
            registration_status=reg_status,
            reflection_status=ref_status,
        ))

    return PaginatedEmails(total=total, page=page, per_page=per_page, items=items)


@router.get("/stats", response_model=StatsOut)
def get_stats(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    from datetime import date
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)

    total = db.query(models.Email).count()
    unread = db.query(models.EmailStatusRecord).filter(
        models.EmailStatusRecord.status == models.EmailStatusEnum.unread
    ).count()
    in_progress = db.query(models.EmailStatusRecord).filter(
        models.EmailStatusRecord.status == models.EmailStatusEnum.in_progress
    ).count()
    completed = db.query(models.EmailStatusRecord).filter(
        models.EmailStatusRecord.status == models.EmailStatusEnum.completed
    ).count()
    today = db.query(models.Email).filter(models.Email.received_at >= today_start).count()
    accounts_active = db.query(models.EmailAccount).filter(models.EmailAccount.is_active == True).count()
    labels_count = db.query(models.Label).filter(models.Label.is_active == True).count()

    return StatsOut(
        total_emails=total,
        unread=unread,
        in_progress=in_progress,
        completed=completed,
        today_received=today,
        accounts_active=accounts_active,
        labels_count=labels_count,
    )


@router.get("/{email_id}", response_model=EmailOut)
def get_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).options(
        joinedload(models.Email.email_labels).joinedload(models.EmailLabel.label),
        joinedload(models.Email.status_record).joinedload(models.EmailStatusRecord.confirmer),
        joinedload(models.Email.status_record).joinedload(models.EmailStatusRecord.assignee),
        joinedload(models.Email.activities).joinedload(models.EmailActivity.user),
        joinedload(models.Email.account),
        joinedload(models.Email.extracted_fields),
        joinedload(models.Email.attachments),
        joinedload(models.Email.csv_matches).joinedload(models.EmailCsvMatch.csv_record),
        joinedload(models.Email.forwarding_logs),
    ).get(email_id)

    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")

    # 未読なら既読に変更（手動でステータス変更済みの場合は自動変更しない）
    from app.models import EmailActivity as EA
    manually_changed = db.query(EA).filter(
        EA.email_id == email_id,
        EA.action == "status_changed",
    ).first()

    if not manually_changed and email.status_record and email.status_record.status == models.EmailStatusEnum.unread:
        email.status_record.status = models.EmailStatusEnum.read
        activity = models.EmailActivity(
            email_id=email.id,
            user_id=current_user.id,
            action="read",
            detail=f"{current_user.full_name or current_user.username} が確認しました",
        )
        db.add(activity)
        db.commit()
        db.refresh(email)

    return email


@router.put("/{email_id}/status")
def update_status(
    email_id: int,
    payload: EmailStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")

    if not email.status_record:
        email.status_record = models.EmailStatusRecord(email_id=email_id)
        db.add(email.status_record)

    old_status = email.status_record.status
    email.status_record.status = payload.status
    if payload.assigned_to is not None:
        email.status_record.assigned_to = payload.assigned_to
    if payload.notes is not None:
        email.status_record.notes = payload.notes

    activity = models.EmailActivity(
        email_id=email.id,
        user_id=current_user.id,
        action="status_changed",
        detail=f"{old_status} → {payload.status}",
    )
    db.add(activity)
    db.commit()
    return {"ok": True}


@router.post("/{email_id}/confirm")
def confirm_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")

    if not email.status_record:
        email.status_record = models.EmailStatusRecord(email_id=email_id)
        db.add(email.status_record)

    email.status_record.confirmed_by = current_user.id
    email.status_record.confirmed_at = datetime.now(timezone.utc)

    activity = models.EmailActivity(
        email_id=email.id,
        user_id=current_user.id,
        action="confirmed",
        detail=f"{current_user.full_name or current_user.username} が確認済みにしました",
    )
    db.add(activity)
    db.commit()
    return {"ok": True}


@router.post("/{email_id}/labels")
def set_labels(
    email_id: int,
    payload: EmailLabelAssign,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")

    # 既存ラベルを削除して再設定
    db.query(models.EmailLabel).filter(models.EmailLabel.email_id == email_id).delete()
    for label_id in payload.label_ids:
        el = models.EmailLabel(email_id=email_id, label_id=label_id, assigned_by="user")
        db.add(el)

    activity = models.EmailActivity(
        email_id=email.id,
        user_id=current_user.id,
        action="labels_updated",
        detail=f"ラベルを更新しました (ids: {payload.label_ids})",
    )
    db.add(activity)
    db.commit()

    # 転送ルール再実行
    db.refresh(email)
    _run_forwarding(db, email)

    return {"ok": True}


@router.post("/{email_id}/refetch")
def refetch_body(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """IMAPから本文を再取得してDBを上書きする。"""
    from app.services.imap_service import refetch_email_body

    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")
    account = db.query(models.EmailAccount).get(email.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")

    result = refetch_email_body(account, email.message_id)
    if not result:
        raise HTTPException(status_code=404, detail="IMAPサーバーでメールが見つかりませんでした")

    email.body_text = result["body_text"]
    email.body_html = result["body_html"]
    email.subject = result["subject"]

    # 添付ファイルが新たに取得できた場合、既存レコードを削除して再保存する
    new_attachments = result.get("attachments", [])
    if new_attachments:
        db.query(models.EmailAttachment).filter(
            models.EmailAttachment.email_id == email_id
        ).delete()
        for att in new_attachments:
            db.add(models.EmailAttachment(
                email_id=email_id,
                filename=att.get("filename", "attachment"),
                content_type=att.get("content_type", "application/octet-stream"),
                file_size=len(att.get("data", b"")),
            ))

    db.commit()
    logger.info(f"本文再取得完了: email_id={email_id}, 添付={len(new_attachments)}件")
    return {"message": "本文を再取得しました"}


@router.post("/{email_id}/analyze")
def reanalyze(
    email_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")

    def do_analyze():
        from app.database import SessionLocal
        s = SessionLocal()
        try:
            e = s.query(models.Email).get(email_id)
            if e:
                _run_ai_analysis(s, e)
                _run_forwarding(s, e)
        finally:
            s.close()

    background_tasks.add_task(do_analyze)
    return {"message": "AI再解析を開始しました"}


@router.post("/analyze-all")
def analyze_all(
    background_tasks: BackgroundTasks,
    account_id: Optional[int] = None,
    label_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """現在のフィルター条件に合うメールをAI再解析する。"""
    q = db.query(models.Email)
    if account_id:
        q = q.filter(models.Email.account_id == account_id)
    if label_id:
        q = q.join(models.EmailLabel).filter(models.EmailLabel.label_id == label_id)
    if status:
        q = q.join(models.EmailStatusRecord).filter(models.EmailStatusRecord.status == status)
    if priority:
        q = q.filter(models.Email.ai_priority == priority)
    if search:
        q = q.filter(or_(
            models.Email.subject.ilike(f"%{search}%"),
            models.Email.from_address.ilike(f"%{search}%"),
            models.Email.from_name.ilike(f"%{search}%"),
            models.Email.ai_summary.ilike(f"%{search}%"),
        ))

    emails = q.all()
    ids = [e.id for e in emails]

    def do_analyze_all():
        from app.database import SessionLocal
        s = SessionLocal()
        try:
            for eid in ids:
                e = s.query(models.Email).get(eid)
                if e:
                    _run_ai_analysis(s, e)
                    _run_forwarding(s, e)
        finally:
            s.close()

    background_tasks.add_task(do_analyze_all)
    return {"message": f"{len(ids)}件のメールをAI解析キューに追加しました", "count": len(ids)}


@router.post("/{email_id}/forward")
def manual_forward(
    email_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """メールを転送ルールに従って手動転送する。"""
    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")

    activity = models.EmailActivity(
        email_id=email.id,
        user_id=current_user.id,
        action="manual_forward",
        detail=f"{current_user.full_name or current_user.username} が手動転送を実行しました",
    )
    db.add(activity)
    db.commit()

    def do_forward():
        from app.database import SessionLocal
        s = SessionLocal()
        try:
            e = s.query(models.Email).get(email_id)
            if e:
                _run_forwarding(s, e)
        finally:
            s.close()

    background_tasks.add_task(do_forward)
    return {"message": "転送を開始しました"}


@router.get("/{email_id}/attachments", response_model=List[EmailAttachmentOut])
def get_attachments(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")
    return db.query(models.EmailAttachment).filter(
        models.EmailAttachment.email_id == email_id
    ).all()


@router.post("/{email_id}/prefetch-attachments")
def prefetch_attachments(
    email_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """メール詳細を開いた際に添付ファイルをバックグラウンドでキャッシュする。"""
    atts = db.query(models.EmailAttachment).filter(
        models.EmailAttachment.email_id == email_id
    ).all()
    uncached = [a.id for a in atts if not (_ATT_CACHE / f"{a.id}.bin").exists()]
    if not uncached:
        return {"cached": True}

    email = db.query(models.Email).get(email_id)
    account = db.query(models.EmailAccount).get(email.account_id) if email else None
    if not email or not account or not email.message_id:
        return {"cached": False}

    att_map = {a.id: a for a in atts}
    msg_id = email.message_id

    def do_prefetch():
        from app.services.imap_service import fetch_attachments_for_message
        try:
            fetched = fetch_attachments_for_message(account, msg_id)
            _ATT_CACHE.mkdir(parents=True, exist_ok=True)
            for att_id in uncached:
                att = att_map.get(att_id)
                if not att:
                    continue
                cache_path = _ATT_CACHE / f"{att_id}.bin"
                if cache_path.exists():
                    continue
                matched = next((f for f in fetched if f.get("filename") == att.filename), None)
                if not matched:
                    matched = next(
                        (f for f in fetched if (f.get("filename") or "").strip().lower() == att.filename.strip().lower()),
                        None,
                    )
                if matched and matched.get("data"):
                    cache_path.write_bytes(matched["data"])
                    logger.debug(f"プリフェッチ完了: att_id={att_id}")
        except Exception as e:
            logger.warning(f"プリフェッチ失敗 email_id={email_id}: {e}")

    background_tasks.add_task(do_prefetch)
    return {"cached": False, "prefetching": len(uncached)}


@router.get("/{email_id}/attachments/{attachment_id}/download")
def download_attachment(
    email_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    from fastapi.responses import Response, FileResponse
    from urllib.parse import quote
    from app.services.imap_service import fetch_attachments_for_message

    att = db.query(models.EmailAttachment).filter(
        models.EmailAttachment.id == attachment_id,
        models.EmailAttachment.email_id == email_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="添付ファイルが見つかりません")

    filename_enc = quote(att.filename, encoding="utf-8", safe="")
    content_disposition = f"attachment; filename*=UTF-8''{filename_enc}"
    media_type = att.content_type or "application/octet-stream"

    # キャッシュ済みならディスクから即返す
    cache_path = _ATT_CACHE / f"{attachment_id}.bin"
    if cache_path.exists():
        logger.debug(f"添付キャッシュヒット: att_id={attachment_id}")
        return FileResponse(
            path=str(cache_path),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition},
        )

    # キャッシュなし → IMAP から取得
    email = db.query(models.Email).get(email_id)
    account = db.query(models.EmailAccount).get(email.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")

    attachments = fetch_attachments_for_message(account, email.message_id)

    def _norm(s: str) -> str:
        return s.strip().lower().replace("　", " ")

    matched = next((a for a in attachments if a.get("filename") == att.filename), None)
    if not matched:
        matched = next(
            (a for a in attachments if _norm(a.get("filename", "")) == _norm(att.filename)),
            None,
        )
    if not matched:
        base = att.filename.split("/")[-1].split("\\")[-1]
        matched = next(
            (a for a in attachments if _norm(a.get("filename", "")).endswith(_norm(base))),
            None,
        )
    if not matched and att.content_type:
        same_type = [a for a in attachments if a.get("content_type", "") == att.content_type]
        if len(same_type) == 1:
            matched = same_type[0]
    if not matched and att.content_type and att.content_type.startswith("image/"):
        imgs = [a for a in attachments if a.get("content_type", "").startswith("image/")]
        if len(imgs) == 1:
            matched = imgs[0]

    if not matched:
        logger.warning(
            f"添付ファイルが見つかりません: email_id={email_id} att={att.filename!r} "
            f"candidates={[a.get('filename') for a in attachments]}"
        )
        raise HTTPException(status_code=404, detail="IMAPサーバーで添付ファイルが見つかりません")

    data: bytes = matched["data"]

    # 次回以降のためにキャッシュ保存
    try:
        _ATT_CACHE.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(data)
        logger.debug(f"添付キャッシュ保存: att_id={attachment_id}, size={len(data)}")
    except Exception as e:
        logger.warning(f"添付キャッシュ保存失敗 att_id={attachment_id}: {e}")

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": content_disposition},
    )


@router.post("/cache-attachments")
def cache_all_attachments(
    background_tasks: BackgroundTasks,
    account_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """未キャッシュの添付ファイルをIMAPから取得してキャッシュに保存する（バックグラウンド）。"""
    from app.services.imap_service import fetch_attachments_for_message

    q = db.query(models.EmailAttachment).join(
        models.Email, models.EmailAttachment.email_id == models.Email.id
    )
    if account_id:
        q = q.filter(models.Email.account_id == account_id)
    all_atts = q.all()

    uncached = [a for a in all_atts if not (_ATT_CACHE / f"{a.id}.bin").exists()]
    if not uncached:
        return {"message": "キャッシュ済みのファイルしかありません", "count": 0}

    att_ids = [a.id for a in uncached]

    def do_cache():
        from app.database import SessionLocal
        s = SessionLocal()
        cached = 0
        try:
            _ATT_CACHE.mkdir(parents=True, exist_ok=True)
            # email_id でグループ化してメール単位でIMAPアクセス
            from collections import defaultdict
            groups: dict = defaultdict(list)
            for aid in att_ids:
                att = s.query(models.EmailAttachment).get(aid)
                if att:
                    groups[att.email_id].append(att)

            for email_id, atts in groups.items():
                email_obj = s.query(models.Email).get(email_id)
                account = s.query(models.EmailAccount).get(email_obj.account_id) if email_obj else None
                if not email_obj or not account or not email_obj.message_id:
                    continue
                try:
                    fetched = fetch_attachments_for_message(account, email_obj.message_id)
                except Exception as e:
                    logger.warning(f"キャッシュ取得失敗 email_id={email_id}: {e}")
                    continue
                for att in atts:
                    cache_path = _ATT_CACHE / f"{att.id}.bin"
                    if cache_path.exists():
                        continue
                    matched = next((f for f in fetched if f.get("filename") == att.filename), None)
                    if not matched:
                        matched = next((f for f in fetched if (f.get("filename") or "").strip().lower() == att.filename.strip().lower()), None)
                    if matched and matched.get("data"):
                        cache_path.write_bytes(matched["data"])
                        cached += 1
            logger.info(f"添付キャッシュ完了: {cached}/{len(att_ids)}件")
        finally:
            s.close()

    background_tasks.add_task(do_cache)
    return {"message": f"{len(uncached)}件の添付ファイルをキャッシュ中...", "count": len(uncached)}


def _email_sender_type(email: models.Email) -> str | None:
    """'genba' / 'panasonic' / None を返す。
    Genba Info System は from_address が panasonic-homes.com のため、
    必ず genba を先にチェックする。
    """
    fn = (email.from_name or "").lower()
    fa = (email.from_address or "").lower()
    subj = (email.subject or "").lower()
    # Genba を先に判定（subject も含む）
    if "genba" in fn or "genba" in fa or "genba" in subj:
        return "genba"
    if "パナソニック" in fn or "panasonic" in fn or "panasonic" in fa or "パナソニック" in subj:
        return "panasonic"
    return None


def _is_site_id_field(field_name: str) -> bool:
    """施主No系フィールド名かどうか判定。"""
    fn = field_name.lower()
    keywords = ["施主", "工事番号", "現場コード", "現場no", "発注no", "案件no", "物件コード",
                "site id", "site no", "site code", "genba no"]
    return any(k in fn for k in keywords)


@router.get("/{email_id}/mime-structure")
def mime_structure(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """メールのMIMEパーツ構造を返す（添付ファイル取得デバッグ用）。"""
    import imapclient, email as email_lib
    from app.services.imap_service import _ssl_context, decode_str

    email = db.query(models.Email).get(email_id)
    if not email:
        return {"error": "not found"}
    account = db.query(models.EmailAccount).get(email.account_id)
    if not account:
        return {"error": "account not found"}

    try:
        server = imapclient.IMAPClient(account.imap_host, port=account.imap_port, ssl=account.imap_ssl,
                                        ssl_context=_ssl_context() if account.imap_ssl else None)
        server.login(account.imap_username, account.imap_password)
        server.select_folder("INBOX")
        messages = server.search(["HEADER", "Message-ID", email.message_id])
        if not messages:
            server.logout()
            return {"error": "message not found in IMAP"}
        raw_messages = server.fetch(messages[:1], ["RFC822"])
        server.logout()
        for _, data in raw_messages.items():
            raw = data.get(b"RFC822")
            if not raw:
                return {"error": "no raw data"}
            msg = email_lib.message_from_bytes(raw)
            parts = []
            for part in msg.walk():
                ct = part.get_content_type()
                disposition = str(part.get("Content-Disposition", ""))
                cid = part.get("Content-ID", "")
                filename = part.get_filename()
                ctype_name = part.get_param("name", header="Content-Type")
                payload = part.get_payload(decode=True)
                parts.append({
                    "content_type": ct,
                    "disposition": disposition[:100],
                    "content_id": cid,
                    "filename_header": decode_str(filename) if filename else None,
                    "content_type_name": decode_str(ctype_name) if ctype_name else None,
                    "payload_size": len(payload) if payload else 0,
                    "is_multipart": part.is_multipart(),
                })
            return {"message_id": email.message_id, "parts": parts}
    except Exception as e:
        return {"error": str(e)}


@router.get("/{email_id}/related-debug")
def debug_related(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """関連メール紐づけの診断情報を返す（開発用）。"""
    email = db.query(models.Email).get(email_id)
    if not email:
        return {"error": "not found"}

    all_fields = db.query(models.EmailField).filter(
        models.EmailField.email_id == email_id
    ).all()

    sender_type = _email_sender_type(email)

    return {
        "email_id": email_id,
        "from_name": email.from_name,
        "from_address": email.from_address,
        "subject": email.subject,
        "sender_type": sender_type,
        "all_fields": [
            {
                "name": f.field_name,
                "value": f.field_value,
                "is_site_id": _is_site_id_field(f.field_name),
            }
            for f in all_fields
        ],
    }


@router.get("/{email_id}/related")
def get_related_emails(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """施主Noが一致する、パナソニックホームズ↔Genba Info System の対となるメールを返す。"""
    email = db.query(models.Email).get(email_id)
    if not email:
        return []

    current_type = _email_sender_type(email)
    if not current_type:
        return []

    target_type = "panasonic" if current_type == "genba" else "genba"

    # 施主No系フィールドのみに絞る
    site_id_fields = db.query(models.EmailField).filter(
        models.EmailField.email_id == email_id,
        models.EmailField.field_value != None,
        models.EmailField.field_value != "",
    ).all()
    site_id_fields = [f for f in site_id_fields if _is_site_id_field(f.field_name)]

    if not site_id_fields:
        return []

    val_to_name = {f.field_value: f.field_name for f in site_id_fields if f.field_value}
    values = list(val_to_name.keys())

    # 同じ施主No値を持つ他のメールを取得
    related_fields = db.query(models.EmailField).filter(
        models.EmailField.field_value.in_(values),
        models.EmailField.email_id != email_id,
    ).all()

    if not related_fields:
        return []

    eid_to_matches: dict = {}
    for rf in related_fields:
        eid = rf.email_id
        if eid not in eid_to_matches:
            eid_to_matches[eid] = []
        fname = val_to_name.get(rf.field_value, rf.field_name)
        info = f"{fname}: {rf.field_value}"
        if info not in eid_to_matches[eid]:
            eid_to_matches[eid].append(info)

    candidate_emails = db.query(models.Email).options(
        joinedload(models.Email.status_record),
    ).filter(models.Email.id.in_(list(eid_to_matches.keys()))).all()

    # target_type のメールだけに絞る
    result = []
    for e in candidate_emails:
        if _email_sender_type(e) != target_type:
            continue
        result.append({
            "id": e.id,
            "subject": e.subject,
            "from_name": e.from_name,
            "from_address": e.from_address,
            "received_at": e.received_at.isoformat() if e.received_at else None,
            "status": (e.status_record.status.value if e.status_record else "unread"),
            "match_info": eid_to_matches[e.id],
        })

    return sorted(result, key=lambda x: x.get("received_at") or "", reverse=True)


@router.get("/{email_id}/activities", response_model=List[EmailActivityOut])
def get_activities(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).get(email_id)
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")
    return db.query(models.EmailActivity).options(
        joinedload(models.EmailActivity.user)
    ).filter(
        models.EmailActivity.email_id == email_id
    ).order_by(desc(models.EmailActivity.created_at)).all()
