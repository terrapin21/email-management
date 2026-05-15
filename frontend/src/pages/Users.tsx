import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, deleteUser } from '../api/client'
import { User } from '../types'
import toast from 'react-hot-toast'
import { Plus, Trash2, X, Shield, UserCheck } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { useAuth } from '../context/AuthContext'

interface FormData {
  username: string
  email: string
  full_name: string
  password: string
  is_admin: boolean
}

const defaultForm: FormData = { username: '', email: '', full_name: '', password: '', is_admin: false }

export default function Users() {
  const qc = useQueryClient()
  const { user: currentUser } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(defaultForm)

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => getUsers().then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => createUser(form),
    onSuccess: () => {
      toast.success('ユーザーを作成しました')
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm(defaultForm)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '作成に失敗しました'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => { toast.success('削除しました'); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e: any) => toast.error(e.response?.data?.detail || '削除に失敗しました'),
  })

  const f = (field: keyof FormData) => (e: any) =>
    setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">ユーザー管理</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700"
        >
          <Plus size={16} /> ユーザー追加
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">新規ユーザー追加</h3>
            <button onClick={() => setShowForm(false)}><X size={16} className="text-gray-400" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ユーザー名 *</label>
              <input type="text" value={form.username} onChange={f('username')} className="input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">氏名</label>
              <input type="text" value={form.full_name} onChange={f('full_name')} className="input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">メールアドレス *</label>
              <input type="email" value={form.email} onChange={f('email')} className="input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">パスワード *</label>
              <input type="password" value={form.password} onChange={f('password')} className="input" />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.is_admin} onChange={f('is_admin')} className="rounded" />
                管理者権限を付与する
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.username || !form.email || !form.password}
              className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              作成
            </button>
            <button onClick={() => setShowForm(false)} className="border border-gray-300 rounded-lg px-4 py-2 text-sm">
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ユーザー</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">メールアドレス</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">権限</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">作成日</th>
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users?.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-medium text-xs">
                      {(user.full_name || user.username).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{user.full_name || user.username}</div>
                      <div className="text-xs text-gray-400">@{user.username}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3">
                  {user.is_admin ? (
                    <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 rounded-full px-2 py-0.5 w-fit">
                      <Shield size={11} /> 管理者
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 rounded-full px-2 py-0.5 w-fit">
                      <UserCheck size={11} /> スタッフ
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                  {format(new Date(user.created_at), 'yyyy/MM/dd', { locale: ja })}
                </td>
                <td className="px-4 py-3">
                  {user.id !== currentUser?.id && (
                    <button
                      onClick={() => { if (confirm('削除しますか？')) deleteMut.mutate(user.id) }}
                      className="text-gray-400 hover:text-red-600 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
