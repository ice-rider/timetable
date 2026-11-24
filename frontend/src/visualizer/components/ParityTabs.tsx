import type { ParityTab } from '../lib/parity'

const TABS: { value: ParityTab; label: string; title: string }[] = [
  { value: 'odd', label: 'Над чертой', title: 'Только над чертой (неделя odd)' },
  { value: 'even', label: 'Под чертой', title: 'Только под чертой (неделя even)' },
  { value: 'combine', label: 'Всё вместе', title: 'Над и под чертой в одной таблице' },
  { value: 'collapse', label: 'Обе (подряд)', title: 'Над и под чертой двумя таблицами' },
]

interface Props {
  value: ParityTab
  onChange: (v: ParityTab) => void
}

export function ParityTabs({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Режим недели"
      className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-0.5"
    >
      {TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          aria-pressed={value === t.value}
          title={t.title}
          className={
            'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
            (value === t.value
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900')
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
