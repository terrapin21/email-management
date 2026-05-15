export type LabelType = 'manufacturer' | 'category' | 'priority' | 'custom'
export type EmailStatus = 'unread' | 'read' | 'in_progress' | 'completed' | 'pending' | 'escalated' | 'replied'
export type Priority = 'high' | 'medium' | 'low'

export interface User {
  id: number
  username: string
  email: string
  full_name?: string
  is_active: boolean
  is_admin: boolean
  created_at: string
}

export interface Label {
  id: number
  name: string
  color: string
  description?: string
  label_type: LabelType
  is_active: boolean
  created_at: string
}

export interface EmailAccount {
  id: number
  name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_ssl: boolean
  imap_username: string
  smtp_host?: string
  smtp_port?: number
  smtp_ssl?: boolean
  smtp_username?: string
  is_active: boolean
  last_checked?: string
  created_at: string
}

export interface EmailStatusRecord {
  status: EmailStatus
  assigned_to?: number
  confirmed_by?: number
  confirmed_at?: string
  notes?: string
  assignee?: User
  confirmer?: User
}

export interface EmailActivity {
  id: number
  user_id?: number
  action: string
  detail?: string
  created_at: string
  user?: User
}

export interface EmailLabel {
  id: number
  label_id: number
  assigned_by: string
  label: Label
}

export interface EmailField {
  id: number
  field_name: string
  field_value?: string
  group_id?: string
}

export interface EmailAttachment {
  id: number
  email_id: number
  filename: string
  content_type?: string
  file_size?: number
  created_at: string
}

export interface ForwardingLog {
  id: number
  forwarded_to?: string
  forwarded_subject?: string
  forwarded_at: string
  success: boolean
  error_message?: string
}

export interface EmailListItem {
  id: number
  account_id: number
  subject?: string
  from_address?: string
  from_name?: string
  received_at?: string
  ai_analyzed: boolean
  ai_summary?: string
  ai_category?: string
  ai_manufacturer?: string
  ai_priority?: Priority
  created_at: string
  labels: Label[]
  status: EmailStatus
  confirmed_by_name?: string
  is_forwarded: boolean
  registration_status?: 'registered' | 'not_registered' | null
  reflection_status?: 'reflected' | 'not_reflected' | null
}

export interface EmailDetail {
  id: number
  account_id: number
  account?: EmailAccount
  message_id?: string
  subject?: string
  from_address?: string
  from_name?: string
  to_addresses: string[]
  cc_addresses: string[]
  body_text?: string
  received_at?: string
  ai_analyzed: boolean
  ai_summary?: string
  ai_category?: string
  ai_manufacturer?: string
  ai_priority?: Priority
  ai_key_info?: Record<string, string>
  created_at: string
  email_labels: EmailLabel[]
  status_record?: EmailStatusRecord
  extracted_fields: EmailField[]
  attachments: EmailAttachment[]
  csv_matches: EmailCsvMatch[]
  forwarding_logs: ForwardingLog[]
  reply_logs: ReplyLog[]
}

export interface PaginatedEmails {
  total: number
  page: number
  per_page: number
  items: EmailListItem[]
}

export interface CsvUpload {
  id: number
  filename: string
  uploaded_at: string
  row_count: number
  column_names: string[]
  uploader?: { username: string; full_name?: string }
}

export interface CsvRecord {
  id: number
  row_index: number
  data: Record<string, string>
}

export interface EmailCsvMatch {
  id: number
  csv_record_id?: number
  upload_id: number
  match_field?: string
  match_value?: string
  reflection_status?: 'reflected' | 'not_reflected' | null
  date_field?: string
  matched_at: string
  csv_record?: CsvRecord
}

export interface ForwardingRule {
  id: number
  name: string
  label_id: number
  label?: Label
  destination_email: string
  subject_template: string
  body_prefix?: string
  attach_files: boolean
  is_active: boolean
  forward_count: number
  created_at: string
}

export interface RelatedEmail {
  id: number
  subject?: string
  from_name?: string
  from_address?: string
  received_at?: string
  status: EmailStatus
  match_info: string[]
}

export interface ReplyTemplate {
  id: number
  name: string
  destination_email: string
  subject_template: string
  body: string
  is_active: boolean
  created_at: string
}

export interface ReplyLog {
  id: number
  email_id: number
  template_id?: number
  sent_to: string
  sent_subject?: string
  sent_body?: string
  sent_at: string
  sent_by?: number
}

export interface Stats {
  total_emails: number
  unread: number
  in_progress: number
  completed: number
  today_received: number
  accounts_active: number
  labels_count: number
}

export type ArchiveStatus = 'pending' | 'extracted' | 'failed'

export interface ExtractedFile {
  id: number
  archive_id: number
  filename: string
  file_size?: number
  created_at: string
}

export interface EncryptedArchive {
  id: number
  email_id: number
  attachment_id?: number
  password_email_id?: number
  status: ArchiveStatus
  error_message?: string
  created_at: string
  extracted_files: ExtractedFile[]
}
