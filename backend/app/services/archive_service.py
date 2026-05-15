import zipfile
import io
import re
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app import models

logger = logging.getLogger(__name__)

RAW_STORAGE = Path("/app/attachments/raw")
EXTRACTED_STORAGE = Path("/app/attachments/extracted")
SAME_SENDER_WINDOW_HOURS = 48


def is_archive(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith('.zip') or lower.endswith('.7z')


def is_password_protected(data: bytes, filename: str) -> bool:
    if filename.lower().endswith('.zip'):
        return _is_password_protected_zip(data)
    elif filename.lower().endswith('.7z'):
        return _is_password_protected_7z(data)
    return False


def _is_password_protected_zip(data: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for info in zf.infolist():
                if info.flag_bits & 0x1:
                    return True
        return False
    except Exception:
        return False


def _is_password_protected_7z(data: bytes) -> bool:
    try:
        import py7zr
        with py7zr.SevenZipFile(io.BytesIO(data)) as zf:
            return zf.needs_password()
    except ImportError:
        logger.warning("py7zr未インストールのため7z暗号化チェック不可")
        return False
    except Exception:
        return False


def is_password_email(subject: str) -> bool:
    subj_lower = (subject or '').lower()
    return any(kw in subj_lower for kw in ['パスワード', 'password', 'pass'])


def extract_password_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    # パターン1: "パスワード：XXXX" / "パスワード: XXXX" / "パスワード XXXX" 同一行
    patterns = [
        r'解凍パスワード[：:\s]+([^\s\r\n]+)',
        r'パスワード[：:\s]+([^\s\r\n]+)',
        r'password[：:\s]+([^\s\r\n]+)',
        r'PW[：:\s]+([^\s\r\n]+)',
        r'pass[：:\s]+([^\s\r\n]+)',
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            pw = m.group(1).strip().rstrip('。、．,')
            if pw and len(pw) >= 4 and not any(c in pw for c in ['通知', '送付', '案内', 'http']):
                return pw
    # パターン2: "パスワード通知" の後の行・"パスワード:\n次の行" など
    m = re.search(r'パスワード[^\n\r]*[\r\n]+[\r\n\s]*([^\s\r\n]{4,})', text, re.IGNORECASE)
    if m:
        pw = m.group(1).strip()
        if not any(c in pw for c in ['通知', '送付', '案内', 'http', '件名', '送信']):
            return pw
    return _extract_password_with_ai(text)


def _extract_password_with_ai(text: str) -> Optional[str]:
    try:
        import anthropic
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return None
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=100,
            messages=[{
                "role": "user",
                "content": (
                    "以下のメール本文から圧縮ファイルの解凍パスワードを抽出してください。"
                    "パスワード文字列のみを返してください。見つからない場合は「なし」と返してください。\n\n"
                    f"{text[:2000]}"
                )
            }]
        )
        result = response.content[0].text.strip()
        if result and result != 'なし' and len(result) < 100:
            return result
        return None
    except Exception as e:
        logger.warning(f"AIパスワード抽出失敗: {e}")
        return None


def find_password_email(db: Session, archive_email: models.Email) -> Optional[models.Email]:
    if not archive_email.from_address or not archive_email.received_at:
        return None

    received = archive_email.received_at
    if received.tzinfo is None:
        received = received.replace(tzinfo=timezone.utc)

    window_start = received - timedelta(hours=SAME_SENDER_WINDOW_HOURS)
    window_end = received + timedelta(hours=SAME_SENDER_WINDOW_HOURS)

    candidates = db.query(models.Email).filter(
        models.Email.from_address == archive_email.from_address,
        models.Email.id != archive_email.id,
        models.Email.received_at >= window_start,
        models.Email.received_at <= window_end,
    ).all()

    for email in candidates:
        if email.subject and is_password_email(email.subject):
            return email
    return None


def _extract_zip(data: bytes, password: str, output_dir: Path) -> list:
    extracted = []
    pwd_bytes = password.encode('utf-8')
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            fname = info.filename
            for enc in ['utf-8', 'cp932', 'shift_jis']:
                try:
                    fname = info.filename.encode('cp437').decode(enc)
                    break
                except Exception:
                    pass
            safe_name = Path(fname).name or 'file'
            out_path = output_dir / safe_name
            i = 1
            while out_path.exists():
                stem, suffix = Path(safe_name).stem, Path(safe_name).suffix
                out_path = output_dir / f"{stem}_{i}{suffix}"
                i += 1
            content = zf.read(info.filename, pwd=pwd_bytes)
            out_path.write_bytes(content)
            extracted.append({"filename": safe_name, "file_path": str(out_path), "file_size": len(content)})
    return extracted


def _extract_7z(data: bytes, password: str, output_dir: Path) -> list:
    import py7zr
    extracted = []
    with py7zr.SevenZipFile(io.BytesIO(data), password=password) as zf:
        names = zf.getnames()
        zf.extractall(path=str(output_dir))
    for fname in names:
        out_path = output_dir / fname
        if out_path.is_file():
            extracted.append({
                "filename": Path(fname).name,
                "file_path": str(out_path),
                "file_size": out_path.stat().st_size,
            })
    return extracted


def _do_extract(db: Session, archive: models.EncryptedArchive, data: bytes,
                filename: str, password: str, pw_email: models.Email):
    try:
        archive.password_email_id = pw_email.id
        archive.extracted_password = password

        output_dir = EXTRACTED_STORAGE / str(archive.id)
        output_dir.mkdir(parents=True, exist_ok=True)

        lower = filename.lower()
        if lower.endswith('.zip'):
            files = _extract_zip(data, password, output_dir)
        elif lower.endswith('.7z'):
            files = _extract_7z(data, password, output_dir)
        else:
            files = []

        for f in files:
            db.add(models.ExtractedFile(
                archive_id=archive.id,
                filename=f['filename'],
                file_path=f['file_path'],
                file_size=f.get('file_size'),
            ))
        archive.status = models.ArchiveStatusEnum.extracted
        logger.info(f"アーカイブ解凍完了: archive_id={archive.id}, {len(files)}ファイル")
    except Exception as e:
        archive.status = models.ArchiveStatusEnum.failed
        archive.error_message = str(e)
        logger.error(f"アーカイブ解凍失敗: archive_id={archive.id}, {e}")


def process_encrypted_attachments(db: Session, email_obj: models.Email, raw_attachments: list):
    for att_data in raw_attachments:
        filename = att_data.get('filename', '')
        if not is_archive(filename):
            continue
        data = att_data.get('data', b'')
        if not data or not is_password_protected(data, filename):
            continue

        att_record = db.query(models.EmailAttachment).filter(
            models.EmailAttachment.email_id == email_obj.id,
            models.EmailAttachment.filename == filename,
        ).first()
        if not att_record:
            continue

        existing = db.query(models.EncryptedArchive).filter(
            models.EncryptedArchive.attachment_id == att_record.id
        ).first()
        if existing:
            continue

        # 生データをディスクに保存（後でパスワードメールが届いたときに使用）
        RAW_STORAGE.mkdir(parents=True, exist_ok=True)
        raw_path = RAW_STORAGE / f"{att_record.id}.bin"
        raw_path.write_bytes(data)

        archive = models.EncryptedArchive(
            email_id=email_obj.id,
            attachment_id=att_record.id,
            status=models.ArchiveStatusEnum.pending,
        )
        db.add(archive)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            logger.info(f"重複スキップ: attachment_id={att_record.id} は既に処理済み")
            continue

        pw_email = find_password_email(db, email_obj)
        if pw_email:
            password = extract_password_from_text(pw_email.body_text or '')
            if password:
                _do_extract(db, archive, data, filename, password, pw_email)

        db.commit()
        logger.info(
            f"暗号化アーカイブ検出: email_id={email_obj.id}, "
            f"attachment={filename}, status={archive.status.value}"
        )


def process_existing_archives_for_account(db: Session, account: models.EmailAccount):
    """既存メールの添付ファイルを遡及処理する（機能追加前に届いたメール向け）。"""
    from app.services.imap_service import fetch_attachments_for_message

    attachments = db.query(models.EmailAttachment).join(
        models.Email, models.EmailAttachment.email_id == models.Email.id
    ).filter(
        models.Email.account_id == account.id,
        models.EmailAttachment.filename.ilike('%.zip') | models.EmailAttachment.filename.ilike('%.7z'),
    ).all()

    processed = 0
    for att in attachments:
        # 既にEncryptedArchiveレコードがあればスキップ
        existing = db.query(models.EncryptedArchive).filter(
            models.EncryptedArchive.attachment_id == att.id
        ).first()
        if existing:
            continue

        raw_path = RAW_STORAGE / f"{att.id}.bin"
        if raw_path.exists():
            data = raw_path.read_bytes()
        else:
            email_obj = db.query(models.Email).get(att.email_id)
            if not email_obj or not email_obj.message_id:
                continue
            try:
                att_list = fetch_attachments_for_message(account, email_obj.message_id)
            except Exception as e:
                logger.warning(f"IMAP取得失敗 att_id={att.id}: {e}")
                continue
            att_data = next((a for a in att_list if a.get('filename') == att.filename), None)
            if not att_data:
                continue
            data = att_data.get('data', b'')
            if not data:
                continue
            RAW_STORAGE.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(data)

        if not is_password_protected(data, att.filename):
            continue

        email_obj = db.query(models.Email).get(att.email_id)
        if not email_obj:
            continue

        archive = models.EncryptedArchive(
            email_id=email_obj.id,
            attachment_id=att.id,
            status=models.ArchiveStatusEnum.pending,
        )
        db.add(archive)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            logger.info(f"重複スキップ: attachment_id={att.id} は既に処理済み")
            continue

        pw_email = find_password_email(db, email_obj)
        if pw_email:
            password = extract_password_from_text(pw_email.body_text or '')
            if password:
                _do_extract(db, archive, data, att.filename, password, pw_email)

        db.commit()
        processed += 1
        logger.info(
            f"遡及処理: email_id={email_obj.id}, att={att.filename}, "
            f"status={archive.status.value}"
        )

    logger.info(f"遡及処理完了: account={account.email_address}, {processed}件")
    return processed


def try_extract_pending_archives_for_sender(db: Session, password_email: models.Email):
    if not is_password_email(password_email.subject or ''):
        return

    password = extract_password_from_text(password_email.body_text or '')
    if not password:
        logger.info(f"パスワード抽出失敗: email_id={password_email.id}")
        return

    received = password_email.received_at
    if received and received.tzinfo is None:
        received = received.replace(tzinfo=timezone.utc)
    window_start = (received or datetime.now(timezone.utc)) - timedelta(hours=SAME_SENDER_WINDOW_HOURS)

    pending = db.query(models.EncryptedArchive).join(
        models.Email, models.EncryptedArchive.email_id == models.Email.id
    ).filter(
        models.Email.from_address == password_email.from_address,
        models.EncryptedArchive.status == models.ArchiveStatusEnum.pending,
        models.Email.received_at >= window_start,
    ).all()

    for archive in pending:
        att = db.query(models.EmailAttachment).get(archive.attachment_id)
        if not att:
            continue

        raw_path = RAW_STORAGE / f"{att.id}.bin"
        if raw_path.exists():
            data = raw_path.read_bytes()
        else:
            # IMAPから再取得
            email_obj = db.query(models.Email).get(archive.email_id)
            account = db.query(models.EmailAccount).get(email_obj.account_id) if email_obj else None
            if not email_obj or not account:
                continue
            from app.services.imap_service import fetch_attachments_for_message
            att_list = fetch_attachments_for_message(account, email_obj.message_id)
            att_data = next((a for a in att_list if a.get('filename') == att.filename), None)
            if not att_data:
                continue
            data = att_data.get('data', b'')

        _do_extract(db, archive, data, att.filename, password, password_email)
        db.commit()
        logger.info(f"パスワードメールで解凍完了: archive_id={archive.id}")
