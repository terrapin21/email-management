import logging
import re
import ssl
import email as email_lib
from email.header import decode_header
from datetime import datetime, timezone
from typing import Optional
import imapclient
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from app import models


def _ssl_context() -> ssl.SSLContext:
    """XServerなど古いTLS実装のサーバー向けに証明書検証を緩和したSSLコンテキスト。"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

logger = logging.getLogger(__name__)


_JP_ENCODINGS = ["utf-8", "iso-2022-jp", "shift_jis", "euc-jp", "latin-1"]


def _decode_bytes(b: bytes, charset: str | None) -> str:
    if charset:
        try:
            return b.decode(charset, errors="replace")
        except (LookupError, UnicodeDecodeError):
            pass
    for enc in _JP_ENCODINGS:
        try:
            return b.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return b.decode("utf-8", errors="replace")


def decode_str(s) -> str:
    if s is None:
        return ""
    # RFC 2047 エンコードヘッダはASCII安全なので、bytesの場合はASCIIでデコードしてから処理する
    if isinstance(s, bytes):
        s = s.decode("ascii", errors="replace")
    try:
        decoded_parts = decode_header(s)
    except Exception:
        return s
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            result.append(_decode_bytes(part, charset))
        else:
            result.append(str(part))
    return "".join(result)


def _has_mime_structure(text: str) -> bool:
    """本文にMIME境界マーカーが残っているか確認する"""
    return bool(re.search(r'--[^\r\n]+\r?\nContent-Type:', text))


def _unfold_header(headers_bytes: bytes) -> bytes:
    """RFC 2822 のフォールドヘッダー（改行+空白）を展開する。"""
    return re.sub(rb'\r?\n[ \t]+', b' ', headers_bytes)


def _extract_filename_from_headers(headers_bytes: bytes) -> str | None:
    """Content-Disposition または Content-Type の name/filename パラメータからファイル名を取得する。"""
    unfolded = _unfold_header(headers_bytes)
    for pattern in (
        rb'Content-Disposition:[^\r\n]*filename\*?=["\']?([^"\';\r\n]+)',
        rb'Content-Type:[^\r\n]*name=["\']?([^"\';\r\n]+)',
    ):
        m = re.search(pattern, unfolded, re.IGNORECASE)
        if m:
            raw = m.group(1).strip().rstrip(b'"\'')
            return decode_str(raw.decode('utf-8', errors='replace'))
    return None


def _extract_mime_parts_fallback(raw: bytes) -> tuple[str, str, list[dict]]:
    """
    標準パーサーがマルチパートを認識できなかった場合のフォールバック。
    rawバイト列から直接境界を探してMIMEパートを抽出・デコードする。
    戻り値: (body_text, body_html, attachments)
    """
    body_text = ""
    body_html = ""
    attachments: list[dict] = []

    # メッセージ全体のContent-Typeヘッダーからboundaryを取得
    boundary_match = re.search(
        rb'[Cc]ontent-[Tt]ype:\s*multipart/[^\r\n;]+;\s*boundary=([^\r\n]+)',
        raw,
    )
    if not boundary_match:
        return body_text, body_html, attachments

    boundary_raw = boundary_match.group(1).strip()
    if boundary_raw.startswith(b'"') and boundary_raw.endswith(b'"'):
        boundary_raw = boundary_raw[1:-1]

    delimiter = b'--' + boundary_raw
    parts = raw.split(delimiter)

    for part in parts[1:]:
        stripped = part.strip()
        if not stripped or stripped.startswith(b'--'):
            continue

        sep = b'\r\n\r\n' if b'\r\n\r\n' in part else b'\n\n'
        if sep not in part:
            continue

        headers_bytes, content = part.split(sep, 1)
        content = content.rstrip(b'\r\n')

        unfolded = _unfold_header(headers_bytes)
        ct_match = re.search(rb'[Cc]ontent-[Tt]ype:\s*([^;\r\n]+)', unfolded)
        charset_match = re.search(rb'charset=["\']?([^"\';\s\r\n>]+)', unfolded, re.IGNORECASE)
        cte_match = re.search(rb'[Cc]ontent-[Tt]ransfer-[Ee]ncoding:\s*([^\r\n]+)', unfolded)
        cd_match = re.search(rb'[Cc]ontent-[Dd]isposition:\s*([^;\r\n]+)', unfolded)

        ct = ct_match.group(1).strip().decode('ascii', errors='ignore').lower() if ct_match else ''
        charset = charset_match.group(1).strip().decode('ascii', errors='ignore') if charset_match else None
        cte = cte_match.group(1).strip().decode('ascii', errors='ignore').lower() if cte_match else ''
        disposition = cd_match.group(1).strip().decode('ascii', errors='ignore').lower() if cd_match else ''

        if 'base64' in cte:
            import base64
            try:
                content = base64.b64decode(content)
            except Exception:
                pass
        elif 'quoted-printable' in cte:
            import quopri
            content = quopri.decodestring(content)

        filename = _extract_filename_from_headers(headers_bytes)

        if filename:
            if content:
                attachments.append({
                    "filename": filename,
                    "content_type": ct or "application/octet-stream",
                    "data": content,
                })
        elif 'attachment' in disposition:
            pass  # 添付だがファイル名なし — スキップ
        elif 'text/plain' in ct and not body_text:
            body_text = _decode_bytes(content, charset)
        elif 'text/html' in ct and not body_html:
            body_html = _decode_bytes(content, charset)

    return body_text, body_html, attachments


def html_to_text(html: str) -> str:
    try:
        soup = BeautifulSoup(html, "lxml")
        return soup.get_text(separator="\n", strip=True)
    except Exception:
        return html


def fetch_new_emails(account: models.EmailAccount, db: Session) -> list[dict]:
    """IMAP接続して新着メールを取得する。"""
    fetched = []
    try:
        server = imapclient.IMAPClient(
            account.imap_host,
            port=account.imap_port,
            ssl=account.imap_ssl,
            ssl_context=_ssl_context() if account.imap_ssl else None,
        )
        server.login(account.imap_username, account.imap_password)

        # 利用可能なフォルダを確認
        folders = server.list_folders()
        folder_names = [f[2] for f in folders]
        logger.info(f"利用可能なフォルダ: {folder_names}")

        server.select_folder("INBOX")

        # 前回取得した最後のUIDより大きいメールを検索
        if account.last_uid and account.last_uid > 0:
            messages = server.search([b"UID", f"{account.last_uid + 1}:*".encode()])
        else:
            # 初回は最新100件のみ
            all_messages = server.search([b"ALL"])
            messages = all_messages[-100:] if len(all_messages) > 100 else all_messages

        logger.info(f"検索結果: {len(messages)}件")

        if not messages:
            server.logout()
            return []

        # 重複を除外（既にDBに存在するmessage_idをスキップ）
        max_uid = account.last_uid or 0

        # 一度に大量取得するとIMAPサーバーがエラーを返すためバッチ処理
        BATCH_SIZE = 50
        for i in range(0, len(messages), BATCH_SIZE):
            batch = messages[i:i + BATCH_SIZE]
            try:
                raw_messages = server.fetch(batch, ["RFC822", "UID"])
            except Exception as e:
                logger.warning(f"バッチ取得エラー (batch {i}〜{i+BATCH_SIZE}): {e}")
                continue

            for uid, data in raw_messages.items():
                if uid > max_uid:
                    max_uid = uid

                raw = data.get(b"RFC822")
                if not raw:
                    continue
                parsed = _parse_raw_email(raw)
                if not parsed:
                    continue

                # 既存チェック（同一アカウント内での重複）
                exists = db.query(models.Email).filter(
                    models.Email.account_id == account.id,
                    models.Email.message_id == parsed["message_id"]
                ).first()
                if exists:
                    continue

                parsed["account_id"] = account.id
                fetched.append(parsed)

        account.last_uid = max_uid
        account.last_checked = datetime.now(timezone.utc)
        db.commit()

        server.logout()
    except Exception as e:
        logger.error(f"IMAP取得エラー (account={account.id}): {e}")

    return fetched


def _parse_raw_email(raw: bytes) -> Optional[dict]:
    try:
        msg = email_lib.message_from_bytes(raw)

        message_id = msg.get("Message-ID", "").strip()
        subject = decode_str(msg.get("Subject", ""))
        from_raw = decode_str(msg.get("From", ""))
        from_name, from_address = _parse_from(from_raw)

        to_raw = decode_str(msg.get("To", ""))
        to_addresses = [a.strip() for a in to_raw.split(",") if a.strip()]

        cc_raw = decode_str(msg.get("Cc", ""))
        cc_addresses = [a.strip() for a in cc_raw.split(",") if a.strip()] if cc_raw else []

        date_str = msg.get("Date", "")
        received_at = _parse_date(date_str)

        body_text = ""
        body_html = ""

        attachments = []

        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                disposition = str(part.get("Content-Disposition", ""))
                filename = part.get_filename()

                if filename:
                    filename = decode_str(filename)
                    payload = part.get_payload(decode=True)
                    if payload:
                        attachments.append({
                            "filename": filename,
                            "content_type": ct,
                            "data": payload,
                        })
                elif ct == "text/plain" and "attachment" not in disposition and not body_text:
                    payload = part.get_payload(decode=True)
                    body_text = _decode_bytes(payload, part.get_content_charset()) if payload else ""
                elif ct == "text/html" and "attachment" not in disposition and not body_html:
                    payload = part.get_payload(decode=True)
                    body_html = _decode_bytes(payload, part.get_content_charset()) if payload else ""
        else:
            payload = msg.get_payload(decode=True)
            if msg.get_content_type() == "text/html":
                body_html = _decode_bytes(payload, msg.get_content_charset()) if payload else ""
                body_text = html_to_text(body_html)
            else:
                body_text = _decode_bytes(payload, msg.get_content_charset()) if payload else ""

        if not body_text and body_html:
            body_text = html_to_text(body_html)

        # 標準パーサーが失敗してMIME構造が本文に残っているか、添付ファイルが取れなかった場合にフォールバック
        needs_fallback = (
            not body_text
            or _has_mime_structure(body_text)
            or (msg.is_multipart() and not attachments and 'mixed' in (msg.get_content_type() or ''))
        )
        if needs_fallback:
            fb_text, fb_html, fb_attachments = _extract_mime_parts_fallback(raw)
            if fb_text:
                body_text = fb_text
            if fb_html and not body_html:
                body_html = fb_html
            if not body_text and body_html:
                body_text = html_to_text(body_html)
            if fb_attachments and not attachments:
                attachments = fb_attachments

        return {
            "message_id": message_id or f"no-id-{hash(raw)}",
            "subject": subject,
            "from_address": from_address,
            "from_name": from_name,
            "to_addresses": to_addresses,
            "cc_addresses": cc_addresses,
            "body_text": body_text[:50000],
            "body_html": body_html[:100000],
            "received_at": received_at,
            "attachments": attachments,
        }
    except Exception as e:
        logger.error(f"メールパースエラー: {e}")
        return None


def _parse_from(from_raw: str):
    """'Name <email>' 形式を分解する"""
    from_raw = from_raw.strip()
    if "<" in from_raw and ">" in from_raw:
        name_part = from_raw.split("<")[0].strip().strip('"')
        addr_part = from_raw.split("<")[1].split(">")[0].strip()
        return name_part, addr_part
    return "", from_raw


def _parse_date(date_str: str) -> Optional[datetime]:
    if not date_str:
        return datetime.now(timezone.utc)
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(date_str)
    except Exception:
        return datetime.now(timezone.utc)


def fetch_attachments_for_message(account: models.EmailAccount, message_id: str) -> list[dict]:
    """転送・ダウンロード用：メッセージIDで特定したメールの添付ファイルデータを取得する。"""
    try:
        server = imapclient.IMAPClient(account.imap_host, port=account.imap_port, ssl=account.imap_ssl,
                                        ssl_context=_ssl_context() if account.imap_ssl else None)
        server.login(account.imap_username, account.imap_password)
        server.select_folder("INBOX")
        messages = server.search(["HEADER", "Message-ID", message_id])
        if not messages:
            server.logout()
            return []
        raw_messages = server.fetch(messages[:1], ["RFC822"])
        for _, data in raw_messages.items():
            raw = data.get(b"RFC822")
            if raw:
                server.logout()
                parsed = _parse_raw_email(raw)
                return parsed.get("attachments", []) if parsed else []
        server.logout()
    except Exception as e:
        logger.error(f"添付ファイル取得エラー (message_id={message_id}): {e}")
    return []


def refetch_email_body(account: models.EmailAccount, message_id: str) -> Optional[dict]:
    """特定メールの本文をIMAPから再取得して再パースする。"""
    try:
        server = imapclient.IMAPClient(account.imap_host, port=account.imap_port, ssl=account.imap_ssl,
                                        ssl_context=_ssl_context() if account.imap_ssl else None)
        server.login(account.imap_username, account.imap_password)
        server.select_folder("INBOX")

        messages = server.search(["HEADER", "Message-ID", message_id])
        if not messages:
            server.logout()
            return None

        raw_messages = server.fetch(messages[:1], ["RFC822"])
        for _, data in raw_messages.items():
            raw = data.get(b"RFC822")
            if raw:
                server.logout()
                return _parse_raw_email(raw)

        server.logout()
        return None
    except Exception as e:
        logger.error(f"本文再取得エラー (message_id={message_id}): {e}")
        return None


def test_imap_connection(host: str, port: int, ssl: bool, username: str, password: str) -> tuple[bool, str]:
    try:
        server = imapclient.IMAPClient(host, port=port, ssl=ssl,
                                        ssl_context=_ssl_context() if ssl else None)
        server.login(username, password)
        server.select_folder("INBOX")
        server.logout()
        return True, "接続成功"
    except Exception as e:
        return False, str(e)
