from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, ForeignKey,
    Enum, JSON, Float
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class EmailStatusEnum(str, enum.Enum):
    unread = "unread"
    read = "read"
    in_progress = "in_progress"
    completed = "completed"
    pending = "pending"
    escalated = "escalated"
    replied = "replied"


class LabelTypeEnum(str, enum.Enum):
    manufacturer = "manufacturer"
    category = "category"
    priority = "priority"
    custom = "custom"


class ArchiveStatusEnum(str, enum.Enum):
    pending = "pending"
    extracted = "extracted"
    failed = "failed"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    activities = relationship("EmailActivity", back_populates="user")
    confirmed_emails = relationship("EmailStatusRecord", foreign_keys="EmailStatusRecord.confirmed_by", back_populates="confirmer")
    assigned_emails = relationship("EmailStatusRecord", foreign_keys="EmailStatusRecord.assigned_to", back_populates="assignee")


class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email_address = Column(String(255), nullable=False)
    imap_host = Column(String(255), nullable=False)
    imap_port = Column(Integer, default=993)
    imap_ssl = Column(Boolean, default=True)
    imap_username = Column(String(255), nullable=False)
    imap_password = Column(Text, nullable=False)
    smtp_host = Column(String(255))
    smtp_port = Column(Integer, default=587)
    smtp_ssl = Column(Boolean, default=False)
    smtp_username = Column(String(255))
    smtp_password = Column(Text)
    is_active = Column(Boolean, default=True)
    last_checked = Column(DateTime(timezone=True))
    last_uid = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    emails = relationship("Email", back_populates="account", cascade="all, delete-orphan")


class Label(Base):
    __tablename__ = "labels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    color = Column(String(20), default="#6366f1")
    description = Column(String(255))
    label_type = Column(Enum(LabelTypeEnum), default=LabelTypeEnum.custom)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    email_labels = relationship("EmailLabel", back_populates="label")
    forwarding_rules = relationship("ForwardingRule", back_populates="label")


class Email(Base):
    __tablename__ = "emails"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("email_accounts.id"), nullable=False)
    message_id = Column(String(255))
    subject = Column(String(1000))
    from_address = Column(String(255))
    from_name = Column(String(255))
    to_addresses = Column(JSON, default=list)
    cc_addresses = Column(JSON, default=list)
    body_text = Column(Text)
    body_html = Column(Text)
    received_at = Column(DateTime(timezone=True))
    ai_analyzed = Column(Boolean, default=False)
    ai_summary = Column(Text)
    ai_category = Column(String(100))
    ai_manufacturer = Column(String(255))
    ai_priority = Column(String(20))
    ai_key_info = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("EmailAccount", back_populates="emails")
    email_labels = relationship("EmailLabel", back_populates="email", cascade="all, delete-orphan")
    status_record = relationship("EmailStatusRecord", back_populates="email", uselist=False, cascade="all, delete-orphan")
    activities = relationship("EmailActivity", back_populates="email", cascade="all, delete-orphan")
    forwarding_logs = relationship("ForwardingLog", back_populates="email", cascade="all, delete-orphan")
    csv_matches = relationship("EmailCsvMatch", back_populates="email", cascade="all, delete-orphan")
    extracted_fields = relationship("EmailField", back_populates="email", cascade="all, delete-orphan")
    attachments = relationship("EmailAttachment", back_populates="email", cascade="all, delete-orphan")
    reply_logs = relationship("ReplyLog", back_populates="email", cascade="all, delete-orphan")
    encrypted_archives = relationship("EncryptedArchive", foreign_keys="EncryptedArchive.email_id", back_populates="email", cascade="all, delete-orphan")


class EmailLabel(Base):
    __tablename__ = "email_labels"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    label_id = Column(Integer, ForeignKey("labels.id"), nullable=False)
    assigned_by = Column(String(10), default="ai")  # "ai" or "user"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    email = relationship("Email", back_populates="email_labels")
    label = relationship("Label", back_populates="email_labels")


class EmailStatusRecord(Base):
    __tablename__ = "email_status_records"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False, unique=True)
    status = Column(Enum(EmailStatusEnum), default=EmailStatusEnum.unread)
    assigned_to = Column(Integer, ForeignKey("users.id"))
    confirmed_by = Column(Integer, ForeignKey("users.id"))
    confirmed_at = Column(DateTime(timezone=True))
    notes = Column(Text)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    email = relationship("Email", back_populates="status_record")
    assignee = relationship("User", foreign_keys=[assigned_to], back_populates="assigned_emails")
    confirmer = relationship("User", foreign_keys=[confirmed_by], back_populates="confirmed_emails")


class EmailActivity(Base):
    __tablename__ = "email_activities"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"))
    action = Column(String(100), nullable=False)
    detail = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    email = relationship("Email", back_populates="activities")
    user = relationship("User", back_populates="activities")


class ForwardingRule(Base):
    __tablename__ = "forwarding_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    label_id = Column(Integer, ForeignKey("labels.id"), nullable=False)
    destination_email = Column(String(255), nullable=False)
    subject_template = Column(String(500), default="{subject}")
    body_prefix = Column(Text)
    attach_files = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    forward_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    label = relationship("Label", back_populates="forwarding_rules")
    forwarding_logs = relationship("ForwardingLog", back_populates="rule")


class EmailAttachment(Base):
    __tablename__ = "email_attachments"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    filename = Column(String(500), nullable=False)
    content_type = Column(String(255), default="application/octet-stream")
    file_size = Column(Integer)
    file_path = Column(String(1000))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    email = relationship("Email", back_populates="attachments")


class EmailField(Base):
    __tablename__ = "email_fields"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    field_name = Column(String(100), nullable=False)
    field_value = Column(Text)
    group_id = Column(String(36))  # 複数現場コードをまとめて識別するUUID
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    email = relationship("Email", back_populates="extracted_fields")


class ForwardingLog(Base):
    __tablename__ = "forwarding_logs"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("forwarding_rules.id"))
    email_id = Column(Integer, ForeignKey("emails.id"))
    forwarded_to = Column(String(255))
    forwarded_subject = Column(String(1000))
    forwarded_at = Column(DateTime(timezone=True), server_default=func.now())
    success = Column(Boolean, default=True)
    error_message = Column(Text)

    rule = relationship("ForwardingRule", back_populates="forwarding_logs")
    email = relationship("Email", back_populates="forwarding_logs")


class CsvUpload(Base):
    __tablename__ = "csv_uploads"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(500), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    row_count = Column(Integer, default=0)
    column_names = Column(JSON)

    uploader = relationship("User")
    records = relationship("CsvRecord", back_populates="upload", cascade="all, delete-orphan")


class CsvRecord(Base):
    __tablename__ = "csv_records"

    id = Column(Integer, primary_key=True, index=True)
    upload_id = Column(Integer, ForeignKey("csv_uploads.id"), nullable=False)
    row_index = Column(Integer, nullable=False)
    data = Column(JSON, nullable=False)

    upload = relationship("CsvUpload", back_populates="records")
    email_matches = relationship("EmailCsvMatch", back_populates="csv_record", cascade="all, delete-orphan")


class EmailCsvMatch(Base):
    __tablename__ = "email_csv_matches"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    csv_record_id = Column(Integer, ForeignKey("csv_records.id"), nullable=True)
    upload_id = Column(Integer, ForeignKey("csv_uploads.id"), nullable=False)
    match_field = Column(String(255))      # 照合に使ったメール抽出フィールド名
    match_value = Column(String(500))      # 照合値（発注No等）
    reflection_status = Column(String(20)) # "reflected" | "not_reflected" | null
    date_field = Column(String(100))       # 日付照合に使ったフィールド名
    matched_at = Column(DateTime(timezone=True), server_default=func.now())

    email = relationship("Email", back_populates="csv_matches")
    csv_record = relationship("CsvRecord", back_populates="email_matches")


class ReplyTemplate(Base):
    __tablename__ = "reply_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    destination_email = Column(String(500), nullable=False, default="{送信元メールアドレス}")
    subject_template = Column(String(500), default="Re: {件名}")
    body = Column(Text, nullable=False, default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reply_logs = relationship("ReplyLog", back_populates="template")


class EncryptedArchive(Base):
    __tablename__ = "encrypted_archives"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    attachment_id = Column(Integer, ForeignKey("email_attachments.id"), nullable=True, unique=True)
    password_email_id = Column(Integer, ForeignKey("emails.id"), nullable=True)
    extracted_password = Column(Text, nullable=True)
    status = Column(Enum(ArchiveStatusEnum), default=ArchiveStatusEnum.pending)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    email = relationship("Email", foreign_keys=[email_id], back_populates="encrypted_archives")
    password_email = relationship("Email", foreign_keys=[password_email_id])
    attachment = relationship("EmailAttachment")
    extracted_files = relationship("ExtractedFile", back_populates="archive", cascade="all, delete-orphan")


class ExtractedFile(Base):
    __tablename__ = "extracted_files"

    id = Column(Integer, primary_key=True, index=True)
    archive_id = Column(Integer, ForeignKey("encrypted_archives.id"), nullable=False)
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_size = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    archive = relationship("EncryptedArchive", back_populates="extracted_files")


class ReplyLog(Base):
    __tablename__ = "reply_logs"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    template_id = Column(Integer, ForeignKey("reply_templates.id"), nullable=True)
    sent_to = Column(String(500), nullable=False)
    sent_subject = Column(String(1000))
    sent_body = Column(Text)
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    email = relationship("Email", back_populates="reply_logs")
    template = relationship("ReplyTemplate", back_populates="reply_logs")
    sender = relationship("User")
