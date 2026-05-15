import re
import smtplib
import ssl
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.header import Header
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.auth import get_current_user
from app import models, schemas

router = APIRouter(prefix="/api/reply", tags=["reply"])
logger = logging.getLogger(__name__)

AVAILABLE_TAGS = [
    ["{送信元メールアドレス}", "送信者のメールアドレス（宛先にも使用可）"],
    ["{送信者名}", "送信者の名前"],
    ["{件名}", "受信メールの件名"],
    ["{メーカー}", "AIが解析したメーカー/会社名"],
    ["{カテゴリ}", "AIが解析したカテゴリ"],
    ["{施主No}", "施主No・現場コードなど現場固有ID（複数時はカンマ区切り）。フィールド名が異なる場合も自動対応"],
    ["{現場コード}", "施主No と同じく現場固有ID（フィールド名に合わせて使用）"],
    ["{回収日}", "抽出データ: 回収日（存在する場合）"],
    ["{保管場所}", "抽出データ: 保管場所（存在する場合）"],
]

# 施主No系フィールドを判定するキーワード（worker.py と同じリスト）
_SITE_ID_KEYWORDS = [
    "施主", "工事番号", "現場コード", "現場no", "発注no", "案件no", "物件コード",
    "site id", "site no", "site code", "genba no",
]

def _is_site_id_field(name: str) -> bool:
    n = name.lower()
    return any(k in n for k in _SITE_ID_KEYWORDS)


def _build_fields(email: models.Email) -> dict[str, str]:
    """extracted_fields を {field_name: value} に変換。同名フィールドはカンマ結合。"""
    fields: dict[str, str] = {}
    for f in (email.extracted_fields or []):
        name = f.field_name
        val = f.field_value or ""
        if not val:
            continue
        if name in fields:
            existing = fields[name]
            # 重複値は追加しない
            existing_vals = [v.strip() for v in existing.split(",")]
            new_vals = [v.strip() for v in val.split(",") if v.strip() not in existing_vals]
            if new_vals:
                fields[name] = existing + "," + ",".join(new_vals)
        else:
            fields[name] = val
    return fields


def _resolve(template: str, email: models.Email) -> str:
    fields = _build_fields(email)
    result = template
    result = result.replace("{送信元メールアドレス}", email.from_address or "")
    result = result.replace("{送信者名}", email.from_name or "")
    result = result.replace("{件名}", email.subject or "")
    result = result.replace("{メーカー}", email.ai_manufacturer or "")
    result = result.replace("{カテゴリ}", email.ai_category or "")

    # 1. フィールド名完全一致で置換
    for name, value in fields.items():
        result = result.replace(f"{{{name}}}", value)

    # 2. 未解決の施主No系タグを、メール内の施主No系フィールド値で補完
    site_id_value = next(
        (v for k, v in fields.items() if _is_site_id_field(k) and v), ""
    )
    if site_id_value:
        result = re.sub(
            r'\{([^}]+)\}',
            lambda m: site_id_value if _is_site_id_field(m.group(1)) else m.group(0),
            result,
        )

    return result


# ── Templates CRUD ─────────────────────────────────────────────────────────────

@router.get("/tags")
def get_tags(_: models.User = Depends(get_current_user)):
    return AVAILABLE_TAGS


@router.get("/templates", response_model=List[schemas.ReplyTemplateOut])
def list_templates(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return db.query(models.ReplyTemplate).order_by(models.ReplyTemplate.created_at).all()


@router.post("/templates", response_model=schemas.ReplyTemplateOut)
def create_template(
    body: schemas.ReplyTemplateCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    t = models.ReplyTemplate(**body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.get("/templates/{template_id}", response_model=schemas.ReplyTemplateOut)
def get_template(template_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    t = db.query(models.ReplyTemplate).filter(models.ReplyTemplate.id == template_id).first()
    if not t:
        raise HTTPException(404, "テンプレートが見つかりません")
    return t


@router.put("/templates/{template_id}", response_model=schemas.ReplyTemplateOut)
def update_template(
    template_id: int,
    body: schemas.ReplyTemplateUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    t = db.query(models.ReplyTemplate).filter(models.ReplyTemplate.id == template_id).first()
    if not t:
        raise HTTPException(404, "テンプレートが見つかりません")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    t = db.query(models.ReplyTemplate).filter(models.ReplyTemplate.id == template_id).first()
    if not t:
        raise HTTPException(404, "テンプレートが見つかりません")
    db.delete(t)
    db.commit()
    return {"ok": True}


# ── Send ───────────────────────────────────────────────────────────────────────

@router.post("/send")
def send_reply(
    body: schemas.SendReplyRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    email = (
        db.query(models.Email)
        .options(
            joinedload(models.Email.account),
            joinedload(models.Email.extracted_fields),
            joinedload(models.Email.status_record),
        )
        .filter(models.Email.id == body.email_id)
        .first()
    )
    if not email:
        raise HTTPException(404, "メールが見つかりません")

    account = email.account
    if not account or not account.smtp_host:
        raise HTTPException(400, "SMTPが設定されていません")

    destination = _resolve(body.destination_email, email)
    if not destination or "@" not in destination:
        raise HTTPException(400, f"宛先メールアドレスが無効です: {destination!r}")

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = account.email_address
        msg["To"] = destination
        msg["Subject"] = str(Header(body.subject, "utf-8"))
        msg.attach(MIMEText(body.body, "plain", "utf-8"))

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
            server.sendmail(account.email_address, destination, msg.as_string())
    except Exception as e:
        logger.error(f"返信送信エラー (email={email.id}): {e}")
        raise HTTPException(500, f"送信エラー: {e}")

    log = models.ReplyLog(
        email_id=email.id,
        template_id=body.template_id,
        sent_to=destination,
        sent_subject=body.subject,
        sent_body=body.body,
        sent_by=current_user.id,
    )
    db.add(log)

    if not email.status_record:
        sr = models.EmailStatusRecord(email_id=email.id, status=models.EmailStatusEnum.replied)
        db.add(sr)
    else:
        email.status_record.status = models.EmailStatusEnum.replied

    db.add(models.EmailActivity(
        email_id=email.id,
        user_id=current_user.id,
        action="reply_sent",
        detail=f"返信送信 → {destination} / 件名: {body.subject}",
    ))
    db.commit()

    return {"ok": True, "sent_to": destination}


# ── Logs ───────────────────────────────────────────────────────────────────────

@router.get("/logs/{email_id}", response_model=List[schemas.ReplyLogOut])
def get_reply_logs(
    email_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    return (
        db.query(models.ReplyLog)
        .filter(models.ReplyLog.email_id == email_id)
        .order_by(models.ReplyLog.sent_at.desc())
        .all()
    )
