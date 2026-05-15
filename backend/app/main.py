import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.database import engine, SessionLocal
from app import models
from app.auth import hash_password
from app.config import settings
from app.api import auth, users, accounts, labels, forwarding, emails, csv_api, documents, reply, archives
from app.tasks.worker import start_scheduler, stop_scheduler

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


@app.get("/health")
def health():
    return {"status": "ok"}
