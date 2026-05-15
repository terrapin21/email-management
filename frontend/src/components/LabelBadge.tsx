import { Label } from '../types'

const typeLabel: Record<string, string> = {
  manufacturer: 'メーカー',
  category: 'カテゴリ',
  priority: '優先度',
  custom: 'カスタム',
}

export default function LabelBadge({ label, small }: { label: Label; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${small ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}`}
      style={{ backgroundColor: label.color + '22', color: label.color, border: `1px solid ${label.color}55` }}
      title={typeLabel[label.label_type]}
    >
      {label.name}
    </span>
  )
}
