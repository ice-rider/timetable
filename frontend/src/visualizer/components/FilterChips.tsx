export type FilterKey = 'all' | 'lecture' | 'practice' | 'lab' | 'violations'

interface Props {
  active: Set<FilterKey>
  onChange: (next: Set<FilterKey>) => void
  hasViolations: boolean
}

const CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'lecture', label: 'Лекции' },
  { key: 'practice', label: 'Практики' },
  { key: 'lab', label: 'Лабораторные' },
  { key: 'violations', label: 'Накладки' },
]

export function FilterChips({ active, onChange, hasViolations }: Props) {
  function toggle(key: FilterKey) {
    if (key === 'all') {
      onChange(new Set(['all']))
      return
    }

    const next = new Set(active)
    next.delete('all')
    if (next.has(key)) next.delete(key)
    else next.add(key)
    if (next.size === 0) next.add('all')
    onChange(next)
  }

  return (
    <div role="group" aria-label="Фильтр занятий" className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        if (chip.key === 'violations' && !hasViolations) return null
        const selected = active.has(chip.key)

        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => toggle(chip.key)}
            aria-pressed={selected}
            className={
              'rounded-full border px-3 py-1 text-sm font-medium transition ' +
              (selected
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900')
            }
          >
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
