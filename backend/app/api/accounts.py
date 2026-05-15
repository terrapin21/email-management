from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models
from app.auth import get_current_user, require_admin
from app.schemas import EmailAccountCreate, EmailAccountUpdate, EmailAccountOut
from app.services.imap_service import test_imap_connection, fetch_new_emails
from app.tasks.worker import _run_ai_analysis, _run_forwarding

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=List[EmailAccountOut])
def list_accounts(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    return db.query(models.EmailAccount).order_by(models.EmailAccount.id).all()


@router.post("", response_model=EmailAccountOut)
def create_account(
    payload: EmailAccountCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_admin),
):
    account = models.EmailAccount(**payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.put("/{account_id}", response_model=EmailAccountOut)
def update_account(
    account_id: int,
    payload: EmailAccountUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_admin),
):
    account = db.query(models.EmailAccount).get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")
    for field, val in payload.model_dump(exclude_none=True).items():
        # 空文字列のパスワードは「変更なし」とみなしてスキップ
        if field in ('imap_password', 'smtp_password') and val == '':
            continue
        setattr(account, field, val)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_admin),
):
    account = db.query(models.EmailAccount).get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")
    db.delete(account)
    db.commit()
    return {"ok": True}


@router.post("/{account_id}/test")
def test_connection(
    account_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    account = db.query(models.EmailAccount).get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")
    ok, msg = test_imap_connection(
        account.imap_host, account.imap_port, account.imap_ssl,
        account.imap_username, account.imap_password,
    )
    return {"success": ok, "message": msg}


@router.post("/{account_id}/fetch")
def manual_fetch(
    account_id: int,
    background_tasks: BackgroundTasks,
    reset: bool = False,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """手動でメールを取得する。reset=trueで全件再取得。"""
    account = db.query(models.EmailAccount).get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")

    if reset:
        account.last_uid = 0
        db.commit()

    def do_fetch():
        from app.database import SessionLocal
        from app.tasks.worker import _save_email
        from app.services import archive_service
        s = SessionLocal()
        try:
            acc = s.query(models.EmailAccount).get(account_id)
            new_emails = fetch_new_emails(acc, s)
            saved_batch = []
            for data in new_emails:
                email_obj = _save_email(s, data)
                if email_obj:
                    _run_ai_analysis(s, email_obj)
                    _run_forwarding(s, email_obj)
                    saved_batch.append((email_obj, data.get("attachments", [])))
            for email_obj, raw_attachments in saved_batch:
                archive_service.process_encrypted_attachments(s, email_obj, raw_attachments)
            for email_obj, _ in saved_batch:
                archive_service.try_extract_pending_archives_for_sender(s, email_obj)
        finally:
            s.close()

    background_tasks.add_task(do_fetch)
    return {"message": "全件再取得を開始しました" if reset else "メール取得を開始しました"}
