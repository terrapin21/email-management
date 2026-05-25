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
_ATT_CACHE = Path("/app/attachments/cache")
TIGHT_WINDOW_BEFORE_MINUTES = 5   # clock skew allowance
TIGHT_WINDOW_AFTER_HOURS = 2      # password usually arrives within 1h
FALLBACK_WINDOW_HOURS = 24        # wider search when tight window misses


def is_archive(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith('.zip') or lower.endswith('.7z') or lower.endswith('.zi_')


def _normalize_archive_filename(filename: str) -> str:
    """メール送信時に拡張子を変形されたファイル（.zi_ など）を正規の拡張子に戻す。"""
    if filename.lower().endswith('.zi_'):
        return filename[:-4] + '.zip'
    return filename


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


def _normalize_subject(subject: str) -> str:
    """Re:, Fw:, [パスワード] 等のプレフィックスを除去して正規化する。"""
    s = (subject or '').strip()
    prefixes = [
        r'^Re\s*:\s*', r'^RE\s*:\s*', r'^Fw\s*:\s*', r'^FW\s*:\s*',
        r'^Fwd\s*:\s*', r'^FWD\s*:\s*', r'^\[パスワード[^\]]*\]\s*',
        r'^\[password[^\]]*\]\s*', r'^\[PASS[^\]]*\]\s*', r'^\[PW[^\]]*\]\s*',
    ]
    changed = True
    while changed:
        changed = False
        for p in prefixes:
            new_s = re.sub(p, '', s, flags=re.IGNORECASE)
            if new_s != s:
                s = new_s.strip()
                changed = True
    return s


def _subject_similarity(subj_a: str, subj_b: str) -> float:
    """件名の類似度を 0〜1 で返す（トークン重複率）。"""
    a = _normalize_subject(subj_a)
    b = _normalize_subject(subj_b)
    if not a or not b:
        return 0.0
    tokens_a = set(re.findall(r'[^\s　【】「」（）\[\]]+', a))
    tokens_b = set(re.findall(r'[^\s　【】「」（）\[\]]+', b))
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))


def _query_password_candidates(
    db: Session, archive_email: models.Email,
    window_start: datetime, window_end: datetime,
) -> list:
    candidates = db.query(models.Email).filter(
        models.Email.from_address == archive_email.from_address,
        models.Email.id != archive_email.id,
        models.Email.received_at >= window_start,
        models.Email.received_at <= window_end,
    ).all()
    return [e for e in candidates if e.subject and is_password_email(e.subject)]


def find_password_email(db: Session, archive_email: models.Email) -> Optional[models.Email]:
    if not archive_email.from_address or not archive_email.received_at:
        return None

    received = archive_email.received_at
    if received.tzinfo is None:
        received = received.replace(tzinfo=timezone.utc)

    # Tight window: password usually arrives within 1 hour after the archive email
    pw_candidates = _query_password_candidates(
        db, archive_email,
        received - timedelta(minutes=TIGHT_WINDOW_BEFORE_MINUTES),
        received + timedelta(hours=TIGHT_WINDOW_AFTER_HOURS),
    )

    if not pw_candidates:
        # Fallback: same-day ±24h search
        pw_candidates = _query_password_candidates(
            db, archive_email,
            received - timedelta(hours=FALLBACK_WINDOW_HOURS),
            received + timedelta(hours=FALLBACK_WINDOW_HOURS),
        )

    if not pw_candidates:
        return None
    if len(pw_candidates) == 1:
        return pw_candidates[0]

    # Multiple candidates: pick highest subject similarity
    archive_subj = archive_email.subject or ''
    return max(pw_candidates, key=lambda e: _subject_similarity(archive_subj, e.subject or ''))


def _extract_zip(data: bytes, password: str, output_dir: Path) -> list:
    # 日本語ZIPツール（Lhaplus等）はCP932でパスワードを扱うためUTF-8/CP932の両方を試みる
    pwd_candidates: list[bytes] = []
    for enc in ('utf-8', 'cp932'):
        try:
            b = password.encode(enc)
            if b not in pwd_candidates:
                pwd_candidates.append(b)
        except UnicodeEncodeError:
            pass

    last_err: Exception = RuntimeError("パスワードが正しくありません")
    for pwd_bytes in pwd_candidates:
        try:
            return _do_extract_zip(data, pwd_bytes, output_dir)
        except RuntimeError as e:
            last_err = e
    raise last_err


def _do_extract_zip(data: bytes, pwd_bytes: bytes, output_dir: Path) -> list:
    extracted = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            fname = info.filename
            # ファイル名エンコーディングをCP437→UTF-8/CP932/Shift_JISの順で試みる
            for enc in ['utf-8', 'cp932', 'shift_jis']:
                try:
                    decoded = info.filename.encode('cp437').decode(enc)
                    fname = decoded
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
        try:
            _process_single_attachment(db, email_obj, att_data, filename)
        except Exception as e:
            db.rollback()
            logger.error(f"暗号化アーカイブ処理エラー (email_id={email_obj.id}, file={filename}): {e}")


def _process_single_attachment(db: Session, email_obj: models.Email, att_data: dict, filename: str):
    if not is_archive(filename):
        return
    data = att_data.get('data', b'')
    # .zi_ などの変形拡張子を正規化して処理（バイナリは同一）
    normalized_filename = _normalize_archive_filename(filename)
    if not data or not is_password_protected(data, normalized_filename):
        return

    att_record = db.query(models.EmailAttachment).filter(
        models.EmailAttachment.email_id == email_obj.id,
        models.EmailAttachment.filename == filename,
    ).first()
    if not att_record:
        return

    existing = db.query(models.EncryptedArchive).filter(
        models.EncryptedArchive.attachment_id == att_record.id
    ).first()
    if existing:
        return

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
        return

    pw_email = find_password_email(db, email_obj)
    if pw_email:
        password = extract_password_from_text(pw_email.body_text or '')
        if password:
            _do_extract(db, archive, data, normalized_filename, password, pw_email)

    db.commit()
    logger.info(
        f"暗号化アーカイブ検出: email_id={email_obj.id}, "
        f"attachment={filename}({normalized_filename}), status={archive.status.value}"
    )


def process_existing_archives_for_account(db: Session, account: models.EmailAccount):
    """既存メールの添付ファイルを遡及処理する（機能追加前に届いたメール向け）。"""
    from app.services.imap_service import fetch_attachments_for_message

    attachments = db.query(models.EmailAttachment).join(
        models.Email, models.EmailAttachment.email_id == models.Email.id
    ).filter(
        models.Email.account_id == account.id,
        models.EmailAttachment.filename.ilike('%.zip')
        | models.EmailAttachment.filename.ilike('%.7z')
        | models.EmailAttachment.filename.ilike('%.zi_'),
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

        normalized = _normalize_archive_filename(att.filename)
        if not is_password_protected(data, normalized):
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
                _do_extract(db, archive, data, normalized, password, pw_email)

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
    window_start = (received or datetime.now(timezone.utc)) - timedelta(hours=FALLBACK_WINDOW_HOURS)

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

        data = _load_archive_data(db, archive, att)
        if not data:
            logger.warning(f"添付バイナリ取得失敗のためスキップ: archive_id={archive.id}, att_id={att.id}")
            continue

        _do_extract(db, archive, data, _normalize_archive_filename(att.filename), password, password_email)
        db.commit()
        logger.info(f"パスワードメールで解凍完了: archive_id={archive.id}")


def _load_archive_data(db: Session, archive: models.EncryptedArchive, att: models.EmailAttachment) -> bytes:
    """アーカイブのバイナリを RAW_STORAGE → ATT_CACHE → IMAP の順で取得する。"""
    raw_path = RAW_STORAGE / f"{att.id}.bin"
    if raw_path.exists():
        return raw_path.read_bytes()

    # 新PC移行後など RAW_STORAGE が空の場合は ATT_CACHE を確認
    cache_path = _ATT_CACHE / f"{att.id}.bin"
    if cache_path.exists():
        data = cache_path.read_bytes()
        # 次回以降のために RAW_STORAGE にも保存
        RAW_STORAGE.mkdir(parents=True, exist_ok=True)
        raw_path.write_bytes(data)
        return data

    # 最終手段: IMAP から再取得
    email_obj = db.query(models.Email).get(archive.email_id)
    account = db.query(models.EmailAccount).get(email_obj.account_id) if email_obj else None
    if not email_obj or not account:
        return b''
    try:
        from app.services.imap_service import fetch_attachments_for_message
        att_list = fetch_attachments_for_message(account, email_obj.message_id)
        att_item = next((a for a in att_list if a.get('filename') == att.filename), None)
        data = att_item.get('data', b'') if att_item else b''
        if data:
            RAW_STORAGE.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(data)
        return data
    except Exception as e:
        logger.warning(f"IMAP再取得失敗 att_id={att.id}: {e}")
        return b''
