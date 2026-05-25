from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
from app.models import EmailStatusEnum, LabelTypeEnum


# ── Auth ──────────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    password: str


# ── User ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    password: str
    is_admin: bool = False


class UserUpdate(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str]
    is_active: bool
    is_admin: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Email Account ─────────────────────────────────────────────────────────────

class EmailAccountCreate(BaseModel):
    name: str
    email_address: EmailStr
    imap_host: str
    imap_port: int = 993
    imap_ssl: bool = True
    imap_username: str
    imap_password: str
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_ssl: bool = False
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None


class EmailAccountUpdate(BaseModel):
    name: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    imap_ssl: Optional[bool] = None
    imap_username: Optional[str] = None
    imap_password: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_ssl: Optional[bool] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    is_active: Optional[bool] = None


class EmailAccountOut(BaseModel):
    id: int
    name: str
    email_address: str
    imap_host: str
    imap_port: int
    imap_ssl: bool
    imap_username: str
    smtp_host: Optional[str]
    smtp_port: Optional[int]
    smtp_ssl: Optional[bool]
    smtp_username: Optional[str]
    is_active: bool
    last_checked: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Label ─────────────────────────────────────────────────────────────────────

class LabelCreate(BaseModel):
    name: str
    color: str = "#6366f1"
    description: Optional[str] = None
    label_type: LabelTypeEnum = LabelTypeEnum.custom


class LabelUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    label_type: Optional[LabelTypeEnum] = None
    is_active: Optional[bool] = None


class LabelOut(BaseModel):
    id: int
    name: str
    color: str
    description: Optional[str]
    label_type: LabelTypeEnum
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Forwarding Rule ───────────────────────────────────────────────────────────

class ForwardingRuleCreate(BaseModel):
    name: str
    label_id: int
    destination_email: EmailStr
    subject_template: str = "{subject}"
    body_prefix: Optional[str] = None
    attach_files: bool = False


class ForwardingRuleUpdate(BaseModel):
    name: Optional[str] = None
    label_id: Optional[int] = None
    destination_email: Optional[EmailStr] = None
    subject_template: Optional[str] = None
    body_prefix: Optional[str] = None
    attach_files: Optional[bool] = None
    is_active: Optional[bool] = None


class ForwardingRuleOut(BaseModel):
    id: int
    name: str
    label_id: int
    label: Optional[LabelOut]
    destination_email: str
    subject_template: str
    body_prefix: Optional[str]
    attach_files: bool
    is_active: bool
    forward_count: int
    created_at: datetime

    class Config:
        from_attributes = True


# ── Email ─────────────────────────────────────────────────────────────────────

class EmailAttachmentOut(BaseModel):
    id: int
    email_id: int
    filename: str
    content_type: Optional[str]
    file_size: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class EmailFieldOut(BaseModel):
    id: int
    field_name: str
    field_value: Optional[str]
    group_id: Optional[str] = None

    class Config:
        from_attributes = True


class EmailStatusUpdate(BaseModel):
    status: EmailStatusEnum
    assigned_to: Optional[int] = None
    notes: Optional[str] = None


class EmailLabelAssign(BaseModel):
    label_ids: List[int]


class EmailLabelOut(BaseModel):
    id: int
    label_id: int
    assigned_by: Optional[str]
    label: Optional[LabelOut]

    class Config:
        from_attributes = True


class EmailStatusOut(BaseModel):
    status: EmailStatusEnum
    assigned_to: Optional[int]
    confirmed_by: Optional[int]
    confirmed_at: Optional[datetime]
    notes: Optional[str]
    assignee: Optional[UserOut]
    confirmer: Optional[UserOut]

    class Config:
        from_attributes = True


class EmailActivityOut(BaseModel):
    id: int
    user_id: Optional[int]
    action: str
    detail: Optional[str]
    created_at: datetime
    user: Optional[UserOut]

    class Config:
        from_attributes = True


class ForwardingLogOut(BaseModel):
    id: int
    forwarded_to: Optional[str]
    forwarded_subject: Optional[str]
    forwarded_at: datetime
    success: bool
    error_message: Optional[str]

    class Config:
        from_attributes = True


class EmailOut(BaseModel):
    id: int
    account_id: int
    account: Optional[EmailAccountOut]
    message_id: Optional[str]
    subject: Optional[str]
    from_address: Optional[str]
    from_name: Optional[str]
    to_addresses: List[str]
    cc_addresses: List[str]
    body_text: Optional[str]
    received_at: Optional[datetime]
    ai_analyzed: bool
    ai_summary: Optional[str]
    ai_category: Optional[str]
    ai_manufacturer: Optional[str]
    ai_priority: Optional[str]
    ai_key_info: Optional[Dict[str, Any]]
    created_at: datetime
    email_labels: List[EmailLabelOut] = []
    status_record: Optional[EmailStatusOut]
    extracted_fields: List[EmailFieldOut] = []
    attachments: List[EmailAttachmentOut] = []
    csv_matches: List["EmailCsvMatchOut"] = []
    forwarding_logs: List[ForwardingLogOut] = []
    reply_logs: List["ReplyLogOut"] = []

    class Config:
        from_attributes = True


class EmailListItem(BaseModel):
    id: int
    account_id: int
    subject: Optional[str]
    from_address: Optional[str]
    from_name: Optional[str]
    received_at: Optional[datetime]
    ai_analyzed: bool
    ai_summary: Optional[str]
    ai_category: Optional[str]
    ai_manufacturer: Optional[str]
    ai_priority: Optional[str]
    created_at: datetime
    labels: List[LabelOut] = []
    status: Optional[EmailStatusEnum] = EmailStatusEnum.unread
    confirmed_by_name: Optional[str] = None
    is_forwarded: bool = False
    has_attachments: bool = False
    registration_status: Optional[str] = None   # "registered" | "not_registered" | None
    reflection_status: Optional[str] = None     # "reflected" | "not_reflected" | None
    needs_soonest_date: bool = False
    pickup_note: Optional[str] = None

    class Config:
        from_attributes = True


class PaginatedEmails(BaseModel):
    total: int
    page: int
    per_page: int
    items: List[EmailListItem]


class StatsOut(BaseModel):
    total_emails: int
    unread: int
    in_progress: int
    completed: int
    today_received: int
    accounts_active: int
    labels_count: int


# ── CSV ───────────────────────────────────────────────────────────────────────

class CsvUploadOut(BaseModel):
    id: int
    filename: str
    uploaded_at: datetime
    row_count: int
    column_names: List[str]
    uploader: Optional[UserOut]

    class Config:
        from_attributes = True


class CsvRecordOut(BaseModel):
    id: int
    row_index: int
    data: Dict[str, Any]

    class Config:
        from_attributes = True


class EmailCsvMatchOut(BaseModel):
    id: int
    csv_record_id: Optional[int]
    upload_id: int
    match_field: Optional[str]
    match_value: Optional[str]
    reflection_status: Optional[str]
    date_field: Optional[str]
    matched_at: datetime
    csv_record: Optional[CsvRecordOut]

    class Config:
        from_attributes = True


# ── Reply ─────────────────────────────────────────────────────────────────────

class ReplyTemplateCreate(BaseModel):
    name: str
    destination_email: str = "{送信元メールアドレス}"
    subject_template: str = "Re: {件名}"
    body: str


class ReplyTemplateUpdate(BaseModel):
    name: Optional[str] = None
    destination_email: Optional[str] = None
    subject_template: Optional[str] = None
    body: Optional[str] = None
    is_active: Optional[bool] = None


class ReplyTemplateOut(BaseModel):
    id: int
    name: str
    destination_email: str
    subject_template: str
    body: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ReplyLogOut(BaseModel):
    id: int
    email_id: int
    template_id: Optional[int]
    sent_to: str
    sent_subject: Optional[str]
    sent_body: Optional[str]
    sent_at: datetime
    sent_by: Optional[int]

    class Config:
        from_attributes = True


class SendReplyRequest(BaseModel):
    email_id: int
    template_id: Optional[int] = None
    destination_email: str
    subject: str
    body: str


# ── Archive ───────────────────────────────────────────────────────────────────

class ExtractedFileOut(BaseModel):
    id: int
    archive_id: int
    filename: str
    file_size: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class EncryptedArchiveOut(BaseModel):
    id: int
    email_id: int
    attachment_id: Optional[int]
    password_email_id: Optional[int]
    status: str
    error_message: Optional[str]
    created_at: datetime
    extracted_files: List[ExtractedFileOut] = []

    class Config:
        from_attributes = True


# ── Extraction ────────────────────────────────────────────────────────────────

class ExtractionFieldCreate(BaseModel):
    field_name: str
    field_type: str = "text"
    required: bool = True
    order: int = 0
    aliases: List[str] = []


class ExtractionFieldOut(BaseModel):
    id: int
    field_name: str
    field_type: str
    required: bool
    order: int
    aliases: List[str] = []

    class Config:
        from_attributes = True


class MakerExtractionConfigCreate(BaseModel):
    maker_name: str
    excel_file_path: Optional[str] = None
    map_save_path: Optional[str] = None
    map_date_field: str = "回収日"
    map_required: bool = False
    fields: List[ExtractionFieldCreate] = []


class MakerExtractionConfigUpdate(BaseModel):
    maker_name: Optional[str] = None
    excel_file_path: Optional[str] = None
    map_save_path: Optional[str] = None
    map_date_field: Optional[str] = None
    map_required: Optional[bool] = None
    fields: Optional[List[ExtractionFieldCreate]] = None


class MakerExtractionConfigOut(BaseModel):
    id: int
    maker_name: str
    excel_file_path: Optional[str]
    map_save_path: Optional[str]
    map_date_field: str
    map_required: bool
    fields: List[ExtractionFieldOut] = []
    created_at: datetime

    class Config:
        from_attributes = True


class ExtractionResultOut(BaseModel):
    id: int
    email_id: int
    config_id: int
    extracted_data: Dict[str, Any]
    status: str
    review_reason: Optional[str]
    attachment_pattern: Optional[str]
    excel_written: bool
    needs_soonest_date: bool = False
    soonest_date_field: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
