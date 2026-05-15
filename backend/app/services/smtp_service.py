import smtplib
import ssl
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email.header import Header
from email import encoders
from app import models
from app.config import settings

logger = logging.getLogger(__name__)


def build_subject(template: str, email: models.Email, fields: dict | None = None) -> str:
    """件名テンプレートに変数を展開する。"""
    mapping = {
        "{subject}": email.subject or "",
        "{from}": email.from_address or "",
        "{from_name}": email.from_name or "",
        "{category}": email.ai_category or "",
        "{manufacturer}": email.ai_manufacturer or "",
        "{priority}": email.ai_priority or "",
        "{date}": email.received_at.strftime("%Y-%m-%d") if email.received_at else "",
    }
    result = template
    for key, val in mapping.items():
        result = result.replace(key, val)
    for name, value in (fields or {}).items():
        result = result.replace(f"【{name}】", value or "")
    return result


def _apply_field_placeholders(text: str, fields: dict, detail_url: str = "") -> str:
    if "【解析データ全て】" in text:
        all_data = "\n".join(f"{k}：{v}" for k, v in fields.items() if v)
        if detail_url:
            all_data += f"\n\nメール詳細URL：{detail_url}"
        text = text.replace("【解析データ全て】", all_data)
    text = text.replace("【メール詳細URL】", detail_url)
    for name, value in fields.items():
        text = text.replace(f"【{name}】", value or "")
    return text


def forward_email(
    account: models.EmailAccount,
    rule: models.ForwardingRule,
    email: models.Email,
    fields: dict | None = None,
    attachments: list | None = None,
) -> tuple[bool, str]:
    """SMTPでメールを転送する。attachments は {filename, content_type, data} のリスト。"""
    if not account.smtp_host:
        return False, "SMTPホストが設定されていません"

    extracted = fields or {}
    detail_url = f"{settings.SITE_URL}/emails/{email.id}"

    try:
        subject = build_subject(rule.subject_template, email, extracted)

        # 添付ファイルがある場合は mixed、なければ alternative
        msg = MIMEMultipart("mixed" if attachments else "alternative")
        msg["From"] = account.email_address
        msg["To"] = rule.destination_email
        msg["Subject"] = str(Header(subject, "utf-8"))

        # 本文組み立て
        body_lines = []
        if rule.body_prefix:
            prefix = _apply_field_placeholders(rule.body_prefix, extracted, detail_url)
            body_lines.append(prefix)
            body_lines.append("\n" + "─" * 40 + "\n")

        body_lines.append(f"元の件名: {email.subject or ''}")
        body_lines.append(f"送信者: {email.from_name or ''} <{email.from_address or ''}>")
        if email.received_at:
            body_lines.append(f"受信日時: {email.received_at.strftime('%Y-%m-%d %H:%M')}")
        body_lines.append("\n" + "─" * 40 + "\n")

        if email.ai_summary:
            body_lines.append(f"【AI要約】\n{email.ai_summary}\n")
            body_lines.append("─" * 40 + "\n")

        body_lines.append(email.body_text or "")

        body_text = "\n".join(body_lines)
        msg.attach(MIMEText(body_text, "plain", "utf-8"))

        # 添付ファイルを追加
        for att in (attachments or []):
            try:
                mime_type = att.get("content_type", "application/octet-stream")
                main_type, sub_type = mime_type.split("/", 1) if "/" in mime_type else ("application", "octet-stream")
                part = MIMEBase(main_type, sub_type)
                part.set_payload(att["data"])
                encoders.encode_base64(part)
                filename = att.get("filename", "attachment")
                part.add_header(
                    "Content-Disposition",
                    "attachment",
                    filename=("utf-8", "", filename),
                )
                msg.attach(part)
            except Exception as e:
                logger.warning(f"添付ファイル追加スキップ ({att.get('filename')}): {e}")

        # ポート465はSSL直結(SMTP_SSL)、587はSTARTTLS
        use_ssl = account.smtp_ssl or account.smtp_port == 465
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        smtp_class = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        with smtp_class(account.smtp_host, account.smtp_port, context=ctx if use_ssl else None) as server:
            if not use_ssl:
                server.starttls(context=ctx)
            smtp_user = account.smtp_username or account.imap_username
            smtp_pass = account.smtp_password or account.imap_password
            server.login(smtp_user, smtp_pass)
            server.sendmail(account.email_address, rule.destination_email, msg.as_string())

        return True, ""
    except Exception as e:
        logger.error(f"転送エラー (rule={rule.id}, email={email.id}): {e}")
        return False, str(e)
