from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://mailuser:mailpass@localhost:5432/maildb"
    SECRET_KEY: str = "change-this-secret-key"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ANTHROPIC_API_KEY: str = ""
    POLL_INTERVAL_MINUTES: int = 5
    FIRST_ADMIN_EMAIL: str = "admin@example.com"
    FIRST_ADMIN_PASSWORD: str = "changeme"
    FIRST_ADMIN_USERNAME: str = "admin"
    SITE_URL: str = "http://localhost"

    class Config:
        env_file = ".env"


settings = Settings()
