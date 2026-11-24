import type {
  Criterion,
  Issue,
  Lesson,
  MergedModel,
  ReviewReport,
  Room,
  Source,
  Violation,
} from '../api/types'

const ID_STRIDE = 1_000_000

export function mergeReports(reports: ReviewReport[]): MergedModel {
  if (reports.length === 0) throw new Error('нет отчётов для слияния')

  const firstPeriods = JSON.stringify(reports[0]!.periods)
  if (reports.some((report) => JSON.stringify(report.periods) !== firstPeriods)) {
    throw new Error(
      'у файлов разные сетки времени; объедините расписания с одинаковым расписанием пар',
    )
  }

  const lessons: Lesson[] = []
  const violations: Violation[] = []
  const issues: Issue[] = []
  const sources: Source[] = []
  const teachers = new Set<string>()
  const groups = new Set<string>()
  const rooms = new Map<string, Room>()
  const soft = new Map<string, Criterion>()
  const violatedLessons = new Set<number>()

  reports.forEach((r, fileIdx) => {
    const idMap = new Map<number, number>()

    for (const l of r.lessons) {
      const newId = fileIdx * ID_STRIDE + l.id
      idMap.set(l.id, newId)
      lessons.push({ ...l, id: newId })
      l.teachers.forEach((t) => teachers.add(t))
      l.audience.forEach((a) => groups.add(a.group))
    }

    for (const room of r.rooms) {
      if (!rooms.has(room.key)) rooms.set(room.key, room)
    }

    for (const v of r.violations) {
      const remapped = v.lesson_ids.map((id) => idMap.get(id) ?? id)
      violations.push({ ...v, lesson_ids: remapped })
      remapped.forEach((id) => violatedLessons.add(id))
    }

    for (const c of r.soft) {
      const prev = soft.get(c.key)
      if (!prev) soft.set(c.key, { ...c })
      else {
        prev.value += c.value
        prev.weighted += c.weighted
        prev.available = prev.available && c.available
      }
    }

    issues.push(...r.issues)
    sources.push(r.source)
  })

  const softList = [...soft.values()]
  return {
    periods: reports[0]!.periods,
    lessons,
    teachers: [...teachers].sort((a, b) => a.localeCompare(b, 'ru')),
    groups: [...groups].sort((a, b) => a.localeCompare(b, 'ru')),
    rooms: [...rooms.values()].sort((a, b) => a.key.localeCompare(b.key, 'ru')),
    violations,
    soft: softList,
    softTotal: softList.reduce((s, c) => s + c.weighted, 0),
    sources,
    issues,
    violatedLessons,
  }
}
