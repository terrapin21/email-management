import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.database import engine, SessionLocal
from app import models
from app.auth import hash_password
from app.config import settings
from app.api import auth, users, accounts, labels, forwarding, emails, csv_api, documents, reply, archives, extraction
from app.tasks.worker import start_scheduler, stop_scheduler
from app.url_cache import set_site_url

logging.basicConfig(level=logging.INFO)


def init_db():
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # PostgreSQL Enum に 'replied' 値を追加（既存DBへの後付け対応）
        try:
            db.execute(text("ALTER TYPE emailstatusenum ADD VALUE IF NOT EXISTS 'replied'"))
            db.commit()
        except Exception:
            db.rollback()

        # email_fields に group_id カラムを追加（既存DBへの後付け対応）
        try:
            db.execute(text("ALTER TABLE email_fields ADD COLUMN IF NOT EXISTS group_id VARCHAR(36)"))
            db.commit()
        except Exception:
            db.rollback()

        # needs_review を EmailStatusEnum に追加
        try:
            db.execute(text("ALTER TYPE emailstatusenum ADD VALUE IF NOT EXISTS 'needs_review'"))
            db.commit()
        except Exception:
            db.rollback()

        # maker_extraction_configs に map_required カラムを追加
        try:
            db.execute(text("ALTER TABLE maker_extraction_configs ADD COLUMN IF NOT EXISTS map_required BOOLEAN DEFAULT FALSE"))
            db.commit()
        except Exception:
            db.rollback()

        # extraction_fields_config に aliases カラムを追加
        try:
            db.execute(text("ALTER TABLE extraction_fields_config ADD COLUMN IF NOT EXISTS aliases JSON DEFAULT '[]'"))
            db.commit()
        except Exception:
            db.rollback()

        admin = db.query(models.User).filter(models.User.is_admin == True).first()
        if not admin:
            admin_user = models.User(
                username=settings.FIRST_ADMIN_USERNAME,
                email=settings.FIRST_ADMIN_EMAIL,
                full_name="管理者",
                hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
                is_admin=True,
                is_active=True,
            )
            db.add(admin_user)
            db.commit()
            logging.info(f"初期管理者アカウントを作成: {settings.FIRST_ADMIN_USERNAME}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="メール管理システム", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def capture_site_url(request: Request, call_next):
    """リクエストヘッダーからサイトのベースURLを検出してキャッシュする。
    Cloudflare Tunnel 経由の場合は X-Forwarded-Proto / Host ヘッダーを参照する。"""
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host", "")
    )
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    if host and "localhost" not in host and "127.0.0.1" not in host:
        set_site_url(f"{proto}://{host}")
    return await call_next(request)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(accounts.router)
app.include_router(labels.router)
app.include_router(forwarding.router)
app.include_router(emails.router)
app.include_router(csv_api.router)
app.include_router(documents.router)
app.include_router(reply.router)
app.include_router(archives.router)
app.include_router(extraction.router)


@app.get("/health")
def health():
    return {"status": "ok"}
