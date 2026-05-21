import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Trash2, Edit2, GripVertical, ChevronDown, ChevronUp } from 'lucide-react'
import {
  getExtractionConfigs,
  createExtractionConfig,
  updateExtractionConfig,
  deleteExtractionConfig,
} from '../api/client'
import { useAuth } from '../context/AuthContext'

interface ExtractionField {
  id?: number
  field_name: string
  field_type: string
  required: boolean
  order: number
}

interface MakerConfig {
  id: number
  maker_name: string
  excel_file_path: string | null
  map_save_path: string | null
  map_date_field: string
  fields: ExtractionField[]
}

const emptyField = (): ExtractionField => ({
  field_name: '',
  field_type: 'text',
  required: true,
  order: 0,
})

const emptyForm = () => ({
  maker_name: '',
  excel_file_path: '',
  map_save_path: '',
  map_date_field: '回収日',
  fields: [] as ExtractionField[],
})

export default function ExtractionConfigs() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<MakerConfig | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['extraction-configs'],
    queryFn: () => getExtractionConfigs().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (d: object) => createExtractionConfig(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['extraction-configs'] }); closeModal(); toast.success('作成しました') },
    onError: (e: any) => toast.error(e.response?.data?.detail || '作成に失敗しました'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: object }) => updateExtractionConfig(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['extraction-configs'] }); closeModal(); toast.success('更新しました') },
    onError: (e: any) => toast.error(e.response?.data?.detail || '更新に失敗しました'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteExtractionConfig(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['extraction-configs'] }); toast.success('削除しました') },
    onError: () => toast.error('削除に失敗しました'),
  })

  const openCreate = () => {
    setEditTarget(null)
    setForm(emptyForm())
    setShowModal(true)
  }

  const openEdit = (c: MakerConfig) => {
    setEditTarget(c)
    setForm({
      maker_name: c.maker_name,
      excel_file_path: c.excel_file_path || '',
      map_save_path: c.map_save_path || '',
      map_date_field: c.map_date_field,
      fields: c.fields.map(f => ({ ...f })),
    })
    setShowModal(true)
  }

  const closeModal = () => { setShowModal(false); setEditTarget(null) }

  const addField = () => {
    setForm(prev => ({
      ...prev,
      fields: [...prev.fields, { ...emptyField(), order: prev.fields.length }],
    }))
  }

  const removeField = (idx: number) => {
    setForm(prev => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== idx).map((f, i) => ({ ...f, order: i })),
    }))
  }

  const updateField = (idx: number, key: keyof ExtractionField, value: unknown) => {
    setForm(prev => ({
      ...prev,
      fields: prev.fields.map((f, i) => i === idx ? { ...f, [key]: value } : f),
    }))
  }

  const moveField = (idx: number, dir: -1 | 1) => {
    const next = idx + dir
    if (next < 0 || next >= form.fields.length) return
    setForm(prev => {
      const fields = [...prev.fields]
      const tmp = fields[idx]
      fields[idx] = { ...fields[next], order: idx }
      fields[next] = { ...tmp, order: next }
      return { ...prev, fields }
    })
  }

  const handleSubmit = () => {
    if (!form.maker_name.trim()) { toast.error('メーカー名を入力してください'); return }
    if (form.fields.some(f => !f.field_name.trim())) { toast.error('フィールド名を全て入力してください'); return }
    const payload = {
      ...form,
      excel_file_path: form.excel_file_path || null,
      map_save_path: form.map_save_path || null,
      fields: form.fields.map((f, i) => ({ ...f, order: i })),
    }
    if (editTarget) {
      updateMut.mutate({ id: editTarget.id, d: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  if (isLoading) return <div className="p-8 text-gray-400">読み込み中...</div>

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">抽出設定</h1>
          <p className="text-sm text-gray-500 mt-1">メーカー毎の情報抽出フィールドとExcel保存先を管理します</p>
        </div>
        {user?.is_admin && (
          <button onClick={openCreate} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            <Plus size={16} /> メーカー追加
          </button>
        )}
      </div>

      {configs.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p>メーカー設定がありません</p>
          {user?.is_admin && (
            <button onClick={openCreate} className="mt-4 text-indigo-600 hover:underline text-sm">+ メーカーを追加する</button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {configs.map((c: MakerConfig) => (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div
              className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
            >
              <div className="flex items-center gap-3">
                {expandedId === c.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                <span className="font-medium text-gray-900">{c.maker_name}</span>
                <span className="text-xs text-gray-400">{c.fields.length}フィールド</span>
              </div>
              {user?.is_admin && (
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded">
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => { if (confirm(`「${c.maker_name}」を削除しますか？`)) deleteMut.mutate(c.id) }}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>

            {expandedId === c.id && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                  <div>
                    <span className="text-gray-500">Excelファイルパス:</span>
                    <p className="font-mono text-xs mt-1 text-gray-700 break-all">{c.excel_file_path || '未設定'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">地図保存先 (temp):</span>
                    <p className="font-mono text-xs mt-1 text-gray-700 break-all">{c.map_save_path || '未設定'}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">地図ファイル名の日付フィールド:</span>
                    <p className="font-medium text-gray-700 mt-1">{c.map_date_field}</p>
                  </div>
                </div>

                <table className="w-full text-sm border border-gray-100 rounded-lg overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">フィールド名</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">種別</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">必須</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">順序</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.fields.map(f => (
                      <tr key={f.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{f.field_name}</td>
                        <td className="px-3 py-2 text-gray-500">{f.field_type}</td>
                        <td className="px-3 py-2">{f.required ? <span className="text-red-500">必須</span> : <span className="text-gray-400">任意</span>}</td>
                        <td className="px-3 py-2 text-gray-400">{f.order + 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 py-8 px-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{editTarget ? '抽出設定を編集' : '抽出設定を追加'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メーカー名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.maker_name}
                  onChange={e => setForm({ ...form, maker_name: e.target.value })}
                  placeholder="例: パナソニックホームズ"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">AIが解析したメーカー名と部分一致で紐付けされます</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">出力Excelファイルパス</label>
                <input
                  type="text"
                  value={form.excel_file_path}
                  onChange={e => setForm({ ...form, excel_file_path: e.target.value })}
                  placeholder="\\192.168.1.195\disk1\emailsys\automation\メーカー名\output.xlsx"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">地図保存先フォルダ (temp)</label>
                <input
                  type="text"
                  value={form.map_save_path}
                  onChange={e => setForm({ ...form, map_save_path: e.target.value })}
                  placeholder="\\192.168.1.195\disk1\emailsys\automation\メーカー名\temp"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">地図ファイル名に使う日付フィールド名</label>
                <input
                  type="text"
                  value={form.map_date_field}
                  onChange={e => setForm({ ...form, map_date_field: e.target.value })}
                  placeholder="回収日"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">{'地図ファイル名: {コード}_{このフィールドの値}.pdf'}</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">抽出フィールド</label>
                  <button onClick={addField} className="flex items-center gap-1 text-indigo-600 text-xs hover:underline">
                    <Plus size={12} /> フィールド追加
                  </button>
                </div>

                {form.fields.length === 0 && (
                  <div className="text-center py-6 border border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">
                    フィールドを追加してください
                  </div>
                )}

                <div className="space-y-2">
                  {form.fields.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex flex-col gap-0.5 cursor-pointer text-gray-300">
                        <button onClick={() => moveField(idx, -1)} disabled={idx === 0} className="hover:text-gray-500 disabled:opacity-20"><ChevronUp size={12} /></button>
                        <button onClick={() => moveField(idx, 1)} disabled={idx === form.fields.length - 1} className="hover:text-gray-500 disabled:opacity-20"><ChevronDown size={12} /></button>
                      </div>
                      <input
                        type="text"
                        value={f.field_name}
                        onChange={e => updateField(idx, 'field_name', e.target.value)}
                        placeholder="フィールド名（例: コード、回収日）"
                        className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                      <select
                        value={f.field_type}
                        onChange={e => updateField(idx, 'field_type', e.target.value)}
                        className="bg-white border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none"
                      >
                        <option value="text">テキスト</option>
                        <option value="code">コード</option>
                        <option value="date">日付</option>
                      </select>
                      <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={e => updateField(idx, 'required', e.target.checked)}
                          className="rounded"
                        />
                        必須
                      </label>
                      <button onClick={() => removeField(idx)} className="text-gray-300 hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={closeModal} className="border border-gray-300 rounded-lg px-4 py-2 text-sm">
                キャンセル
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMut.isPending || updateMut.isPending}
                className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {editTarget ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
