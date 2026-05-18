import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getEmail, updateEmailStatus, confirmEmail, setEmailLabels,
  reanalyzeEmail, refetchEmailBody, getLabels, getEmailActivities, getUsers,
  downloadAttachment, prefetchAttachments, forwardEmail, getReplyTemplates, sendReply, getReplyLogs,
  getRelatedEmails, getEmailArchives, retryArchiveExtraction, downloadExtractedFile
} from '../api/client'
import { EmailDetail as IEmailDetail, Label, User, ReplyTemplate, ReplyLog, RelatedEmail, EncryptedArchive } from '../types'
import StatusBadge from '../components/StatusBadge'
import LabelBadge from '../components/LabelBadge'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Bot, CheckCircle, Tag, RefreshCw, User as UserIcon,
  AlertTriangle, Package, FileText, ListChecks, Paperclip, Download, DatabaseZap, Forward, Link,
  MessageSquare, Send, ChevronDown, ChevronUp, ExternalLink, Archive, Clock, XCircle
} from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'unread', label: '未読' },
  { value: 'read', label: '既読' },
  { value: 'in_progress', label: '対応中' },
  { value: 'completed', label: '完了' },
  { value: 'pending', label: '保留' },
  { value: 'escalated', label: 'エスカレーション' },
  { value: 'replied', label: '返信済み' },
]

export default function EmailDetailPage() {
  const { id } = useParams<{ id: string }>()
  const emailId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()

  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedLabels, setSelectedLabels] = useState<number[]>([])
  const [labelsInitialized, setLabelsInitialized] = useState(false)
  const [notes, setNotes] = useState('')
  const [downloadingIds, setDownloadingIds] = useState<Set<number>>(new Set())

  // 返信セクション
  const [replyOpen, setReplyOpen] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('')
  const [replyTo, setReplyTo] = useState('')
  const [replySubject, setReplySubject] = useState('')
  const [replyBody, setReplyBody] = useState('')

  const { data: email, isLoading } = useQuery<IEmailDetail>({
    queryKey: ['email', emailId],
    queryFn: () => getEmail(emailId).then((r) => r.data),
  })

  useEffect(() => {
    if (!email) return
    if (!labelsInitialized) {
      setSelectedLabels(email.email_labels.map((el: { label_id: number }) => el.label_id))
      setLabelsInitialized(true)
    }
    setSelectedStatus(email.status_record?.status || 'unread')
    setNotes(email.status_record?.notes || '')
  }, [email])

  // 添付ファイルがある場合はバックグラウンドでキャッシュ開始（ダウンロード高速化）
  useEffect(() => {
    if (email?.attachments && email.attachments.length > 0) {
      prefetchAttachments(emailId).catch(() => {})
    }
  }, [emailId, email?.attachments?.length])

  const { data: allLabels } = useQuery<Label[]>({
    queryKey: ['labels'],
    queryFn: () => getLabels().then((r) => r.data),
  })

  const { data: activities } = useQuery({
    queryKey: ['email-activities', emailId],
    queryFn: () => getEmailActivities(emailId).then((r) => r.data),
  })

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => getUsers().then((r) => r.data),
  })

  const statusMut = useMutation({
    mutationFn: () => updateEmailStatus(emailId, { status: selectedStatus, notes }),
    onSuccess: () => {
      toast.success('ステータスを更新しました')
      qc.refetchQueries({ queryKey: ['email', emailId] })
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: () => toast.error('更新に失敗しました'),
  })

  const confirmMut = useMutation({
    mutationFn: () => confirmEmail(emailId),
    onSuccess: () => {
      toast.success('確認済みにしました')
      qc.refetchQueries({ queryKey: ['email', emailId] })
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
  })

  const labelsMut = useMutation({
    mutationFn: () => setEmailLabels(emailId, selectedLabels),
    onSuccess: () => { toast.success('ラベルを更新しました'); qc.refetchQueries({ queryKey: ['email', emailId] }) },
  })

  const reanalyzeMut = useMutation({
    mutationFn: () => reanalyzeEmail(emailId),
    onSuccess: () => {
      toast.success('AI再解析を開始しました')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['email', emailId] }), 5000)
    },
  })

  const refetchMut = useMutation({
    mutationFn: () => refetchEmailBody(emailId),
    onSuccess: () => {
      toast.success('本文を再取得しました')
      qc.invalidateQueries({ queryKey: ['email', emailId] })
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || '本文の再取得に失敗しました'),
  })

  const forwardMut = useMutation({
    mutationFn: () => forwardEmail(emailId),
    onSuccess: () => {
      toast.success('転送を開始しました')
      setTimeout(() => qc.invalidateQueries({ queryKey: ['email', emailId] }), 3000)
    },
    onError: () => toast.error('転送に失敗しました'),
  })

  const { data: relatedEmails = [] } = useQuery<RelatedEmail[]>({
    queryKey: ['related-emails', emailId],
    queryFn: () => getRelatedEmails(emailId).then(r => r.data),
  })

  const { data: replyTemplates = [] } = useQuery<ReplyTemplate[]>({
    queryKey: ['reply-templates'],
    queryFn: () => getReplyTemplates().then(r => r.data),
  })

  const { data: replyLogs = [], refetch: refetchReplyLogs } = useQuery<ReplyLog[]>({
    queryKey: ['reply-logs', emailId],
    queryFn: () => getReplyLogs(emailId).then(r => r.data),
  })

  const { data: archives = [], refetch: refetchArchives } = useQuery<EncryptedArchive[]>({
    queryKey: ['email-archives', emailId],
    queryFn: () => getEmailArchives(emailId).then(r => r.data),
  })

  const retryArchiveMut = useMutation({
    mutationFn: (archiveId: number) => retryArchiveExtraction(archiveId),
    onSuccess: () => {
      toast.success('再解凍を開始しました')
      setTimeout(() => refetchArchives(), 2000)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '再解凍に失敗しました'),
  })

  const replyMut = useMutation({
    mutationFn: () => sendReply({
      email_id: emailId,
      template_id: selectedTemplateId !== '' ? selectedTemplateId : null,
      destination_email: replyTo,
      subject: replySubject,
      body: replyBody,
    }),
    onSuccess: (res) => {
      toast.success(`返信を送信しました → ${res.data.sent_to}`)
      setReplyOpen(false)
      setSelectedTemplateId('')
      setReplyTo('')
      setReplySubject('')
      setReplyBody('')
      refetchReplyLogs()
      qc.refetchQueries({ queryKey: ['email', emailId] })
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '送信に失敗しました'),
  })

  const toggleLabel = (labelId: number) => {
    setSelectedLabels((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId]
    )
  }

  if (isLoading) return <div className="p-8 text-center text-gray-400">読み込み中...</div>
  if (!email) return <div className="p-8 text-center text-gray-400">メールが見つかりません</div>

  const CODE_KEYWORDS = ['コード', '施主', '工事番号', '現場コード', '現場no', '発注no', '案件no', '物件コード', 'site id', 'site no', 'site code', 'genba no']
  const isCodeField = (name: string) => CODE_KEYWORDS.some(k => name.toLowerCase().includes(k.toLowerCase()))

  const buildFields = (): Record<string, string> => {
    const fields: Record<string, string> = {}
    for (const f of (email.extracted_fields || [])) {
      const name = f.field_name
      const val = f.field_value || ''
      if (!val) continue
      if (name in fields) {
        const existing = fields[name].split(',').map(v => v.trim())
        const newVals = val.split(',').map(v => v.trim()).filter(v => v && !existing.includes(v))
        if (newVals.length) fields[name] = fields[name] + ',' + newVals.join(',')
      } else {
        fields[name] = val
      }
    }
    return fields
  }

  const resolveTags = (template: string): string => {
    const fields = buildFields()
    let result = template
    result = result.replace(/\{送信元メールアドレス\}/g, email.from_address || '')
    result = result.replace(/\{送信者名\}/g, email.from_name || '')
    result = result.replace(/\{件名\}/g, email.subject || '')
    result = result.replace(/\{メーカー\}/g, email.ai_manufacturer || '')
    result = result.replace(/\{カテゴリ\}/g, email.ai_category || '')

    // 1. フィールド名完全一致で置換
    for (const [name, value] of Object.entries(fields)) {
      result = result.replace(new RegExp(`\\{${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), value)
    }

    // 2. 未解決のコード系タグを、メール内のコードフィールド値で補完
    const siteIdEntry = Object.entries(fields).find(([k, v]) => isCodeField(k) && v)
    if (siteIdEntry) {
      const siteIdValue = siteIdEntry[1]
      result = result.replace(/\{([^}]+)\}/g, (match, name) =>
        isCodeField(name) ? siteIdValue : match
      )
    }

    return result
  }

  const applyTemplate = (templateId: number | '') => {
    setSelectedTemplateId(templateId)
    if (templateId === '') {
      setReplyTo('')
      setReplySubject('')
      setReplyBody('')
      return
    }
    const t = replyTemplates.find(t => t.id === templateId)
    if (!t) return
    setReplyTo(resolveTags(t.destination_email))
    setReplySubject(resolveTags(t.subject_template))
    setReplyBody(resolveTags(t.body))
  }

  // 日付文字列を年・月・日に分解する（取得できない場合はnull）
  const parseDateParts = (value: string): { year: string; month: string; day: string } | null => {
    const s = value.trim()

    // 年が省略された場合の年を決定：今年の該当日が今日以降なら今年、過去なら来年
    const resolveYear = (month: number, day: number): string => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const currentYear = today.getFullYear()
      const candidate = new Date(currentYear, month - 1, day)
      return candidate >= today ? String(currentYear) : String(currentYear + 1)
    }

    let m: RegExpMatchArray | null

    // 年あり: YYYY/MM/DD or YYYY-MM-DD
    m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
    if (m) return { year: m[1], month: String(parseInt(m[2])), day: String(parseInt(m[3])) }

    // 年あり: YYYY年M月D日
    m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/)
    if (m) return { year: m[1], month: String(parseInt(m[2])), day: String(parseInt(m[3])) }

    // 年あり: YYYY　M　D（書類解析形式）
    m = s.match(/^(\d{4})[　\s]+(\d{1,2})[　\s]+(\d{1,2})$/)
    if (m) return { year: m[1], month: String(parseInt(m[2])), day: String(parseInt(m[3])) }

    // 年なし: M/D
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (m) {
      const month = parseInt(m[1]), day = parseInt(m[2])
      return { year: resolveYear(month, day), month: String(month), day: String(day) }
    }

    // 年なし: M月D日
    m = s.match(/^(\d{1,2})月(\d{1,2})日/)
    if (m) {
      const month = parseInt(m[1]), day = parseInt(m[2])
      return { year: resolveYear(month, day), month: String(month), day: String(day) }
    }

    // 年なし: M-D
    m = s.match(/^(\d{1,2})\-(\d{1,2})$/)
    if (m) {
      const month = parseInt(m[1]), day = parseInt(m[2])
      return { year: resolveYear(month, day), month: String(month), day: String(day) }
    }

    return null
  }

  // フィールド名が日付系かどうか判定
  const isDateField = (name: string): boolean =>
    /日$|日時$|date|期限|期日|納期|予定|希望日|回収日|納品日|工事日/i.test(name)

  // Power Automate Desktop で安定して要素を指定できるよう、スペース・括弧等を除去したIDを生成
  const toSafeId = (name: string): string =>
    name.replace(/[\s　（）()【】「」]/g, '')

  const isMultipleCodes = (f: { field_name: string; field_value?: string; group_id?: string }) =>
    !!f.group_id && isCodeField(f.field_name) && !!f.field_value && f.field_value.split(',').filter(v => v.trim()).length > 1

  const priorityColor: Record<string, string> = {
    high: 'text-red-500 bg-red-50',
    medium: 'text-yellow-600 bg-yellow-50',
    low: 'text-gray-500 bg-gray-50',
  }
  const priorityLabel: Record<string, string> = { high: '高', medium: '中', low: '低' }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <button
        onClick={() => navigate((location.state as any)?.from || '/emails')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <ArrowLeft size={16} /> 戻る
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                {email.subject || '(件名なし)'}
              </h1>
              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusBadge status={email.status_record?.status || 'unread'} />
                {email.forwarding_logs.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">
                    <Forward size={10} /> 転送済み ({email.forwarding_logs.length}件)
                  </span>
                )}
                <button
                  onClick={() => forwardMut.mutate()}
                  disabled={forwardMut.isPending}
                  className="flex items-center gap-1 text-xs border border-indigo-300 text-indigo-600 rounded-lg px-3 py-1 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                  title="転送ルールに従って手動転送"
                >
                  <Forward size={13} />
                  {forwardMut.isPending ? '転送中...' : '手動転送'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600 mb-4">
              <div><span className="text-gray-400">差出人:</span> {email.from_name} &lt;{email.from_address}&gt;</div>
              <div><span className="text-gray-400">宛先:</span> {email.to_addresses.join(', ')}</div>
              {email.cc_addresses.length > 0 && (
                <div><span className="text-gray-400">CC:</span> {email.cc_addresses.join(', ')}</div>
              )}
              {email.received_at && (
                <div>
                  <span className="text-gray-400">受信:</span>{' '}
                  {format(new Date(email.received_at), 'yyyy年MM月dd日 HH:mm', { locale: ja })}
                </div>
              )}
              <div className="col-span-2 flex items-center gap-2 mt-1">
                <span className="text-gray-400 flex items-center gap-1"><Link size={12} />メール詳細URL:</span>
                <span className="text-indigo-600 text-xs font-mono select-all" id="detail-url">
                  {`${window.location.origin}/emails/${emailId}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/emails/${emailId}`)
                    toast.success('URLをコピーしました')
                  }}
                  className="text-xs text-gray-400 hover:text-indigo-600 transition-colors"
                >
                  コピー
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {email.email_labels.map((el) => el.label && <LabelBadge key={el.id} label={el.label} />)}
            </div>
          </div>

          {/* Related Emails */}
          {relatedEmails.length > 0 && (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <ExternalLink size={16} className="text-amber-600" />
                <h3 className="font-semibold text-gray-800 text-sm">関連メール</h3>
                <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                  {relatedEmails.length}件
                </span>
              </div>
              <div className="space-y-2">
                {relatedEmails.map(rel => (
                  <a
                    key={rel.id}
                    href={`/emails/${rel.id}`}
                    className="flex items-center gap-3 bg-white rounded-lg px-3 py-2.5 border border-amber-100 hover:border-amber-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {rel.from_name || rel.from_address}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{rel.subject}</div>
                      <div className="text-xs text-amber-700 mt-0.5 font-mono">
                        {rel.match_info.join(' ／ ')}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {rel.received_at && (
                        <span className="text-xs text-gray-400">
                          {format(new Date(rel.received_at), 'MM/dd HH:mm', { locale: ja })}
                        </span>
                      )}
                      <ExternalLink size={12} className="text-amber-400" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {email.ai_analyzed && (
            <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Bot size={16} className="text-indigo-600" />
                <h3 className="font-semibold text-indigo-900 text-sm">AI解析結果</h3>
                <button
                  onClick={() => reanalyzeMut.mutate()}
                  disabled={reanalyzeMut.isPending}
                  className="ml-auto text-xs text-indigo-600 hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  再解析
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                {email.ai_manufacturer && (
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-indigo-400" />
                    <div>
                      <div className="text-xs text-indigo-400">メーカー/会社</div>
                      <div className="text-sm font-medium text-indigo-900">{email.ai_manufacturer}</div>
                    </div>
                  </div>
                )}
                {email.ai_category && (
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-indigo-400" />
                    <div>
                      <div className="text-xs text-indigo-400">カテゴリ</div>
                      <div className="text-sm font-medium text-indigo-900">{email.ai_category}</div>
                    </div>
                  </div>
                )}
                {email.ai_priority && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-indigo-400" />
                    <div>
                      <div className="text-xs text-indigo-400">優先度</div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${priorityColor[email.ai_priority]}`}>
                        {priorityLabel[email.ai_priority]}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {email.ai_summary && (
                <div className="bg-white rounded-lg p-3 text-sm text-gray-700 border border-indigo-100">
                  {email.ai_summary}
                </div>
              )}
              {email.ai_key_info && Object.keys(email.ai_key_info).length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {Object.entries(email.ai_key_info).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="text-xs">
                      <span className="text-indigo-400">{k}: </span>
                      <span className="text-indigo-800">{v as string}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!email.ai_analyzed && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex items-center justify-between">
              <span className="text-sm text-gray-500">AI解析未実行</span>
              <button
                onClick={() => reanalyzeMut.mutate()}
                disabled={reanalyzeMut.isPending}
                className="text-sm text-indigo-600 hover:underline"
              >
                今すぐ解析
              </button>
            </div>
          )}

          {/* Extracted Fields */}
          {email.extracted_fields && email.extracted_fields.length > 0 && (
            <div className="bg-green-50 rounded-xl border border-green-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <ListChecks size={16} className="text-green-600" />
                <h3 className="font-semibold text-green-900 text-sm">抽出データ</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {email.extracted_fields.map((f) => {
                  const dateParts = f.field_value && isDateField(f.field_name)
                    ? parseDateParts(f.field_value)
                    : null
                  if (dateParts) {
                    return (
                      <div key={f.id} className="col-span-2 bg-white rounded-lg p-2.5 border border-green-100">
                        <div className="text-xs text-green-500 mb-1.5">{f.field_name}</div>
                        <div className="flex gap-3">
                          {[
                            { label: '年', value: dateParts.year, id: `field-value-${toSafeId(f.field_name)}-年` },
                            { label: '月', value: dateParts.month, id: `field-value-${toSafeId(f.field_name)}-月` },
                            { label: '日', value: dateParts.day, id: `field-value-${toSafeId(f.field_name)}-日` },
                          ].map(({ label, value, id }) => (
                            <div key={label} className="flex items-baseline gap-1">
                              <span id={id} className="text-sm font-bold text-gray-900">{value}</span>
                              <span className="text-xs text-green-500">{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  }
                  const multiple = isMultipleCodes(f)
                  const displayName = multiple ? `${f.field_name}（複数コード）` : f.field_name
                  return (
                    <div key={f.id} id={`field-card-${toSafeId(f.field_name)}`} className={`bg-white rounded-lg p-2.5 border ${multiple ? 'border-amber-200 col-span-2' : 'border-green-100'}`}>
                      <div className={`text-xs mb-0.5 flex items-center gap-2 ${multiple ? 'text-amber-600 font-semibold' : 'text-green-500'}`}>
                        {displayName}
                        {multiple && f.group_id && (
                          <span className="text-[10px] font-mono bg-amber-50 text-amber-400 border border-amber-200 rounded px-1.5 py-0.5 tracking-wider select-all" title="複数コードグループID">
                            ID: {f.group_id}
                          </span>
                        )}
                      </div>
                      <div id={`field-value-${toSafeId(f.field_name)}`} className="text-sm font-medium text-gray-900">{f.field_value || '―'}</div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-green-500 mt-2">
                転送ルールの本文・件名で <code className="bg-white px-1 rounded">【{email.extracted_fields[0]?.field_name}】</code> のように使用できます
              </p>
            </div>
          )}

          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Paperclip size={16} className="text-gray-500" />
                <h3 className="font-semibold text-gray-800 text-sm">
                  添付ファイル ({email.attachments.length}件)
                </h3>
              </div>
              <div className="space-y-2">
                {email.attachments.map((att) => {
                  const isDownloading = downloadingIds.has(att.id)
                  return (
                  <div key={att.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className="text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-gray-800 truncate">{att.filename}</div>
                        <div className="text-xs text-gray-400">
                          {att.content_type}
                          {att.file_size && ` · ${(att.file_size / 1024).toFixed(1)} KB`}
                        </div>
                      </div>
                    </div>
                    <button
                      disabled={isDownloading}
                      onClick={() => {
                        setDownloadingIds(prev => new Set(prev).add(att.id))
                        downloadAttachment(email.id, att.id, att.filename)
                          .catch(e => toast.error(e.message || 'ダウンロードに失敗しました'))
                          .finally(() => setDownloadingIds(prev => {
                            const next = new Set(prev); next.delete(att.id); return next
                          }))
                      }}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 flex-shrink-0 ml-3 disabled:opacity-50 disabled:cursor-wait"
                    >
                      {isDownloading
                        ? <><div className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin" />取得中...</>
                        : <><Download size={13} />ダウンロード</>
                      }
                    </button>
                  </div>
                )})}
              </div>
            </div>
          )}

          {/* Encrypted Archives */}
          {archives.length > 0 && (
            <div className="bg-white rounded-xl border border-orange-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Archive size={16} className="text-orange-500" />
                <h3 className="font-semibold text-gray-800 text-sm">
                  パスワード付き圧縮ファイル ({archives.length}件)
                </h3>
              </div>
              <div className="space-y-3">
                {archives.map((archive) => (
                  <div key={archive.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 flex items-center gap-2">
                      {archive.status === 'extracted' && (
                        <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                      )}
                      {archive.status === 'pending' && (
                        <Clock size={14} className="text-yellow-500 flex-shrink-0" />
                      )}
                      {archive.status === 'failed' && (
                        <XCircle size={14} className="text-red-500 flex-shrink-0" />
                      )}
                      <span className={`text-xs font-medium ${
                        archive.status === 'extracted' ? 'text-green-700' :
                        archive.status === 'pending' ? 'text-yellow-700' : 'text-red-700'
                      }`}>
                        {archive.status === 'extracted' ? '解凍済み' :
                         archive.status === 'pending' ? 'パスワードメール待ち' : '解凍失敗'}
                      </span>
                      {archive.password_email_id && (
                        <a
                          href={`/emails/${archive.password_email_id}`}
                          className="ml-auto text-xs text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          <ExternalLink size={11} />
                          パスワードメール
                        </a>
                      )}
                      {(archive.status === 'failed' || archive.status === 'pending') && (
                        <button
                          onClick={() => retryArchiveMut.mutate(archive.id)}
                          disabled={retryArchiveMut.isPending}
                          className="ml-auto text-xs text-orange-600 hover:underline flex items-center gap-1 disabled:opacity-50"
                        >
                          <RefreshCw size={11} />
                          再試行
                        </button>
                      )}
                    </div>
                    {archive.status === 'failed' && archive.error_message && (
                      <div className="px-3 py-2 text-xs text-red-600 bg-red-50">
                        エラー: {archive.error_message}
                      </div>
                    )}
                    {archive.status === 'pending' && (
                      <div className="px-3 py-2 text-xs text-gray-500">
                        同じ送信者からパスワード通知メールが届くと自動的に解凍されます
                      </div>
                    )}
                    {archive.extracted_files.length > 0 && (
                      <div className="divide-y divide-gray-50">
                        {archive.extracted_files.map((ef) => (
                          <div key={ef.id} className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText size={13} className="text-gray-400 flex-shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm text-gray-800 truncate">{ef.filename}</div>
                                {ef.file_size && (
                                  <div className="text-xs text-gray-400">
                                    {(ef.file_size / 1024).toFixed(1)} KB
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() =>
                                downloadExtractedFile(archive.id, ef.id, ef.filename).catch(e =>
                                  toast.error(e.message || 'ダウンロードに失敗しました')
                                )
                              }
                              className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 flex-shrink-0 ml-3"
                            >
                              <Download size={13} />
                              ダウンロード
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CSV Matches */}
          {(() => {
            const hasMatches = email.csv_matches && email.csv_matches.length > 0
            const hasReflected = hasMatches && email.csv_matches.some(m => m.reflection_status === 'reflected')
            const hasNotReflected = hasMatches && email.csv_matches.some(m => m.reflection_status === 'not_reflected')
            return (
              <div className={`bg-white rounded-xl border p-5 ${hasMatches ? 'border-blue-200' : 'border-gray-200'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <DatabaseZap size={16} className={hasMatches ? 'text-blue-600' : 'text-gray-400'} />
                  <h3 className="font-semibold text-gray-800 text-sm">業務システム照合結果</h3>
                  {hasMatches ? (
                    <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">登録有り</span>
                  ) : (
                    <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">登録なし</span>
                  )}
                  {hasReflected && (
                    <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">反映済み</span>
                  )}
                  {hasNotReflected && (
                    <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">未反映</span>
                  )}
                </div>
                {hasMatches ? (
                  <div className="space-y-3">
                    {email.csv_matches.map((match) => (
                      <div key={match.id} className="border border-gray-100 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-3 py-1.5 text-xs text-gray-500 flex items-center gap-2">
                          <span>
                            照合キー：<span className="font-medium text-gray-700">{match.match_field}</span> = <span className="font-medium text-indigo-600">{match.match_value}</span>
                          </span>
                          {match.date_field && (
                            <span className="text-gray-400">
                              | 日付照合：<span className="font-medium text-gray-600">{match.date_field}</span>
                            </span>
                          )}
                          {match.reflection_status === 'reflected' && (
                            <span className="ml-auto bg-green-100 text-green-700 rounded-full px-2 py-0.5">反映済み</span>
                          )}
                          {match.reflection_status === 'not_reflected' && (
                            <span className="ml-auto bg-red-100 text-red-700 rounded-full px-2 py-0.5">未反映</span>
                          )}
                          {!match.reflection_status && (
                            <span className="ml-auto bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">日付照合なし</span>
                          )}
                        </div>
                        {match.csv_record && (
                          <table className="w-full text-xs">
                            <tbody>
                              {Object.entries(match.csv_record.data).map(([col, val]) => (
                                <tr key={col} className="border-t border-gray-50">
                                  <td className="px-3 py-1.5 text-gray-500 bg-gray-50 font-medium w-1/3">{col}</td>
                                  <td className="px-3 py-1.5 text-gray-800">{val || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    {email.ai_analyzed
                      ? 'このメールに一致するCSVレコードが見つかりませんでした。'
                      : 'AI解析が完了していないため照合が実行されていません。'}
                  </p>
                )}
              </div>
            )
          })()}

          {/* Forwarding Logs */}
          {email.forwarding_logs.length > 0 && (
            <div className="bg-white rounded-xl border border-indigo-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Forward size={16} className="text-indigo-600" />
                <h3 className="font-semibold text-gray-800 text-sm">転送履歴</h3>
              </div>
              <div className="space-y-1">
                {email.forwarding_logs.map((log) => (
                  <div key={log.id} className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg ${log.success ? 'bg-indigo-50' : 'bg-red-50'}`}>
                    <Forward size={12} className={log.success ? 'text-indigo-500' : 'text-red-500'} />
                    <span className="text-gray-700 font-medium">{log.forwarded_to}</span>
                    <span className="text-gray-400 truncate flex-1">{log.forwarded_subject}</span>
                    <span className="text-gray-400 whitespace-nowrap">
                      {log.forwarded_at && format(new Date(log.forwarded_at), 'MM/dd HH:mm', { locale: ja })}
                    </span>
                    {!log.success && <span className="text-red-500 text-xs">{log.error_message}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reply Section */}
          <div className="bg-white rounded-xl border border-purple-200 p-5">
            <button
              type="button"
              onClick={() => setReplyOpen(v => !v)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-purple-600" />
                <h3 className="font-semibold text-gray-800 text-sm">返信する</h3>
                {replyLogs.length > 0 && (
                  <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">
                    返信済み ({replyLogs.length}件)
                  </span>
                )}
              </div>
              {replyOpen ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
            </button>

            {replyOpen && (
              <div className="mt-4 space-y-3">
                {/* テンプレート選択 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">定型文テンプレート</label>
                  <select
                    value={selectedTemplateId}
                    onChange={e => applyTemplate(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    <option value="">-- テンプレートを選択 --</option>
                    {replyTemplates.filter(t => t.is_active).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                {/* 宛先 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">送信先</label>
                  <input
                    type="email"
                    value={replyTo}
                    onChange={e => setReplyTo(e.target.value)}
                    placeholder={email.from_address || 'メールアドレス'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                {/* 件名 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">件名</label>
                  <input
                    type="text"
                    value={replySubject}
                    onChange={e => setReplySubject(e.target.value)}
                    placeholder={`Re: ${email.subject || ''}`}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                {/* 本文 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">本文</label>
                  <textarea
                    value={replyBody}
                    onChange={e => setReplyBody(e.target.value)}
                    rows={8}
                    placeholder="返信内容を入力..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-y font-sans"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => replyMut.mutate()}
                  disabled={replyMut.isPending || !replyTo.trim() || !replySubject.trim() || !replyBody.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-semibold text-sm rounded-lg transition-colors"
                >
                  <Send size={14} />
                  {replyMut.isPending ? '送信中...' : '返信を送信'}
                </button>
              </div>
            )}

            {/* 返信履歴 */}
            {replyLogs.length > 0 && (
              <div className={`${replyOpen ? 'mt-4 pt-4 border-t border-gray-100' : 'mt-3'}`}>
                <p className="text-xs font-medium text-gray-500 mb-2">返信履歴</p>
                <div className="space-y-2">
                  {replyLogs.map(log => (
                    <details key={log.id} className="bg-purple-50 rounded-lg overflow-hidden">
                      <summary className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer select-none">
                        <MessageSquare size={12} className="text-purple-500 flex-shrink-0" />
                        <span className="font-medium text-gray-700">{log.sent_to}</span>
                        <span className="text-gray-400 truncate flex-1">{log.sent_subject}</span>
                        <span className="text-gray-400 whitespace-nowrap">
                          {format(new Date(log.sent_at), 'MM/dd HH:mm', { locale: ja })}
                        </span>
                      </summary>
                      <div className="px-3 pb-3 pt-0">
                        <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans bg-white rounded p-2 border border-purple-100 mt-1 max-h-40 overflow-y-auto">
                          {log.sent_body}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800 text-sm">本文</h3>
              <button
                onClick={() => refetchMut.mutate()}
                disabled={refetchMut.isPending}
                className="text-xs text-gray-400 hover:text-indigo-600 flex items-center gap-1 disabled:opacity-50"
                title="文字化けしている場合、IMAPから本文を再取得します"
              >
                <RefreshCw size={12} />
                本文を再取得
              </button>
            </div>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-y-auto">
              {email.body_text || '(本文なし)'}
            </pre>
          </div>

          {/* Activity */}
          {activities && activities.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 text-sm mb-3">アクティビティ</h3>
              <div className="space-y-2">
                {activities.map((act: any) => (
                  <div key={act.id} className="flex items-start gap-3 text-sm">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <UserIcon size={12} className="text-gray-400" />
                    </div>
                    <div className="flex-1">
                      <span className="text-gray-700">{act.detail || act.action}</span>
                      <span className="text-gray-400 text-xs ml-2">
                        {format(new Date(act.created_at), 'MM/dd HH:mm', { locale: ja })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Panel */}
        <div className="space-y-4">
          {/* Status Control */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-3">ステータス管理</h3>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="メモ・備考..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <button
              onClick={() => statusMut.mutate()}
              disabled={statusMut.isPending}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 mb-2"
            >
              ステータスを更新
            </button>
            <button
              onClick={() => confirmMut.mutate()}
              disabled={confirmMut.isPending}
              className="w-full flex items-center justify-center gap-2 border border-green-600 text-green-600 rounded-lg py-2 text-sm font-medium hover:bg-green-50 disabled:opacity-50"
            >
              <CheckCircle size={14} />
              確認済みにする
            </button>
            {email.status_record?.confirmer && (
              <div className="mt-2 text-xs text-gray-400 text-center">
                確認者: {email.status_record.confirmer.full_name || email.status_record.confirmer.username}
                {email.status_record.confirmed_at && (
                  <> ({format(new Date(email.status_record.confirmed_at), 'MM/dd HH:mm', { locale: ja })})</>
                )}
              </div>
            )}
          </div>

          {/* Label Control */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-2">
              <Tag size={14} /> ラベル設定
            </h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {allLabels?.map((label) => (
                <button
                  key={label.id}
                  onClick={() => toggleLabel(label.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    selectedLabels.includes(label.id)
                      ? 'opacity-100'
                      : 'opacity-40 hover:opacity-70'
                  }`}
                  style={{
                    backgroundColor: selectedLabels.includes(label.id) ? label.color + '22' : 'transparent',
                    color: label.color,
                    borderColor: label.color + '55',
                  }}
                >
                  {label.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => labelsMut.mutate()}
              disabled={labelsMut.isPending}
              className="w-full bg-gray-800 text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
            >
              ラベルを保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
