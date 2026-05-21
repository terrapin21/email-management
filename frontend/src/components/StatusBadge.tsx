import { EmailStatus } from '../types'

const config: Record<EmailStatus, { label: string; cls: string }> = {
  unread: { label: '未読', cls: 'bg-blue-100 text-blue-800' },
  read: { label: '既読', cls: 'bg-gray-100 text-gray-700' },
  in_progress: { label: '対応中', cls: 'bg-yellow-100 text-yellow-800' },
  completed: { label: '対応済み', cls: 'bg-green-100 text-green-800' },
  pending: { label: '保留', cls: 'bg-orange-100 text-orange-800' },
  escalated: { label: 'エスカレーション', cls: 'bg-red-100 text-red-800' },
  replied: { label: '返信済み', cls: 'bg-purple-100 text-purple-800' },
  needs_review: { label: '要確認', cls: 'bg-amber-100 text-amber-800' },
}

export default function StatusBadge({ status }: { status: EmailStatus }) {
  const { label, cls } = config[status] ?? config.read
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}
