import { useQuery } from '@tanstack/react-query'
import { getEmailStats, getEmails } from '../api/client'
import { Stats, EmailListItem } from '../types'
import { Link } from 'react-router-dom'
import { Mail, Clock, CheckCircle, AlertTriangle, TrendingUp, Server, Tag } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import LabelBadge from '../components/LabelBadge'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <div className={`${color} rounded-lg p-2`}>
          <Icon size={20} className="text-white" />
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{value}</div>
          <div className="text-xs text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: () => getEmailStats().then((r) => r.data),
    refetchInterval: 30000,
  })

  const { data: recent } = useQuery({
    queryKey: ['emails', 'recent'],
    queryFn: () => getEmails({ per_page: 5 }).then((r) => r.data),
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-6">ダッシュボード</h2>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Mail} label="未読メール" value={stats.unread} color="bg-blue-500" />
          <StatCard icon={Clock} label="対応中" value={stats.in_progress} color="bg-yellow-500" />
          <StatCard icon={CheckCircle} label="完了" value={stats.completed} color="bg-green-500" />
          <StatCard icon={TrendingUp} label="本日受信" value={stats.today_received} color="bg-indigo-500" />
          <StatCard icon={Mail} label="総メール数" value={stats.total_emails} color="bg-gray-500" />
          <StatCard icon={Server} label="有効アカウント" value={stats.accounts_active} color="bg-purple-500" />
          <StatCard icon={Tag} label="ラベル数" value={stats.labels_count} color="bg-pink-500" />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">最新メール</h3>
          <Link to="/emails" className="text-xs text-indigo-600 hover:underline">すべて表示</Link>
        </div>
        <div className="divide-y divide-gray-50">
          {recent?.items?.map((email: EmailListItem) => (
            <Link
              key={email.id}
              to={`/emails/${email.id}`}
              className="flex items-start gap-4 px-5 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-sm font-medium truncate ${email.status === 'unread' ? 'text-gray-900' : 'text-gray-600'}`}>
                    {email.subject || '(件名なし)'}
                  </span>
                  {email.status === 'unread' && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {email.from_name || email.from_address}
                </div>
                {email.ai_summary && (
                  <div className="text-xs text-gray-400 truncate mt-0.5">{email.ai_summary}</div>
                )}
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-1">
                <StatusBadge status={email.status} />
                {email.received_at && (
                  <span className="text-xs text-gray-400">
                    {format(new Date(email.received_at), 'MM/dd HH:mm', { locale: ja })}
                  </span>
                )}
              </div>
            </Link>
          ))}
          {!recent?.items?.length && (
            <div className="px-5 py-8 text-center text-sm text-gray-400">メールがありません</div>
          )}
        </div>
      </div>
    </div>
  )
}
