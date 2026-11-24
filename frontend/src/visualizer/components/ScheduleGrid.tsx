import { useMemo, useState } from 'react'
import type { Day, Lesson } from '../api/types'
import type { HalfWeek, ParityTab } from '../lib/parity'
import { dayLong, dayShort, pluralPairs } from '../lib/labels'
import { findGaps, type EntityWeek } from '../lib/schedule'
import type { ScheduleOrientation } from '../lib/viewPreferences'
import { LessonCard, type LessonCardVariant } from './LessonCard'

interface Props {
  week: EntityWeek
  violated: Set<number>
  variant?: LessonCardVariant
  tab: ParityTab
  highlightFree?: Set<string>
  showGaps?: boolean
  dense?: boolean
  highlightedIds?: Set<number>
  layout?: ScheduleOrientation
}

interface GridProps {
  week: EntityWeek
  violated: Set<number>
  variant: LessonCardVariant
  highlightFree?: Set<string>
  dense: boolean
  highlightedIds?: Set<number>
  layout: ScheduleOrientation
  half?: HalfWeek
  showGaps: boolean
}

function splitWeek(week: EntityWeek, half: HalfWeek): EntityWeek {
  const lessons = week.lessons.filter(
    (lesson) => lesson.parity === 'every' || lesson.parity === half,
  )
  const grid = new Map<string, Lesson[]>()
  for (const lesson of lessons) {
    const key = `${lesson.day}-${lesson.period}`
    const cell = grid.get(key)
    if (cell) cell.push(lesson)
    else grid.set(key, [lesson])
  }
  return { ...week, lessons, grid }
}

function shouldHighlight(
  cell: Lesson[],
  day: Day,
  period: number,
  highlightFree?: Set<string>,
  half?: HalfWeek,
): boolean {
  if (cell.length > 0 || !highlightFree) return false
  if (half) return highlightFree.has(`${day}-${period}-${half}`)
  return highlightFree.has(`${day}-${period}-odd`) || highlightFree.has(`${day}-${period}-even`)
}

function gapMapOf(week: EntityWeek): Map<string, { length: number; isStart: boolean }> {
  const map = new Map<string, { length: number; isStart: boolean }>()
  for (const gap of findGaps(week)) {
    for (let period = gap.startPeriod; period <= gap.endPeriod; period++) {
      map.set(`${gap.day}-${period}`, {
        length: gap.length,
        isStart: period === gap.startPeriod,
      })
    }
  }
  return map
}

function GapSummary({ week }: { week: EntityWeek }) {
  const gaps = useMemo(() => findGaps(week), [week])
  if (gaps.length === 0) return null

  const max = Math.max(...gaps.map((gap) => gap.length))
  const byDay = new Map<Day, number[]>()
  for (const gap of gaps) {
    const lengths = byDay.get(gap.day) ?? []
    lengths.push(gap.length)
    byDay.set(gap.day, lengths)
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm">
      <span className="font-medium text-amber-900">Окна:</span>
      <span className="text-amber-900">
        {gaps.length} · самое длинное — {max} {pluralPairs(max)}
      </span>
      {[...byDay.entries()].map(([day, lengths]) => (
        <span
          key={day}
          className="rounded bg-white px-1.5 py-0.5 text-xs text-amber-900 ring-1 ring-amber-200"
        >
          {dayShort[day]}: {lengths.join(', ')}
        </span>
      ))}
    </div>
  )
}

function GridTable({
  week,
  violated,
  variant,
  highlightFree,
  dense,
  highlightedIds,
  layout,
  half,
  showGaps,
}: GridProps) {
  const [selectedDay, setSelectedDay] = useState<Day | undefined>(week.days[0])
  const gapByCell = useMemo(() => (showGaps ? gapMapOf(week) : null), [week, showGaps])
  const activeDay = selectedDay && week.days.includes(selectedDay) ? selectedDay : week.days[0]

  if (week.lessons.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Занятий нет.
      </p>
    )
  }

  const cellContent = (day: Day, period: number) => {
    const cell = week.grid.get(`${day}-${period}`) ?? []
    const gap = gapByCell?.get(`${day}-${period}`)
    return (
      <>
        {cell.map((lesson) => (
          <LessonCard
            key={lesson.id}
            lesson={lesson}
            violated={violated.has(lesson.id)}
            variant={variant}
            dense={dense}
            highlighted={highlightedIds?.has(lesson.id)}
          />
        ))}
        {gap?.isStart && (
          <span className="gap-badge">
            {gap.length} {pluralPairs(gap.length)}
          </span>
        )}
      </>
    )
  }

  const cellClass = (day: Day, period: number, extra = '') => {
    const cell = week.grid.get(`${day}-${period}`) ?? []
    const free = shouldHighlight(cell, day, period, highlightFree, half)
    const gap = gapByCell?.get(`${day}-${period}`)
    let className = `schedule-cell align-top border border-slate-200 p-1 ${extra}`
    if (cell.length === 0) className += ' schedule-cell-empty'
    if (free) className += ' cell-free'
    if (gap) {
      className +=
        gap.length >= 3 ? ' gap-cell-lg' : gap.length === 2 ? ' gap-cell-md' : ' gap-cell-sm'
    }
    return className
  }

  return (
    <div className={`schedule-responsive layout-${layout} density-${dense ? 'compact' : 'wide'}`}>
      <div className="schedule-desktop-horizontal schedule-table-wrap overflow-x-auto">
        <table className="schedule-table w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="schedule-corner sticky left-0 top-0 z-20 w-20 border border-slate-200 bg-slate-100 p-2 text-left text-xs font-medium text-slate-600">
                Пара
              </th>
              {week.days.map((day) => (
                <th
                  key={day}
                  className="schedule-day-head sticky top-0 z-10 min-w-[140px] border border-slate-200 bg-slate-100 p-2 text-center font-medium"
                >
                  {dayShort[day]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.periods.map((period) => (
              <tr key={period.n}>
                <th className="schedule-period-head sticky left-0 z-10 border border-slate-200 bg-slate-50 p-1 text-right text-xs">
                  <span className="schedule-period-number">{period.n}</span>
                  {period.start && (
                    <span className="schedule-period-time">
                      {period.start}
                      {period.end ? `–${period.end}` : ''}
                    </span>
                  )}
                </th>
                {week.days.map((day) => (
                  <td key={day} className={cellClass(day, period.n)}>
                    {cellContent(day, period.n)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="schedule-desktop-vertical schedule-table-wrap overflow-x-auto">
        <table className="schedule-table schedule-table-vertical w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="schedule-corner sticky left-0 top-0 z-20 border border-slate-200 bg-slate-100 p-2 text-left text-xs font-medium text-slate-600">
                День
              </th>
              {week.periods.map((period) => (
                <th
                  key={period.n}
                  className="schedule-period-column sticky top-0 z-10 border border-slate-200 bg-slate-100 p-2 text-center font-medium"
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
                {week.periods.map((period) => (
                  <td key={period.n} className={cellClass(day, period.n)}>
                    {cellContent(day, period.n)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="schedule-mobile-agenda">
        {week.days.map((day) => (
          <section className="schedule-day-card" key={day}>
            <header className="schedule-day-card-header">
              <span>{dayLong[day]}</span>
              <span className="schedule-day-card-caption">{dayShort[day]}</span>
            </header>
            <div className="schedule-pair-list">
              {week.periods.map((period) => {
                const cell = week.grid.get(`${day}-${period.n}`) ?? []
                const gap = gapByCell?.get(`${day}-${period.n}`)
                const free = shouldHighlight(cell, day, period.n, highlightFree, half)
                const rowClass = [
                  'schedule-pair-row',
                  cell.length === 0 ? 'is-empty' : '',
                  free ? 'is-common-free' : '',
                  gap ? 'is-gap' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <div className={rowClass} key={period.n}>
                    <div className="schedule-pair-side">
                      <span className="schedule-pair-number">{period.n}</span>
                      {period.start && (
                        <span className="schedule-pair-time">
                          {period.start}
                          {period.end ? `–${period.end}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="schedule-pair-content">{cellContent(day, period.n)}</div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="schedule-mobile-horizontal">
        <div className="schedule-day-strip" role="group" aria-label="День недели">
          {week.days.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(day)}
              aria-pressed={activeDay === day}
              aria-label={dayLong[day]}
              className="schedule-day-pill"
            >
              <span>{dayShort[day]}</span>
            </button>
          ))}
        </div>
        {activeDay && (
          <>
            <div className="schedule-day-context">{dayLong[activeDay]}</div>
            <div className="schedule-mobile-pair-list">
              {week.periods.map((period) => {
                const cell = week.grid.get(`${activeDay}-${period.n}`) ?? []
                const gap = gapByCell?.get(`${activeDay}-${period.n}`)
                return (
                  <article
                    className={`schedule-mobile-pair-card ${cell.length === 0 ? 'is-empty' : ''} ${
                      gap ? 'is-gap' : ''
                    }`}
                    key={period.n}
                  >
                    <header className="schedule-mobile-pair-header">
                      <span className="schedule-mobile-pair-number">{period.n}</span>
                      {period.start && (
                        <span className="schedule-mobile-pair-time">
                          {period.start}
                          {period.end ? ` – ${period.end}` : ''}
                        </span>
                      )}
                    </header>
                    <div className="schedule-mobile-pair-content">
                      {cellContent(activeDay, period.n)}
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function HalfBlock({
  title,
  week,
  violated,
  variant,
  highlightFree,
  dense,
  highlightedIds,
  layout,
  half,
  showGaps,
}: GridProps & { title: string }) {
  return (
    <section>
      <h3 className="schedule-half-label mb-1.5 inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h3>
      {showGaps && <GapSummary week={week} />}
      <GridTable
        week={week}
        violated={violated}
        variant={variant}
        highlightFree={highlightFree}
        dense={dense}
        highlightedIds={highlightedIds}
        layout={layout}
        half={half}
        showGaps={showGaps}
      />
    </section>
  )
}

export function ScheduleGrid({
  week,
  violated,
  variant = 'teacher',
  tab,
  highlightFree,
  showGaps = variant === 'group',
  dense = false,
  highlightedIds,
  layout = 'horizontal',
}: Props) {
  if (tab === 'collapse') {
    return (
      <div className="space-y-4">
        <HalfBlock
          title="Над чертой"
          week={splitWeek(week, 'odd')}
          violated={violated}
          variant={variant}
          highlightFree={highlightFree}
          dense={dense}
          highlightedIds={highlightedIds}
          layout={layout}
          half="odd"
          showGaps={showGaps}
        />
        <HalfBlock
          title="Под чертой"
          week={splitWeek(week, 'even')}
          violated={violated}
          variant={variant}
          highlightFree={highlightFree}
          dense={dense}
          highlightedIds={highlightedIds}
          layout={layout}
          half="even"
          showGaps={showGaps}
        />
      </div>
    )
  }

  if (tab === 'combine') {
    return (
      <div>
        {showGaps && (
          <p className="mb-2 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            Окна считаются отдельно для каждой недели — переключитесь в «Раздельно», «Над чертой»
            или «Под чертой», чтобы их увидеть.
          </p>
        )}
        <GridTable
          week={week}
          violated={violated}
          variant={variant}
          highlightFree={highlightFree}
          dense={dense}
          highlightedIds={highlightedIds}
          layout={layout}
          showGaps={false}
        />
      </div>
    )
  }

  const half: HalfWeek | undefined = tab === 'odd' ? 'odd' : tab === 'even' ? 'even' : undefined

  return (
    <div>
      {showGaps && <GapSummary week={week} />}
      <GridTable
        week={week}
        violated={violated}
        variant={variant}
        highlightFree={highlightFree}
        dense={dense}
        highlightedIds={highlightedIds}
        layout={layout}
        half={half}
        showGaps={showGaps}
      />
    </div>
  )
}
