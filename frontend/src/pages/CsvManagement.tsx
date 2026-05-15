import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCsvUploads, uploadCsv, deleteCsvUpload, rematchCsv } from '../api/client'
import { CsvUpload } from '../types'
import toast from 'react-hot-toast'
import { Upload, Trash2, RefreshCw, FileSpreadsheet } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export default function CsvManagement() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const { data: uploads, isLoading } = useQuery<CsvUpload[]>({
    queryKey: ['csv-uploads'],
    queryFn: () => getCsvUploads().then((r) => r.data),
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadCsv(file),
    onSuccess: () => {
      toast.success('CSVをアップロードしました。照合処理を開始します...')
      qc.invalidateQueries({ queryKey: ['csv-uploads'] })
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'アップロード失敗'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteCsvUpload(id),
    onSuccess: () => {
      toast.success('削除しました')
      qc.invalidateQueries({ queryKey: ['csv-uploads'] })
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
  })

  const rematchMut = useMutation({
    mutationFn: (id: number) => rematchCsv(id),
    onSuccess: () => {
      toast.success('再照合を開始しました')
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
  })

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('CSVファイルを選択してください')
      return
    }
    uploadMut.mutate(file)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-2">業務システム CSV照合</h2>
      <p className="text-sm text-gray-500 mb-6">
        業務管理システムからエクスポートしたCSVをアップロードすると、受信メールのAI解析データと自動照合して「反映済み／未反映」のステータスを表示します。
      </p>

      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center mb-6 transition-colors cursor-pointer
          ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />
        <Upload size={32} className="mx-auto text-gray-400 mb-2" />
        {uploadMut.isPending ? (
          <p className="text-sm text-indigo-600">アップロード中...</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">CSVファイルをドロップ または クリックして選択</p>
            <p className="text-xs text-gray-400 mt-1">Shift-JIS / UTF-8 対応</p>
          </>
        )}
      </div>

      {/* 照合の説明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800">
        <p className="font-medium mb-1">照合ロジック</p>
        <p className="text-xs">AIがメールから抽出した項目値（施主コード・回収日など）がCSVのいずれかの列に存在すれば「反映済み」と判定します。CSVを新しいものに差し替えたら「再照合」を実行してください。</p>
      </div>

      {/* Upload List */}
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-gray-400">読み込み中...</p>}
        {uploads?.map((upload) => (
          <div key={upload.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <FileSpreadsheet size={24} className="text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">{upload.filename}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {upload.row_count.toLocaleString()}行 ／
                    アップロード: {format(new Date(upload.uploaded_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                    {upload.uploader && ` by ${upload.uploader.full_name || upload.uploader.username}`}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {upload.column_names.slice(0, 8).map((col) => (
                      <span key={col} className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{col}</span>
                    ))}
                    {upload.column_names.length > 8 && (
                      <span className="text-xs text-gray-400">+{upload.column_names.length - 8}列</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => rematchMut.mutate(upload.id)}
                  disabled={rematchMut.isPending}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-2 py-1 hover:bg-indigo-50 disabled:opacity-50"
                  title="再照合"
                >
                  <RefreshCw size={12} /> 再照合
                </button>
                <button
                  onClick={() => { if (confirm('削除しますか？照合結果もクリアされます。')) deleteMut.mutate(upload.id) }}
                  className="text-gray-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!isLoading && !uploads?.length && (
          <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400 text-sm">
            CSVがまだアップロードされていません
          </div>
        )}
      </div>
    </div>
  )
}
