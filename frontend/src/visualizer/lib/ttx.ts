import type { Lesson, MergedModel } from '../api/types.ts'

type TtxRecord = Record<string, unknown> & { kind: string }

function lessonRecord(lesson: Lesson): TtxRecord {
  return {
    kind: 'lesson',
    id: lesson.id,
    refs: lesson.refs,
    audience: lesson.audience,
    day: lesson.day,
    period: lesson.period,
    parity: lesson.parity,
    lesson_type: lesson.lesson_type,
    discipline: lesson.discipline,
    teachers: lesson.teachers,
    ...(lesson.room ? { room: lesson.room } : {}),
    ...(lesson.place ? { place: lesson.place } : {}),
    ...(lesson.raw ? { raw: lesson.raw } : {}),
    ...(lesson.note ? { note: lesson.note } : {}),
    ...(lesson.flags ? { flags: lesson.flags } : {}),
  }
}

export function serializeTimetable(model: MergedModel): string {
  const placeKeys = new Set(model.lessons.flatMap((lesson) => (lesson.place ? [lesson.place] : [])))
  const records: TtxRecord[] = [
    {
      kind: 'source',
      id: `frontend-${Date.now()}`,
      format: 'ttx/1',
      adapter: 'timetable-frontend',
      file: 'timetable.ttx',
      title: model.sources.map((source) => source.file ?? source.title ?? source.id).join(', '),
    },
    ...model.periods.map((period) => ({
      kind: 'period',
      n: period.n,
      start: period.start,
      end: period.end,
    })),
    ...model.groups.map((key) => ({ kind: 'group', key, size: null })),
    ...model.teachers.map((key) => ({ kind: 'teacher', key })),
    ...model.rooms.map((room) => ({ kind: 'room', ...room })),
    ...[...placeKeys].map((key) => ({
      kind: 'place',
      key,
      title: key,
      virtual: key !== 'none',
    })),
    ...model.lessons.map(lessonRecord),
  ]

  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
}

export function downloadTimetable(model: MergedModel): void {
  const blob = new Blob([serializeTimetable(model)], {
    type: 'application/x-ndjson;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'timetable.ttx'
  link.click()
  URL.revokeObjectURL(url)
}
