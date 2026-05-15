import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAccounts, createAccount, updateAccount, deleteAccount,
  testAccount, fetchAccount, fetchAccountAll
} from '../api/client'
import { EmailAccount } from '../types'
import toast from 'react-hot-toast'
import { Plus, Trash2, TestTube, RefreshCw, X, CheckCircle, XCircle, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

interface FormData {
  name: string
  email_address: string
  imap_host: string
  imap_port: string
  imap_ssl: boolean
  imap_username: string
  imap_password: string
  smtp_host: string
  smtp_port: string
  smtp_ssl: boolean
  smtp_username: string
  smtp_password: string
}

const defaultForm: FormData = {
  name: '', email_address: '', imap_host: '', imap_port: '993', imap_ssl: true,
  imap_username: '', imap_password: '',
  smtp_host: '', smtp_port: '587', smtp_ssl: false, smtp_username: '', smtp_password: '',
}

export default function Accounts() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormData>(defaultForm)
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string }>>({})

  const { data: accounts } = useQuery<EmailAccount[]>({
    queryKey: ['accounts'],
    queryFn: () => getAccounts().then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => createAccount({
      ...form,
      imap_port: Number(form.imap_port),
      smtp_port: Number(form.smtp_port),
    }),
    onSuccess: () => {
      toast.success('アカウントを追加しました')
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setShowForm(false)
      setForm(defaultForm)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '追加に失敗しました'),
  })

  const updateMut = useMutation({
    mutationFn: () => updateAccount(editId!, {
      ...form,
      imap_port: Number(form.imap_port),
      smtp_port: Number(form.smtp_port),
    }),
    onSuccess: () => {
      toast.success('アカウントを更新しました')
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setEditId(null)
      setShowForm(false)
      setForm(defaultForm)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '更新に失敗しました'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    onSuccess: () => { toast.success('削除しました'); qc.invalidateQueries({ queryKey: ['accounts'] }) },
  })

  const testMut = useMutation({
    mutationFn: (id: number) => testAccount(id).then((r) => ({ id, ...r.data })),
    onSuccess: (data) => {
      setTestResults((prev) => ({ ...prev, [data.id]: { ok: data.success, msg: data.message } }))
      if (data.success) {
        toast.success('接続成功')
      } else {
        toast.error(`接続失敗: ${data.message}`)
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '接続テストに失敗しました'),
  })

  const fetchMut = useMutation({
    mutationFn: (id: number) => fetchAccount(id),
    onSuccess: () => toast.success('メール取得を開始しました'),
    onError: () => toast.error('メール取得に失敗しました'),
  })

  const fetchAllMut = useMutation({
    mutationFn: (id: number) => fetchAccountAll(id),
    onSuccess: () => toast.success('全件再取得を開始しました（完了まで数分かかる場合があります）'),
    onError: () => toast.error('全件再取得に失敗しました'),
  })

  const f = (field: keyof FormData) => (e: any) => {
    setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  }

  const openEdit = (account: EmailAccount) => {
    setEditId(account.id)
    setForm({
      name: account.name,
      email_address: account.email_address,
      imap_host: account.imap_host,
      imap_port: String(account.imap_port),
      imap_ssl: account.imap_ssl,
      imap_username: account.imap_username,
      imap_password: '',
      smtp_host: account.smtp_host || '',
      smtp_port: String(account.smtp_port || 587),
      smtp_ssl: account.smtp_ssl || false,
      smtp_username: account.smtp_username || '',
      smtp_password: '',
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditId(null)
    setForm(defaultForm)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">メールアカウント</h2>
        <button
          onClick={() => { setEditId(null); setForm(defaultForm); setShowForm(true) }}
          className="flex items-center gap-2 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700"
        >
          <Plus size={16} /> アカウント追加
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">{editId ? 'アカウント編集' : '新規アカウント追加'}</h3>
            <button onClick={closeForm}><X size={16} className="text-gray-400" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">アカウント名 *</label>
              <input type="text" value={form.name} onChange={f('name')} className="input" placeholder="例: 会社メイン" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">メールアドレス *</label>
              <input type="email" value={form.email_address} onChange={f('email_address')} className="input" placeholder="info@example.com" />
            </div>
            <div className="col-span-2 border-t border-gray-100 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">IMAP設定（受信）</div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">IMAPホスト *</label>
              <input type="text" value={form.imap_host} onChange={f('imap_host')} className="input" placeholder="imap.example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ポート</label>
              <div className="flex gap-2 items-center">
                <input type="number" value={form.imap_port} onChange={f('imap_port')} className="input w-24" />
                <label className="flex items-center gap-1 text-sm text-gray-600">
                  <input type="checkbox" checked={form.imap_ssl} onChange={f('imap_ssl')} className="rounded" />
                  SSL
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ユーザー名 *</label>
              <input type="text" value={form.imap_username} onChange={f('imap_username')} className="input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">パスワード {editId ? '（変更する場合のみ入力）' : '*'}</label>
              <input type="password" value={form.imap_password} onChange={f('imap_password')} className="input" placeholder={editId ? '変更しない場合は空欄' : ''} />
            </div>
            <div className="col-span-2 border-t border-gray-100 pt-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SMTP設定（送信・転送）</div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">SMTPホスト</label>
              <input type="text" value={form.smtp_host} onChange={f('smtp_host')} className="input" placeholder="smtp.example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ポート</label>
              <div className="flex gap-2 items-center">
                <input type="number" value={form.smtp_port} onChange={f('smtp_port')} className="input w-24" />
                <label className="flex items-center gap-1 text-sm text-gray-600">
                  <input type="checkbox" checked={form.smtp_ssl} onChange={f('smtp_ssl')} className="rounded" />
                  SSL
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ユーザー名</label>
              <input type="text" value={form.smtp_username} onChange={f('smtp_username')} className="input" placeholder="IMAPと同じ場合は省略可" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">パスワード</label>
              <input type="password" value={form.smtp_password} onChange={f('smtp_password')} className="input" placeholder={editId ? '変更しない場合は空欄' : 'IMAPと同じ場合は省略可'} />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => editId ? updateMut.mutate() : createMut.mutate()}
              disabled={(editId ? updateMut.isPending : createMut.isPending) || !form.name || !form.imap_host || !form.imap_username}
              className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {editId ? '更新' : '追加'}
            </button>
            <button onClick={closeForm} className="border border-gray-300 rounded-lg px-4 py-2 text-sm">
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {accounts?.map((account) => (
          <div key={account.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900">{account.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${account.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {account.is_active ? '有効' : '無効'}
                  </span>
                </div>
                <div className="text-sm text-gray-600 mb-2">{account.email_address}</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-gray-500">
                  <div>IMAP: {account.imap_host}:{account.imap_port} ({account.imap_ssl ? 'SSL' : 'STARTTLS'})</div>
                  {account.smtp_host && <div>SMTP: {account.smtp_host}:{account.smtp_port}</div>}
                  {account.last_checked && (
                    <div>最終確認: {format(new Date(account.last_checked), 'MM/dd HH:mm', { locale: ja })}</div>
                  )}
                </div>
                {testResults[account.id] && (
                  <div className={`mt-2 flex items-center gap-1 text-xs ${testResults[account.id].ok ? 'text-green-600' : 'text-red-600'}`}>
                    {testResults[account.id].ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
                    {testResults[account.id].msg}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => testMut.mutate(account.id)}
                  disabled={testMut.isPending}
                  className="flex items-center gap-1 text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-gray-600"
                  title="接続テスト"
                >
                  <TestTube size={12} /> テスト
                </button>
                <button
                  onClick={() => fetchMut.mutate(account.id)}
                  disabled={fetchMut.isPending}
                  className="flex items-center gap-1 text-xs border border-indigo-300 rounded-lg px-2.5 py-1.5 hover:bg-indigo-50 text-indigo-600"
                  title="今すぐ取得"
                >
                  <RefreshCw size={12} /> 今すぐ取得
                </button>
                <button
                  onClick={() => { if (confirm('全件再取得します。時間がかかる場合があります。よろしいですか？')) fetchAllMut.mutate(account.id) }}
                  disabled={fetchAllMut.isPending}
                  className="flex items-center gap-1 text-xs border border-orange-300 rounded-lg px-2.5 py-1.5 hover:bg-orange-50 text-orange-600"
                  title="全件再取得"
                >
                  <RefreshCw size={12} /> 全件再取得
                </button>
                <button
                  onClick={() => openEdit(account)}
                  className="flex items-center gap-1 text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-gray-600"
                  title="編集"
                >
                  <Pencil size={12} /> 編集
                </button>
                <button
                  onClick={() => { if (confirm('削除しますか？')) deleteMut.mutate(account.id) }}
                  className="text-gray-400 hover:text-red-600 p-1.5"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!accounts?.length && (
          <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400 text-sm">
            アカウントがありません。「アカウント追加」から設定してください。
          </div>
        )}
      </div>
    </div>
  )
}
