import { useRef, useState } from 'react'
import { FileText, Upload, Search, X, Download, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { analyzeSchedule } from '../api/client'

const EXCEL_FIELDS = [
  { key: '支社名', isKey: false },
  { key: '現場名', isKey: false },
  { key: '施主コード', isKey: true },
  { key: '建築地', isKey: false },
  { key: '監督名', isKey: false },
  { key: '携帯電話', isKey: false },
  { key: '回収希望日_年', isKey: true },
  { key: '回収希望日_月', isKey: true },
  { key: '回収希望日_日', isKey: true },
  { key: '保管場所', isKey: false },
  { key: 'ゲート鍵番号', isKey: false },
  { key: '工事用キー保管場所', isKey: false },
]

const REQUEST_FIELDS = [
  { key: '施主No', isKey: true },
  { key: '回収日_年', isKey: true },
  { key: '回収日_月', isKey: true },
  { key: '回収日_日', isKey: true },
]

// PDFの回収依頼書用（FILE_PROMPTで抽出される全フィールド）
const PDF_REQUEST_FIELDS = [
  { key: '施主No', isKey: true },
  { key: '回収日_年', isKey: true },
  { key: '回収日_月', isKey: true },
  { key: '回収日_日', isKey: true },
  { key: '現場名', isKey: false },
  { key: '建築地', isKey: false },
  { key: '支社名', isKey: false },
  { key: '監督名', isKey: false },
  { key: '携帯電話', isKey: false },
  { key: '保管場所', isKey: false },
  { key: 'ゲート鍵番号', isKey: false },
  { key: '工事用キー保管場所', isKey: false },
]

// 回収依頼書以外のファイル種別
const NON_REQUEST_TYPES = ['案内図', '図面', 'その他']

const TYPE_COLOR: Record<string, string> = {
  '案内図': 'bg-blue-100 text-blue-700 border-blue-200',
  '図面': 'bg-teal-100 text-teal-700 border-teal-200',
  '回収依頼書': 'bg-orange-100 text-orange-700 border-orange-200',
  'その他': 'bg-gray-100 text-gray-600 border-gray-200',
}

type Tab = 'text' | 'file' | 'schedule'

export default function DocumentAnalyzer() {
  const [tab, setTab] = useState<Tab>('text')
  const [inputText, setInputText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [scheduleFile, setScheduleFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [scheduleDragging, setScheduleDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ type: string; data: Record<string, string> } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scheduleFileRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls'].includes(ext)) {
      toast.error('対応していない形式です')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('ファイルサイズが大きすぎます（最大 20MB）')
      return
    }
    setFile(f)
    setResult(null)
  }

  const handleScheduleFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['xlsx', 'xls'].includes(ext)) {
      toast.error('Excelファイル（xlsx / xls）のみ対応しています')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('ファイルサイズが大きすぎます（最大 20MB）')
      return
    }
    setScheduleFile(f)
  }

  const handleScheduleAnalyze = async () => {
    if (!scheduleFile) { toast.error('ファイルを選択してください'); return }
    setLoading(true)
    try {
      const res = await analyzeSchedule(scheduleFile)
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '社内検査リスト.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Excelをダウンロードしました')
    } catch (e: any) {
      const text = await e.response?.data?.text?.()
      let detail = '解析に失敗しました'
      try { detail = JSON.parse(text)?.detail || detail } catch {}
      toast.error(detail)
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async () => {
    if (tab === 'text' && !inputText.trim()) { toast.error('テキストを入力してください'); return }
    if (tab === 'file' && !file) { toast.error('ファイルを選択してください'); return }

    setLoading(true)
    setResult(null)
    try {
      const form = new FormData()
      if (tab === 'text') {
        form.append('text', inputText.trim())
      } else {
        form.append('file', file!)
      }
      const res = await api.post('/documents/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(res.data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || '解析に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = (typeName: string) => {
    if (!file) return
    const ext = file.name.split('.').pop() ?? ''
    const newName = `【${typeName}】.${ext}`
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = newName
    a.click()
    URL.revokeObjectURL(url)
  }

  // 結果の種別を判定
  const fileType = result?.data['種類'] ?? ''
  const isExcelResult = result?.type === 'excel'
  const isPdfRequest = result?.type === 'file' && fileType === '回収依頼書'
  const isRequest = result?.type === 'text' || isExcelResult || isPdfRequest
  const isNonRequest = result?.type === 'file' && NON_REQUEST_TYPES.includes(fileType)
  const fields = isExcelResult ? EXCEL_FIELDS : isPdfRequest ? PDF_REQUEST_FIELDS : REQUEST_FIELDS

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <FileText size={20} className="text-indigo-600" />
        <h2 className="text-xl font-bold text-gray-900">書類解析</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        回収依頼・案内図・図面などのファイルを解析します
      </p>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        {/* タブ */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
          <button
            type="button"
            onClick={() => { setTab('text'); setResult(null) }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'text' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            テキスト入力
          </button>
          <button
            type="button"
            onClick={() => { setTab('file'); setResult(null) }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'file' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            ファイルアップロード
          </button>
          <button
            type="button"
            onClick={() => { setTab('schedule'); setResult(null) }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'schedule' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            社内検査シート
          </button>
        </div>

        {tab === 'text' && (
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            rows={8}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:border-indigo-400 focus:bg-white resize-y"
            placeholder="メール本文をここに貼り付けてください…"
          />
        )}

        {tab === 'file' && (
          <>
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:border-indigo-300'
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            >
              <Upload size={28} className="mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-gray-600 mb-1">ここにファイルをドロップ、またはクリックして選択</p>
              <p className="text-xs text-gray-400">Excel（xlsx / xls）・PDF・画像（JPG / PNG）対応　最大 20MB</p>
            </div>
            <input
              type="file"
              ref={fileRef}
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {file && (
              <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-indigo-50 rounded-lg text-sm text-indigo-700">
                <FileText size={14} />
                <span className="flex-1 truncate">{file.name}　({(file.size / 1024).toFixed(0)} KB)</span>
                <button type="button" onClick={() => { setFile(null); setResult(null) }} className="hover:text-red-500">
                  <X size={14} />
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'schedule' && (
          <>
            <p className="text-xs text-gray-500 mb-3">
              社内検査シート（Excel）を読み込み、オーダーNo・施主名・管理者・管理者電話番号・床養生回収可能日・キーBOX Noを一覧Excelとして出力します。
            </p>
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                scheduleDragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:border-indigo-300'
              }`}
              onClick={() => scheduleFileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setScheduleDragging(true) }}
              onDragLeave={() => setScheduleDragging(false)}
              onDrop={e => { e.preventDefault(); setScheduleDragging(false); const f = e.dataTransfer.files[0]; if (f) handleScheduleFile(f) }}
            >
              <ClipboardList size={28} className="mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-gray-600 mb-1">社内検査シートをドロップ、またはクリックして選択</p>
              <p className="text-xs text-gray-400">Excel（xlsx / xls）のみ対応　最大 20MB</p>
            </div>
            <input
              type="file"
              ref={scheduleFileRef}
              className="hidden"
              accept=".xlsx,.xls"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleScheduleFile(f) }}
            />
            {scheduleFile && (
              <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-indigo-50 rounded-lg text-sm text-indigo-700">
                <FileText size={14} />
                <span className="flex-1 truncate">{scheduleFile.name}　({(scheduleFile.size / 1024).toFixed(0)} KB)</span>
                <button type="button" onClick={() => setScheduleFile(null)} className="hover:text-red-500">
                  <X size={14} />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={handleScheduleAnalyze}
              disabled={loading || !scheduleFile}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
            >
              {loading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />解析中...</>
              ) : (
                <><Download size={16} />解析してExcelダウンロード</>
              )}
            </button>
          </>
        )}

        {tab !== 'schedule' && (
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />解析中...</>
            ) : (
              <><Search size={16} />解析</>
            )}
          </button>
        )}
      </div>

      {/* 回収依頼書・テキスト → 抽出データ表示 */}
      {result && isRequest && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <span className="text-green-500">✓</span>
            <h3 className="font-bold text-gray-900">解析結果</h3>
            {fileType === '回収依頼書' && (
              <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full border ${TYPE_COLOR['回収依頼書']}`}>
                回収依頼書
              </span>
            )}
          </div>
          <table className="w-full">
            <tbody>
              {fields.map(f => {
                const val = result.data[f.key] || ''
                return (
                  <tr key={f.key} id={`row-${f.key}`} className={`border-b border-gray-50 last:border-0 ${f.isKey ? 'bg-green-50' : ''}`}>
                    <td id={`label-${f.key}`} className="py-2 pr-4 w-2/5 text-xs text-gray-500 font-semibold">{f.key}</td>
                    <td id={`value-${f.key}`} className="py-2 text-sm">
                      {val
                        ? <span className={f.isKey ? 'font-bold text-green-800' : 'text-gray-800'}>{val}</span>
                        : <span className="text-gray-400 text-xs">未入力</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 案内図・図面・その他 → ダウンロードカード */}
      {result && isNonRequest && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <span className="text-green-500">✓</span>
            <h3 className="font-bold text-gray-900">解析結果</h3>
          </div>
          <div className="flex flex-col items-center gap-4 py-4">
            <span className={`text-lg font-bold px-4 py-1.5 rounded-full border ${TYPE_COLOR[fileType] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              {fileType}
            </span>
            <p className="text-sm text-gray-500">
              このファイルは <span className="font-semibold text-gray-700">【{fileType}】</span> と判定されました
            </p>
            <button
              type="button"
              onClick={() => handleDownload(fileType)}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors"
            >
              <Download size={16} />
              【{fileType}】.{file?.name.split('.').pop()} としてダウンロード
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
