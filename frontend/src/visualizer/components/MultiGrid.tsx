import { useMemo } from 'react'
import type { Day, Lesson } from '../api/types'
import { dayLong } from '../lib/labels'
import type { HalfWeek, ParityTab } from '../lib/parity'
import { cellOf, type MultiWeek } from '../lib/schedule'
import type { ScheduleOrientation } from '../lib/viewPreferences'
import { LessonCard, type LessonCardVariant } from './LessonCard'

interface Props {
  week: MultiWeek
  violated: Set<number>
  variant: LessonCardVariant
  compact?: boolean
  highlightFree?: boolean
  highlightCommonFree?: boolean
  tab: ParityTab
  dense?: boolean
  layout?: ScheduleOrientation
}

interface InnerProps {
  week: MultiWeek
  violated: Set<number>
  variant: LessonCardVariant
  compact: boolean
  highlightFree: boolean
  highlightCommonFree: boolean
  dense: boolean
  layout: ScheduleOrientation
}

function filterMultiWeek(week: MultiWeek, half: HalfWeek): MultiWeek {
  const cells = new Map<string, Lesson[]>()
  for (const [key, lessons] of week.cells) {
    const filtered = lessons.filter((lesson) => lesson.parity === 'every' || lesson.parity === half)
    if (filtered.length > 0) cells.set(key, filtered)
  }
  const ids = new Set<number>()
  for (const lessons of cells.values()) {
    for (const lesson of lessons) ids.add(lesson.id)
  }
  return {
    ...week,
    cells,
    lessons: week.lessons.filter((lesson) => ids.has(lesson.id)),
    violations: week.violations.filter((violation) =>
      violation.lesson_ids.some((id) => ids.has(id)),
    ),
  }
}

function computeGaps(cells: Lesson[][]): boolean[] {
  const busy = cells.map((cell) => cell.length > 0)
  return busy.map((isBusy, index) => {
    if (isBusy) return false
    const hasLessonBefore = busy.slice(0, index).some(Boolean)
    const hasLessonAfter = busy.slice(index + 1).some(Boolean)
    return hasLessonBefore && hasLessonAfter
  })
}

function MultiGridInner({
  week,
  violated,
  variant,
  compact,
  highlightFree,
  highlightCommonFree,
  dense,
  layout,
}: InnerProps) {
  const gaps = useMemo(() => {
    const result = new Map<string, boolean[]>()
    week.entities.forEach((_, entityIndex) => {
      for (const day of week.days) {
        const cells = week.periods.map((period) => cellOf(week, entityIndex, day, period.n))
        result.set(`${entityIndex}|${day}`, computeGaps(cells))
      }
    })
    return result
  }, [week])

  if (week.entities.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-6 text-slate-600">
        Выберите хотя бы одну сущность.
      </p>
    )
  }

  const commonFree = (day: Day, period: number): boolean =>
    week.entities.every((_, entityIndex) => cellOf(week, entityIndex, day, period).length === 0)

  if (layout === 'vertical') {
    return (
      <div className={`schedule-responsive layout-vertical density-${dense ? 'compact' : 'wide'}`}>
        <div className="multi-grid-vertical schedule-table-wrap overflow-auto rounded border border-slate-200 bg-white">
          <table className="schedule-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="schedule-corner sticky left-0 top-0 z-30 border border-slate-200 bg-slate-100 p-2 text-left text-xs font-medium text-slate-600">
                  День
                </th>
                {week.periods.map((period) => (
                  <th
                    key={period.n}
                    className="schedule-period-column sticky top-0 z-20 border border-slate-200 bg-slate-100 p-2 text-center font-medium"
                  >
                    <span className="schedule-period-number">{period.n}</span>
                    {period.start && (
                      <span className="schedule-period-time">
                        {period.start}
                        {period.end ? `–${period.end}` : ''}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {week.days.map((day) => (
                <tr key={day}>
                  <th className="schedule-vertical-day sticky left-0 z-10 border border-slate-200 bg-slate-50 p-2 text-left text-xs">
                    {dayLong[day]}
                  </th>
                  {week.periods.map((period, periodIndex) => {
                    const cells = week.entities.map((_, entityIndex) =>
                      cellOf(week, entityIndex, day, period.n),
                    )
                    const allFree = cells.every((cell) => cell.length === 0)
                    const hasGap = cells.some(
                      (_, entityIndex) => gaps.get(`${entityIndex}|${day}`)?.[periodIndex] ?? false,
                    )
                    let cellClass = 'multi-grid-vertical-cell align-top border border-slate-200 p-1'
                    if (allFree && highlightFree) cellClass += ' schedule-cell-empty'
                    if (allFree && highlightCommonFree) cellClass += ' cell-free'
                    if (allFree && highlightCommonFree) cellClass += ' is-common-free'
                    else if (hasGap) cellClass += ' is-gap'

                    return (
                      <td key={period.n} className={cellClass}>
                        {week.entities.map((entity, entityIndex) => {
                          const lessons = cells[entityIndex]!
                          if (lessons.length === 0) return null

                          return (
                            <div
                              className="multi-grid-vertical-entity"
                              key={`${entity}-${entityIndex}`}
                            >
                              <span className="multi-grid-vertical-entity-name">{entity}</span>
                              {lessons.map((lesson) => (
                                <LessonCard
                                  key={lesson.id}
                                  lesson={lesson}
                                  violated={violated.has(lesson.id)}
                                  variant={variant}
                                  compact={compact}
                                  dense={dense}
                                />
                              ))}
                            </div>
                          )
                        })}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className={`schedule-responsive layout-${layout} density-${dense ? 'compact' : 'wide'}`}>
      <div className="schedule-table-wrap overflow-auto rounded border border-slate-200 bg-white">
        <table className="schedule-table w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-24 border border-slate-200 bg-slate-100 p-2 text-left text-xs font-medium text-slate-600">
                День / Пара
              </th>
              {week.entities.map((entity, index) => (
                <th
                  key={`${entity}-${index}`}
                  className="sticky top-0 z-20 min-w-[150px] border border-slate-200 bg-slate-100 p-2 text-left text-xs font-semibold"
                  title={entity}
                >
                  {entity}
                </th>
              ))}
            </tr>
          </thead>
          {week.days.map((day) => (
            <tbody key={day} className="day-group">
              <tr>
                <th
                  colSpan={week.entities.length + 1}
                  className="sticky left-0 z-10 border border-slate-300 bg-slate-200 p-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  {dayLong[day]}
                </th>
              </tr>
              {week.periods.map((period, periodIndex) => (
                <tr key={period.n}>
                  <th className="sticky left-0 z-10 w-24 border border-slate-200 bg-slate-50 p-1 text-right text-xs">
                    <div className="font-medium">{period.n}</div>
                    {period.start && (
                      <div className="text-[10px] text-slate-500">{period.start}</div>
                    )}
                  </th>
                  {week.entities.map((_, entityIndex) => {
                    const cell = cellOf(week, entityIndex, day, period.n)
                    const isGap = gaps.get(`${entityIndex}|${day}`)?.[periodIndex] ?? false
                    const free = cell.length === 0
                    const allFree = highlightCommonFree && commonFree(day, period.n)

                    let className = 'align-top border border-slate-200 p-1'
                    if (free && highlightFree) className += ' cell-free'
                    if (isGap) className += ' bg-slate-100'
                    if (allFree) className += ' bg-emerald-200'

                    return (
                      <td key={entityIndex} className={className}>
                        {cell.map((lesson) => (
                          <LessonCard
                            key={lesson.id}
                            lesson={lesson}
                            violated={violated.has(lesson.id)}
                            variant={variant}
                            compact={compact}
                            dense={dense}
                          />
                        ))}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  )
}

function HalfSection({
  title,
  week,
  violated,
  variant,
  compact,
  highlightFree,
  highlightCommonFree,
  dense,
  layout,
}: InnerProps & { title: string }) {
  return (
    <section>
      <h3 className="mb-1.5 inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h3>
      <MultiGridInner
        week={week}
        violated={violated}
        variant={variant}
        compact={compact}
        highlightFree={highlightFree}
        highlightCommonFree={highlightCommonFree}
        dense={dense}
        layout={layout}
      />
    </section>
  )
}

export function MultiGrid({
  week,
  violated,
  variant,
  compact = false,
  highlightFree = false,
  highlightCommonFree = false,
  dense = false,
  layout = 'horizontal',
  tab,
}: Props) {
  if (tab === 'collapse') {
    return (
      <div className="space-y-4">
        <HalfSection
          title="Над чертой"
          week={filterMultiWeek(week, 'odd')}
          violated={violated}
          variant={variant}
          compact={compact}
          highlightFree={highlightFree}
          highlightCommonFree={highlightCommonFree}
          dense={dense}
          layout={layout}
        />
        <HalfSection
          title="Под чертой"
          week={filterMultiWeek(week, 'even')}
          violated={violated}
          variant={variant}
          compact={compact}
          highlightFree={highlightFree}
          highlightCommonFree={highlightCommonFree}
          dense={dense}
          layout={layout}
        />
      </div>
    )
  }

  return (
    <MultiGridInner
      week={week}
      violated={violated}
      variant={variant}
      compact={compact}
      highlightFree={highlightFree}
      highlightCommonFree={highlightCommonFree}
      dense={dense}
      layout={layout}
    />
  )
}
