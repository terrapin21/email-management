import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getForwardingRules, createForwardingRule, updateForwardingRule,
  deleteForwardingRule, toggleForwardingRule, getLabels
} from '../api/client'
import { ForwardingRule, Label } from '../types'
import LabelBadge from '../components/LabelBadge'
import toast from 'react-hot-toast'
import { Plus, Trash2, ToggleLeft, ToggleRight, Info, X, Pencil, Paperclip } from 'lucide-react'

interface FormData {
  name: string
  label_id: string
  destination_email: string
  subject_template: string
  body_prefix: string
  attach_files: boolean
}

const defaultForm: FormData = {
  name: '',
  label_id: '',
  destination_email: '',
  subject_template: '{subject}',
  body_prefix: '',
  attach_files: false,
}

const TEMPLATE_VARS = [
  { key: '{subject}', desc: '元の件名' },
  { key: '{from}', desc: '送信者メールアドレス' },
  { key: '{from_name}', desc: '送信者名' },
  { key: '{category}', desc: 'AIカテゴリ' },
  { key: '{manufacturer}', desc: 'AIメーカー名' },
  { key: '{priority}', desc: 'AI優先度' },
  { key: '{date}', desc: '受信日(YYYY-MM-DD)' },
]

function RuleForm({
  title,
  form,
  setForm,
  onSubmit,
  onCancel,
  isPending,
  labels,
  isEdit,
}: {
  title: string
  form: FormData
  setForm: (f: FormData) => void
  onSubmit: () => void
  onCancel: () => void
  isPending: boolean
  labels?: Label[]
  isEdit?: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <button onClick={onCancel}><X size={16} className="text-gray-400" /></button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ルール名 *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="例: パナソニックホームズ → 受注担当"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">トリガーラベル *</label>
          <select
            value={form.label_id}
            onChange={(e) => setForm({ ...form, label_id: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">ラベルを選択...</option>
            {labels?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">転送先メールアドレス *</label>
          <input
            type="email"
            value={form.destination_email}
            onChange={(e) => setForm({ ...form, destination_email: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="forward@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            件名テンプレート
            <span className="text-gray-400 font-normal ml-1">(変数使用可)</span>
          </label>
          <input
            type="text"
            value={form.subject_template}
            onChange={(e) => setForm({ ...form, subject_template: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="{subject}"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">本文プレフィックス（任意）</label>
          <textarea
            value={form.body_prefix}
            onChange={(e) => setForm({ ...form, body_prefix: e.target.value })}
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none font-mono"
            placeholder={"例：\n施主コード：【施主コード】\n回収品目：【回収品目】\n\n【解析データ全て】"}
          />
        </div>
        <div className="col-span-2">
          <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={form.attach_files}
              onChange={(e) => setForm({ ...form, attach_files: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <Paperclip size={14} className="text-gray-500" />
            <span className="text-sm text-gray-700">添付ファイルも添付して転送する</span>
          </label>
        </div>
        <div className="col-span-2 space-y-2">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
              <Info size={12} /> 使用可能な件名変数（クリックで挿入）
            </div>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_VARS.map((v) => (
                <code
                  key={v.key}
                  className="text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5 cursor-pointer hover:bg-indigo-50"
                  title={v.desc}
                  onClick={() => setForm({ ...form, subject_template: form.subject_template + v.key })}
                >
                  {v.key}
                </code>
              ))}
            </div>
          </div>
          <div className="bg-green-50 rounded-lg p-3 space-y-1">
            <div className="text-xs font-medium text-green-700 flex items-center gap-1">
              <Info size={12} /> 抽出データのプレースホルダー（件名・本文両方で使用可）
            </div>
            <p className="text-xs text-green-600">
              個別項目：<code className="bg-white px-1 rounded border border-green-200">【施主コード】</code>　<code className="bg-white px-1 rounded border border-green-200">【回収品目】</code>　<code className="bg-white px-1 rounded border border-green-200">【回収日】</code>　<code className="bg-white px-1 rounded border border-green-200">【連絡先】</code>
            </p>
            <p className="text-xs text-green-600">
              全項目一括：<code className="bg-white px-1 rounded border border-green-200">【解析データ全て】</code> → AI が抽出した全項目を <em>項目名：値</em> の形式で展開します
            </p>
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onSubmit}
          disabled={isPending || !form.name || !form.label_id || !form.destination_email}
          className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {isEdit ? '保存' : '作成'}
        </button>
        <button onClick={onCancel} className="border border-gray-300 rounded-lg px-4 py-2 text-sm">
          キャンセル
        </button>
      </div>
    </div>
  )
}

export default function ForwardingRules() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [createForm, setCreateForm] = useState<FormData>(defaultForm)
  const [editForm, setEditForm] = useState<FormData>(defaultForm)

  const { data: rules } = useQuery<ForwardingRule[]>({
    queryKey: ['forwarding'],
    queryFn: () => getForwardingRules().then((r) => r.data),
  })

  const { data: labels } = useQuery<Label[]>({
    queryKey: ['labels'],
    queryFn: () => getLabels().then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: () => createForwardingRule({ ...createForm, label_id: Number(createForm.label_id) }),
    onSuccess: () => {
      toast.success('転送ルールを作成しました')
      qc.invalidateQueries({ queryKey: ['forwarding'] })
      setShowCreate(false)
      setCreateForm(defaultForm)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '作成に失敗しました'),
  })

  const updateMut = useMutation({
    mutationFn: () => updateForwardingRule(editingId!, {
      ...editForm,
      label_id: Number(editForm.label_id),
    }),
    onSuccess: () => {
      toast.success('転送ルールを更新しました')
      qc.invalidateQueries({ queryKey: ['forwarding'] })
      setEditingId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '更新に失敗しました'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteForwardingRule(id),
    onSuccess: () => { toast.success('削除しました'); qc.invalidateQueries({ queryKey: ['forwarding'] }) },
  })

  const toggleMut = useMutation({
    mutationFn: (id: number) => toggleForwardingRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forwarding'] }),
  })

  const startEdit = (rule: ForwardingRule) => {
    setEditForm({
      name: rule.name,
      label_id: String(rule.label_id),
      destination_email: rule.destination_email,
      subject_template: rule.subject_template,
      body_prefix: rule.body_prefix || '',
      attach_files: rule.attach_files,
    })
    setEditingId(rule.id)
    setShowCreate(false)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">転送ルール</h2>
        <button
          onClick={() => { setShowCreate(true); setEditingId(null) }}
          className="flex items-center gap-2 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700"
        >
          <Plus size={16} /> 新規ルール
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800">
        <p className="font-medium mb-1">転送ルールの動作</p>
        <p className="text-xs">AIがラベルを付与したメールは、自動的に対応する転送ルールの宛先へ転送されます。Power Automate Desktopと連携し、転送されたメールをトリガーとして自動入力処理を実行できます。</p>
      </div>

      {showCreate && (
        <RuleForm
          title="新規転送ルール作成"
          form={createForm}
          setForm={setCreateForm}
          onSubmit={() => createMut.mutate()}
          onCancel={() => setShowCreate(false)}
          isPending={createMut.isPending}
          labels={labels}
        />
      )}

      <div className="space-y-3">
        {rules?.map((rule) => (
          <div key={rule.id}>
            {editingId === rule.id ? (
              <RuleForm
                title={`「${rule.name}」を編集`}
                form={editForm}
                setForm={setEditForm}
                onSubmit={() => updateMut.mutate()}
                onCancel={() => setEditingId(null)}
                isPending={updateMut.isPending}
                labels={labels}
                isEdit
              />
            ) : (
              <div className={`bg-white rounded-xl border p-4 ${rule.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-gray-900 text-sm">{rule.name}</span>
                      {rule.label && <LabelBadge label={rule.label} small />}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${rule.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {rule.is_active ? '有効' : '無効'}
                      </span>
                      {rule.attach_files && (
                        <span className="flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          <Paperclip size={10} /> 添付あり
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600">
                      <div>
                        <span className="text-xs text-gray-400">転送先: </span>
                        <span className="font-mono text-xs">{rule.destination_email}</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400">件名: </span>
                        <code className="text-xs bg-gray-100 rounded px-1">{rule.subject_template}</code>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400">転送回数: </span>
                        <span className="font-medium">{rule.forward_count}件</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(rule)}
                      className="text-gray-400 hover:text-indigo-600 transition-colors"
                      title="編集"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => toggleMut.mutate(rule.id)}
                      className="text-gray-400 hover:text-indigo-600 transition-colors"
                      title={rule.is_active ? '無効化' : '有効化'}
                    >
                      {rule.is_active ? <ToggleRight size={20} className="text-indigo-600" /> : <ToggleLeft size={20} />}
                    </button>
                    <button
                      onClick={() => { if (confirm('削除しますか？')) deleteMut.mutate(rule.id) }}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {!rules?.length && (
          <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400 text-sm">
            転送ルールがありません。「新規ルール」から作成してください。
          </div>
        )}
      </div>
    </div>
  )
}
