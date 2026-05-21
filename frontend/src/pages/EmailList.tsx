import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import { getEmails, getAccounts, getLabels, analyzeAllEmails, confirmEmail } from '../api/client'
import toast from 'react-hot-toast'
import { EmailListItem, EmailAccount, Label } from '../types'
import StatusBadge from '../components/StatusBadge'
import LabelBadge from '../components/LabelBadge'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Search, ChevronLeft, ChevronRight, Bot, AlertCircle, Forward, CheckCircle2, Circle, Paperclip } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'unread', label: '未読' },
  { value: 'read', label: '既読' },
  { value: 'in_progress', label: '対応中' },
  { value: 'completed', label: '対応済み' },
  { value: 'pending', label: '保留' },
  { value: 'escalated', label: 'エスカレーション' },
  { value: 'replied', label: '返信済み' },
  { value: 'needs_review', label: '要確認' },
]

const PRIORITY_OPTIONS = [
  { value: '', label: '全優先度' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

export default function EmailList() {
  const location = useLocation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Number(searchParams.get('page') || 1)
  const search = searchParams.get('search') || ''
  const accountId = searchParams.get('account_id') || ''
  const labelId = searchParams.get('label_id') || ''
  const status = searchParams.get('status') || ''
  const priority = searchParams.get('priority') || ''
  const [searchInput, setSearchInput] = useState(search)

  const setPage = (p: number) => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n })
  const setSearch = (v: string) => setSearchParams(prev => { const n = new URLSearchParams(prev); if (v) n.set('search', v); else n.delete('search'); n.set('page', '1'); return n })
  const setAccountId = (v: string) => setSearchParams(prev => { const n = new URLSearchParams(prev); if (v) n.set('account_id', v); else n.delete('account_id'); n.set('page', '1'); return n })
  const setLabelId = (v: string) => setSearchParams(prev => { const n = new URLSearchParams(prev); if (v) n.set('label_id', v); else n.delete('label_id'); n.set('page', '1'); return n })
  const setStatus = (v: string) => setSearchParams(prev => { const n = new URLSearchParams(prev); if (v) n.set('status', v); else n.delete('status'); n.set('page', '1'); return n })
  const setPriority = (v: string) => setSearchParams(prev => { const n = new URLSearchParams(prev); if (v) n.set('priority', v); else n.delete('priority'); n.set('page', '1'); return n })

  const { data: accounts } = useQuery<EmailAccount[]>({
    queryKey: ['accounts'],
    queryFn: () => getAccounts().then((r) => r.data),
  })
  const { data: labels } = useQuery<Label[]>({
    queryKey: ['labels'],
    queryFn: () => getLabels().then((r) => r.data),
  })

  const params = {
    page,
    per_page: 25,
    ...(search && { search }),
    ...(accountId && { account_id: accountId }),
    ...(labelId && { label_id: labelId }),
    ...(status && { status }),
    ...(priority && { priority }),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['emails', params],
    queryFn: () => getEmails(params).then((r) => r.data),
    refetchInterval: 60000,
  })

  const confirmMut = useMutation({
    mutationFn: (id: number) => confirmEmail(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emails'] }),
    onError: () => toast.error('確認済みの更新に失敗しました'),
  })

  const analyzeAllMut = useMutation({
    mutationFn: () => analyzeAllEmails({
      ...(accountId && { account_id: accountId }),
      ...(labelId && { label_id: labelId }),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(search && { search }),
    }),
    onSuccess: (res: any) => toast.success(res.data.message),
    onError: () => toast.error('AI解析の開始に失敗しました'),
  })

  const handleSearch = () => {
    setSearch(searchInput)
  }

  const priorityColor: Record<string, string> = {
    high: 'text-red-500',
    medium: 'text-yellow-500',
    low: 'text-gray-400',
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">メール一覧</h2>
        <button
          onClick={() => analyzeAllMut.mutate()}
          disabled={analyzeAllMut.isPending}
          className="flex items-center gap-2 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          <Bot size={16} /> AI一括解析
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3">
        <div className="flex gap-2 flex-1 min-w-60">
          <input
            type="text"
            placeholder="件名・送信者・要約で検索..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleSearch}
            className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 hover:bg-indigo-700 transition-colors"
          >
            <Search size={16} />
          </button>
        </div>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          <option value="">全アカウント</option>
          {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select
          value={labelId}
          onChange={(e) => setLabelId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          <option value="">全ラベル</option>
          {labels?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">読み込み中...</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 w-8">対応</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 w-6"></th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">件名</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">送信者</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">ラベル</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden lg:table-cell">受信日時</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data?.items?.map((email: EmailListItem) => (
                  <tr
                    key={email.id}
                    className={`hover:bg-gray-50 transition-colors ${email.confirmed_by_name ? 'opacity-60' : email.status === 'unread' ? 'bg-blue-50/30' : ''}`}
                  >
                    <td className="px-3 py-3">
                      <button
                        title={email.confirmed_by_name ? `確認済み: ${email.confirmed_by_name}` : '確認済みにする'}
                        disabled={confirmMut.isPending || !!email.confirmed_by_name}
                        onClick={(e) => {
                          e.preventDefault()
                          confirmMut.mutate(email.id)
                        }}
                        className="flex items-center justify-center hover:scale-110 transition-transform disabled:opacity-40"
                      >
                        {email.confirmed_by_name
                          ? <CheckCircle2 size={18} className="text-green-500" />
                          : <Circle size={18} className="text-gray-300 hover:text-green-400" />
                        }
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {email.ai_priority === 'high' && <AlertCircle size={14} className="text-red-500" />}
                        {email.has_attachments && (
                          <Paperclip size={13} className="text-gray-400" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <Link to={`/emails/${email.id}`} state={{ from: location.pathname + location.search }} className="hover:text-indigo-600 transition-colors">
                        <div className={`font-medium truncate ${email.status === 'unread' ? 'text-gray-900' : 'text-gray-600'}`}>
                          {email.subject || '(件名なし)'}
                        </div>
                        {email.ai_summary && (
                          <div className="text-xs text-gray-400 truncate mt-0.5">{email.ai_summary}</div>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="text-sm text-gray-700 truncate max-w-[160px]">
                        {email.from_name || email.from_address}
                      </div>
                      {email.ai_manufacturer && (
                        <div className="text-xs text-gray-400">{email.ai_manufacturer}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {email.labels?.slice(0, 3).map((l) => (
                          <LabelBadge key={l.id} label={l} small />
                        ))}
                        {(email.labels?.length ?? 0) > 3 && (
                          <span className="text-xs text-gray-400">+{email.labels.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={email.status} />
                      {email.confirmed_by_name && (
                        <div className="text-xs text-gray-400 mt-0.5">{email.confirmed_by_name}</div>
                      )}
                      {email.is_forwarded && (
                        <span className="inline-flex items-center gap-0.5 mt-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">
                          <Forward size={10} />転送済み
                        </span>
                      )}
                      {email.registration_status === 'registered' && (
                        <span className="inline-block mt-0.5 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">登録有り</span>
                      )}
                      {email.registration_status === 'not_registered' && (
                        <span className="inline-block mt-0.5 text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">登録無し</span>
                      )}
                      {email.reflection_status === 'reflected' && (
                        <span className="inline-block mt-0.5 ml-1 text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">反映済み</span>
                      )}
                      {email.reflection_status === 'not_reflected' && (
                        <span className="inline-block mt-0.5 ml-1 text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">未反映</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-500 whitespace-nowrap">
                      {email.received_at && format(new Date(email.received_at), 'MM/dd HH:mm', { locale: ja })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {data && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  全{data.total}件 / {page}ページ目
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page * data.per_page >= data.total}
                    className="p-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
