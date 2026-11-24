import type { Schedule } from './scheduler.ts'

export const PENDING_TTX_STORAGE_KEY = 'timetable:pending-ttx'

const DAYS: Record<string, string> = {
  MO: 'mon',
  TU: 'tue',
  WE: 'wed',
  TH: 'thu',
  FR: 'fri',
  SA: 'sat',
  SU: 'sun',
}

export function serializeSchedule(schedule: Schedule): string {
  const unplaced = schedule.lessons.filter((lesson) => !lesson.placed)
  if (unplaced.length > 0) {
    throw new Error(`Нельзя экспортировать TTX/1: не размещено занятий — ${unplaced.length}.`)
  }

  const groups = new Set(schedule.lessons.flatMap((lesson) => lesson.audience))
  const teachers = new Set(
    schedule.lessons.flatMap((lesson) => (lesson.teacher ? [lesson.teacher] : [])),
  )
  const rooms = new Set(schedule.lessons.flatMap((lesson) => (lesson.room ? [lesson.room] : [])))
  const records = [
    {
      kind: 'source',
      id: `schedule-${schedule.id}`,
      format: 'ttx/1',
      adapter: 'timetable-generator',
      file: `schedule-${schedule.id}.ttx`,
      title: schedule.name,
    },
    ...schedule.periods.map((period) => ({
      kind: 'period',
      n: period.number,
      start: period.starts_at,
      end: period.ends_at,
    })),
    ...[...groups].map((key) => ({ kind: 'group', key, size: null })),
    ...[...teachers].map((key) => ({ kind: 'teacher', key })),
    ...[...rooms].map((key) => ({
      kind: 'room',
      key,
      building: '',
      type: '',
      title: key,
      capacity: null,
    })),
    ...schedule.lessons.map((lesson) => {
      const day = lesson.day ? DAYS[lesson.day] : undefined
      if (!day || !lesson.period) {
        throw new Error(`У занятия «${lesson.discipline}» отсутствует день или номер пары.`)
      }

      return {
        kind: 'lesson',
        id: lesson.id,
        refs: [],
        audience: lesson.audience.map((group) => ({ group, subgroup: null })),
        day,
        period: lesson.period,
        parity: lesson.parity ?? 'every',
        lesson_type: lesson.kind,
        discipline: lesson.discipline,
        teachers: lesson.teacher ? [lesson.teacher] : [],
        ...(lesson.room ? { room: lesson.room } : {}),
      }
    }),
  ]

  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
}

export function downloadSchedule(schedule: Schedule): void {
  const blob = new Blob([serializeSchedule(schedule)], {
    type: 'application/x-ndjson;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `schedule-${schedule.id}.ttx`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
