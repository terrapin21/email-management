import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLabels, createLabel, updateLabel, deleteLabel } from '../api/client'
import { Label, LabelType } from '../types'
import LabelBadge from '../components/LabelBadge'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'

const LABEL_TYPES: { value: LabelType; label: string }[] = [
  { value: 'manufacturer', label: 'メーカー' },
  { value: 'category', label: 'カテゴリ' },
  { value: 'priority', label: '優先度' },
  { value: 'custom', label: 'カスタム' },
]

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#64748b',
]

interface FormData {
  name: string
  color: string
  description: string
  label_type: LabelType
}

const defaultForm: FormData = { name: '', color: '#6366f1', description: '', label_type: 'custom' }

export default function Labels() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormData>(defaultForm)

  const { data: labels, isLoading } = useQuery<Label[]>({
    queryKey: ['labels'],
    queryFn: () => getLabels().then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => createLabel(form),
    onSuccess: () => { toast.success('ラベルを作成しました'); qc.invalidateQueries({ queryKey: ['labels'] }); setShowForm(false); setForm(defaultForm) },
    onError: (e: any) => toast.error(e.response?.data?.detail || '作成に失敗しました'),
  })

  const updateMut = useMutation({
    mutationFn: () => updateLabel(editId!, form),
    onSuccess: () => { toast.success('ラベルを更新しました'); qc.invalidateQueries({ queryKey: ['labels'] }); setEditId(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteLabel(id),
    onSuccess: () => { toast.success('ラベルを削除しました'); qc.invalidateQueries({ queryKey: ['labels'] }) },
  })

  const startEdit = (label: Label) => {
    setEditId(label.id)
    setForm({ name: label.name, color: label.color, description: label.description || '', label_type: label.label_type })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">ラベル管理</h2>
        <button
          onClick={() => { setShowForm(true); setEditId(null); setForm(defaultForm) }}
          className="flex items-center gap-2 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700"
        >
          <Plus size={16} /> 新規ラベル
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">新規ラベル作成</h3>
            <button onClick={() => setShowForm(false)}><X size={16} className="text-gray-400" /></button>
          </div>
          <LabelForm form={form} setForm={setForm} />
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.name}
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

      {isLoading ? (
        <div className="text-center text-gray-400 py-8">読み込み中...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ラベル</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">種類</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 hidden md:table-cell">説明</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {labels?.map((label) => (
                editId === label.id ? (
                  <tr key={label.id} className="bg-indigo-50">
                    <td colSpan={4} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">ラベル名 *</label>
                          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">種類</label>
                          <select value={form.label_type} onChange={(e) => setForm({ ...form, label_type: e.target.value as LabelType })}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                            {LABEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">説明（AI解析の判定に使用）</label>
                          <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                            placeholder="例: 発注書・注文書・購入依頼が含まれるメール" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">色</label>
                          <div className="flex gap-1.5">
                            {PRESET_COLORS.map((c) => (
                              <button key={c} onClick={() => setForm({ ...form, color: c })}
                                className={`w-6 h-6 rounded-full border-2 ${form.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                                style={{ backgroundColor: c }} />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => updateMut.mutate()} className="flex items-center gap-1 bg-indigo-600 text-white rounded px-3 py-1.5 text-sm hover:bg-indigo-700">
                          <Check size={13} /> 保存
                        </button>
                        <button onClick={() => setEditId(null)} className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50">
                          キャンセル
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={label.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><LabelBadge label={label} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{LABEL_TYPES.find((t) => t.value === label.label_type)?.label}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{label.description}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(label)} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { if (confirm('削除しますか？')) deleteMut.mutate(label.id) }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
              {!labels?.length && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">ラベルがありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LabelForm({ form, setForm, compact }: { form: FormData; setForm: (f: FormData) => void; compact?: boolean }) {
  const LABEL_TYPES: { value: LabelType; label: string }[] = [
    { value: 'manufacturer', label: 'メーカー' },
    { value: 'category', label: 'カテゴリ' },
    { value: 'priority', label: '優先度' },
    { value: 'custom', label: 'カスタム' },
  ]

  if (compact) {
    return (
      <div className="flex flex-col gap-2 py-1">
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-28"
            placeholder="ラベル名"
          />
          <select
            value={form.label_type}
            onChange={(e) => setForm({ ...form, label_type: e.target.value as LabelType })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {LABEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="flex gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`w-5 h-5 rounded-full border-2 ${form.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
          placeholder="説明（AI解析の判定に使用されます）"
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">ラベル名 *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="例: 山田製作所"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">種類</label>
        <select
          value={form.label_type}
          onChange={(e) => setForm({ ...form, label_type: e.target.value as LabelType })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          {LABEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">色</label>
        <div className="flex gap-1.5 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setForm({ ...form, color: c })}
              className={`w-6 h-6 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer border border-gray-300"
            title="カスタムカラー"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">説明（任意）</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div className="col-span-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">プレビュー:</span>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border"
            style={{ backgroundColor: form.color + '22', color: form.color, borderColor: form.color + '55' }}
          >
            {form.name || 'ラベル名'}
          </span>
        </div>
      </div>
    </div>
  )
}
