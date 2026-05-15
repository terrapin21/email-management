import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Mail, Tag, Forward, Server, Users, BarChart3, LogOut, DatabaseZap, FileSearch, MessageSquare, Pencil, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useMutation } from '@tanstack/react-query'
import { updateUser } from '../api/client'
import toast from 'react-hot-toast'

const navItems = [
  { to: '/', icon: BarChart3, label: 'ダッシュボード' },
  { to: '/emails', icon: Mail, label: 'メール一覧' },
  { to: '/labels', icon: Tag, label: 'ラベル管理' },
  { to: '/forwarding', icon: Forward, label: '転送ルール' },
  { to: '/reply-templates', icon: MessageSquare, label: '返信テンプレート' },
  { to: '/accounts', icon: Server, label: 'メールアカウント' },
  { to: '/csv', icon: DatabaseZap, label: 'CSV照合' },
  { to: '/documents', icon: FileSearch, label: '書類解析' },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showProfile, setShowProfile] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', confirm: '' })

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const updateMut = useMutation({
    mutationFn: () => {
      const payload: any = {}
      if (form.username) payload.username = form.username
      if (form.password) payload.password = form.password
      return updateUser(user!.id, payload)
    },
    onSuccess: () => {
      toast.success('更新しました。再ログインしてください')
      setShowProfile(false)
      logout()
      navigate('/login')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '更新に失敗しました'),
  })

  return (
    <aside className="w-56 flex-shrink-0 bg-gray-900 text-white flex flex-col h-screen sticky top-0">
      <div className="px-4 py-5 border-b border-gray-700">
        <h1 className="text-sm font-bold text-white leading-tight">メール管理システム</h1>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
        {user?.is_admin && (
          <NavLink
            to="/users"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <Users size={16} />
            ユーザー管理
          </NavLink>
        )}
      </nav>

      <div className="px-4 py-3 border-t border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-gray-400 truncate">{user?.full_name || user?.username}</div>
          <button onClick={() => { setForm({ username: user?.username || '', password: '', confirm: '' }); setShowProfile(true) }} className="text-gray-300 hover:text-white ml-2 flex-shrink-0">
            <Pencil size={14} />
          </button>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <LogOut size={14} />
          ログアウト
        </button>
      </div>

      {showProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">プロフィール編集</h3>
              <button onClick={() => setShowProfile(false)}><X size={16} className="text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ユーザーID</label>
                <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">新しいパスワード</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="変更しない場合は空欄" className="input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">パスワード確認</label>
                <input type="password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} placeholder="変更しない場合は空欄" className="input w-full" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  if (form.password && form.password !== form.confirm) { toast.error('パスワードが一致しません'); return }
                  updateMut.mutate()
                }}
                disabled={updateMut.isPending}
                className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex-1"
              >
                保存
              </button>
              <button onClick={() => setShowProfile(false)} className="border border-gray-300 rounded-lg px-4 py-2 text-sm">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
