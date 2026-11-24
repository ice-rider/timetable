import type { Violation } from '../api/types'

interface Props {
  violations: Violation[]
  softTotal: number
  onOpen: () => void
  onSelect?: (lessonIds: number[]) => void
  activeLessonIds?: Set<number> | null
}

function plural(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'накладка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'накладки'
  return 'накладок'
}

export function ViolationsBadge({
  violations,
  softTotal,
  onOpen,
  onSelect,
  activeLessonIds,
}: Props) {
  const count = violations.length
  const soft = Math.round(softTotal)

  if (count === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="Открыть накладки и окна"
        className="violation-summary-button flex items-center gap-2 rounded text-sm hover:opacity-80"
      >
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800">
          накладок нет
        </span>
        <span className="text-slate-500">штраф: {soft}</span>
      </button>
    )
  }

  return (
    <details className="violation-summary relative text-sm">
      <summary className="violation-summary-trigger flex cursor-pointer list-none items-center gap-2">
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 font-medium text-red-800">
          {count} {plural(count)}
        </span>
        <span className="text-slate-500">штраф: {soft}</span>
      </summary>

      <div className="absolute right-0 top-full z-30 mt-2 max-h-96 w-[min(380px,calc(100vw-2rem))] overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
        <ul className="space-y-1">
          {violations.map((violation, index) => {
            const active =
              activeLessonIds && violation.lesson_ids.some((id) => activeLessonIds.has(id))
            return (
              <li key={`${violation.rule}-${violation.lesson_ids.join('-')}-${index}`}>
                <button
                  type="button"
                  onClick={() => onSelect?.(violation.lesson_ids)}
                  className={
                    'w-full rounded-lg px-3 py-2 text-left transition ' +
                    (active ? 'bg-red-50 ring-1 ring-red-200' : 'hover:bg-slate-50')
                  }
                >
                  <div className="text-xs font-semibold text-slate-800">
                    [{violation.rule}] {violation.title}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">{violation.message}</div>
                  {violation.day && (
                    <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {violation.day}
                      {violation.period != null ? ` · пара ${violation.period}` : ''}
                      {violation.resource ? ` · ${violation.resource.name}` : ''}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 flex gap-2">
          {onSelect && (
            <button
              type="button"
              onClick={() => onSelect([])}
              className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Сбросить фильтр
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Все накладки
          </button>
        </div>
      </div>
    </details>
  )
}
