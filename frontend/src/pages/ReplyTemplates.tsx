import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Plus, Edit2, Trash2, X, ChevronDown, ChevronUp, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import { getReplyTemplates, createReplyTemplate, updateReplyTemplate, deleteReplyTemplate, getReplyTags } from '../api/client'
import { ReplyTemplate } from '../types'

const EMPTY_FORM = {
  name: '',
  destination_email: '{送信元メールアドレス}',
  subject_template: 'Re: {件名}',
  body: '',
}

export default function ReplyTemplates() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<{ open: boolean; template: ReplyTemplate | null }>({ open: false, template: null })
  const [form, setForm] = useState(EMPTY_FORM)
  const [tagOpen, setTagOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const { data: templates = [] } = useQuery<ReplyTemplate[]>({
    queryKey: ['reply-templates'],
    queryFn: () => getReplyTemplates().then(r => r.data),
  })

  const { data: tags = [] } = useQuery<string[][]>({
    queryKey: ['reply-tags'],
    queryFn: () => getReplyTags().then(r => r.data),
  })

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setModal({ open: true, template: null })
  }

  const openEdit = (t: ReplyTemplate) => {
    setForm({ name: t.name, destination_email: t.destination_email, subject_template: t.subject_template, body: t.body })
    setModal({ open: true, template: t })
  }

  const closeModal = () => setModal({ open: false, template: null })

  const saveMut = useMutation({
    mutationFn: () =>
      modal.template
        ? updateReplyTemplate(modal.template.id, form)
        : createReplyTemplate(form),
    onSuccess: () => {
      toast.success(modal.template ? 'テンプレートを更新しました' : 'テンプレートを作成しました')
      qc.invalidateQueries({ queryKey: ['reply-templates'] })
      closeModal()
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || '保存に失敗しました'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteReplyTemplate(id),
    onSuccess: () => {
      toast.success('テンプレートを削除しました')
      qc.invalidateQueries({ queryKey: ['reply-templates'] })
      setDeleteConfirm(null)
    },
    onError: () => toast.error('削除に失敗しました'),
  })

  const insertTag = (tag: string, field: 'destination_email' | 'subject_template' | 'body') => {
    setForm(f => ({ ...f, [field]: f[field] + tag }))
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare size={20} className="text-indigo-600" />
          <h2 className="text-xl font-bold text-gray-900">返信テンプレート管理</h2>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus size={15} />
          新規作成
        </button>
      </div>

      {/* Tags Reference */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setTagOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-indigo-800"
        >
          <span className="flex items-center gap-2"><Tag size={14} />利用可能なタグ一覧</span>
          {tagOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {tagOpen && (
          <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {tags.map(([tag, desc]) => (
              <div key={tag} className="bg-white rounded-lg px-3 py-2 border border-indigo-100">
                <code className="text-xs font-mono text-indigo-700 font-bold">{tag}</code>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Template List */}
      {templates.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">テンプレートがありません</p>
          <button onClick={openCreate} className="mt-3 text-sm text-indigo-600 hover:underline">
            最初のテンプレートを作成する
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 text-sm">{t.name}</h3>
                    {!t.is_active && (
                      <span className="text-xs bg-gray-100 text-gray-400 rounded-full px-2 py-0.5">無効</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div><span className="text-gray-400">宛先: </span>{t.destination_email}</div>
                    <div><span className="text-gray-400">件名: </span>{t.subject_template}</div>
                  </div>
                  <pre className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap max-h-24 overflow-y-auto font-sans leading-relaxed">
                    {t.body}
                  </pre>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openEdit(t)}
                    className="p-1.5 text-gray-400 hover:text-indigo-600 rounded transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                  {deleteConfirm === t.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteMut.mutate(t.id)}
                        disabled={deleteMut.isPending}
                        className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                      >
                        削除
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(t.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">
                {modal.template ? 'テンプレートを編集' : '新規テンプレート作成'}
              </h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* タグ参照パネル */}
              <div className="bg-indigo-50 rounded-lg p-3">
                <p className="text-xs font-medium text-indigo-700 mb-2">利用可能なタグ（クリックで挿入）</p>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(([tag, desc]) => (
                    <button
                      key={tag}
                      type="button"
                      title={desc}
                      onClick={() => insertTag(tag, 'body')}
                      className="text-xs font-mono bg-white border border-indigo-200 text-indigo-700 rounded px-2 py-0.5 hover:bg-indigo-100 transition-colors"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">テンプレート名 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="例: 回収日確認返信"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  送信先メールアドレス
                  <span className="ml-1 text-gray-400 font-normal">（タグ使用可）</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.destination_email}
                    onChange={e => setForm(f => ({ ...f, destination_email: e.target.value }))}
                    placeholder="{送信元メールアドレス} または 固定アドレス"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => insertTag('{送信元メールアドレス}', 'destination_email')}
                    className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 whitespace-nowrap"
                  >
                    送信元を挿入
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  件名テンプレート
                  <span className="ml-1 text-gray-400 font-normal">（タグ使用可）</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.subject_template}
                    onChange={e => setForm(f => ({ ...f, subject_template: e.target.value }))}
                    placeholder="Re: {件名}"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => insertTag('{件名}', 'subject_template')}
                    className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 whitespace-nowrap"
                  >
                    件名を挿入
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  本文 *
                  <span className="ml-1 text-gray-400 font-normal">（タグ使用可。上のボタンからも挿入できます）</span>
                </label>
                <textarea
                  value={form.body}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  rows={8}
                  placeholder="メール本文を入力..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || !form.name.trim() || !form.body.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
              >
                {saveMut.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
