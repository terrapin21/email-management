import logging
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from urllib.parse import quote
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from app.database import get_db
from app import models
from app.auth import get_current_user
from app.schemas import EncryptedArchiveOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/archives", tags=["archives"])


@router.post("/process-all")
def process_all_existing(
    background_tasks: BackgroundTasks,
    account_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """既存メールのパスワード付き圧縮ファイルを遡及処理する。"""
    from app.services.archive_service import process_existing_archives_for_account

    if account_id:
        accounts = db.query(models.EmailAccount).filter(
            models.EmailAccount.id == account_id,
            models.EmailAccount.is_active == True,
        ).all()
    else:
        accounts = db.query(models.EmailAccount).filter(
            models.EmailAccount.is_active == True
        ).all()

    account_ids = [a.id for a in accounts]

    def do_process():
        from app.database import SessionLocal
        s = SessionLocal()
        try:
            total = 0
            for aid in account_ids:
                acc = s.query(models.EmailAccount).get(aid)
                if acc:
                    total += process_existing_archives_for_account(s, acc)
            logger.info(f"遡及処理完了: 合計{total}件")
        finally:
            s.close()

    background_tasks.add_task(do_process)
    return {"message": f"{len(accounts)}アカウントの遡及処理を開始しました"}


@router.get("/email/{email_id}", response_model=List[EncryptedArchiveOut])
def get_email_archives(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    return db.query(models.EncryptedArchive).options(
        joinedload(models.EncryptedArchive.extracted_files)
    ).filter(
        models.EncryptedArchive.email_id == email_id
    ).all()


@router.post("/{archive_id}/retry")
def retry_extraction(
    archive_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    archive = db.query(models.EncryptedArchive).options(
        joinedload(models.EncryptedArchive.attachment)
    ).get(archive_id)
    if not archive:
        raise HTTPException(status_code=404, detail="アーカイブが見つかりません")

    from app.services.archive_service import (
        find_password_email, extract_password_from_text, _do_extract, RAW_STORAGE
    )

    email_obj = db.query(models.Email).get(archive.email_id)
    att = archive.attachment
    if not email_obj or not att:
        raise HTTPException(status_code=400, detail="メールまたは添付ファイルが見つかりません")

    raw_path = RAW_STORAGE / f"{att.id}.bin"
    if raw_path.exists():
        data = raw_path.read_bytes()
    else:
        account = db.query(models.EmailAccount).get(email_obj.account_id)
        if not account:
            raise HTTPException(status_code=400, detail="アカウントが見つかりません")
        from app.services.imap_service import fetch_attachments_for_message
        att_list = fetch_attachments_for_message(account, email_obj.message_id)
        att_data = next((a for a in att_list if a.get('filename') == att.filename), None)
        if not att_data:
            raise HTTPException(status_code=404, detail="IMAPサーバーで添付ファイルが見つかりません")
        data = att_data.get('data', b'')

    pw_email = find_password_email(db, email_obj)
    if not pw_email:
        raise HTTPException(status_code=400, detail="パスワードメールが見つかりません")

    password = extract_password_from_text(pw_email.body_text or '')
    if not password:
        raise HTTPException(status_code=400, detail="パスワードを抽出できませんでした")

    db.query(models.ExtractedFile).filter(
        models.ExtractedFile.archive_id == archive_id
    ).delete()
    archive.status = models.ArchiveStatusEnum.pending
    archive.error_message = None
    db.flush()

    _do_extract(db, archive, data, att.filename, password, pw_email)
    db.commit()
    return {"ok": True, "status": archive.status.value}


@router.get("/{archive_id}/files/{file_id}/download")
def download_extracted_file(
    archive_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    ef = db.query(models.ExtractedFile).filter(
        models.ExtractedFile.id == file_id,
        models.ExtractedFile.archive_id == archive_id,
    ).first()
    if not ef:
        raise HTTPException(status_code=404, detail="ファイルが見つかりません")

    file_path = Path(ef.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="ファイルが見つかりません（ディスク上に存在しません）")

    filename_enc = quote(ef.filename, encoding="utf-8", safe="")
    return FileResponse(
        path=str(file_path),
        filename=ef.filename,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename_enc}"},
    )
