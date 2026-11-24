import type { Day, Lesson, MergedModel, Period, Violation } from '../api/types'
import {
  halvesFor,
  isSlotBusy,
  matchesParity,
  WEEKDAYS,
  type HalfWeek,
  type ParityTab,
} from './parity'

export type { ParityTab } from './parity'
export { matchesParity } from './parity'

export interface EntityWeek {
  days: Day[]
  periods: Period[]
  grid: Map<string, Lesson[]>
  lessons: Lesson[]
  violations: Violation[]
}

export interface Gap {
  day: Day
  startPeriod: number
  endPeriod: number
  length: number
}

export function findGaps(week: EntityWeek): Gap[] {
  const gaps: Gap[] = []
  for (const day of week.days) {
    const busy = new Set<number>()
    for (const period of week.periods) {
      if ((week.grid.get(`${day}-${period.n}`) ?? []).length > 0) {
        busy.add(period.n)
      }
    }
    if (busy.size < 2) continue

    const sorted = [...busy].sort((a, b) => a - b)
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    let gapStart: number | null = null

    for (let period = first + 1; period <= last; period++) {
      if (busy.has(period)) {
        if (gapStart !== null) {
          gaps.push({
            day,
            startPeriod: gapStart,
            endPeriod: period - 1,
            length: period - gapStart,
          })
          gapStart = null
        }
      } else if (gapStart === null) {
        gapStart = period
      }
    }
  }
  return gaps
}

export interface HalfGap extends Gap {
  parity: HalfWeek
}

export function findGapsWithParity(week: EntityWeek): HalfGap[] {
  const gaps: HalfGap[] = []
  for (const parity of ['odd', 'even'] as const) {
    const lessons = week.lessons.filter(
      (lesson) => lesson.parity === 'every' || lesson.parity === parity,
    )
    const grid = new Map<string, Lesson[]>()
    for (const lesson of lessons) {
      const key = `${lesson.day}-${lesson.period}`
      const cell = grid.get(key)
      if (cell) cell.push(lesson)
      else grid.set(key, [lesson])
    }
    const halfWeek: EntityWeek = { ...week, lessons, grid }
    for (const gap of findGaps(halfWeek)) {
      gaps.push({ ...gap, parity })
    }
  }
  return gaps
}

export function effectivePeriods(model: MergedModel): Period[] {
  if (model.periods.length > 0) return model.periods
  const max = model.lessons.reduce((value, lesson) => Math.max(value, lesson.period), 0)
  const count = Math.max(max, 7)
  return Array.from({ length: count }, (_, index) => ({
    n: index + 1,
    start: '',
    end: '',
  }))
}

export function daysWithLessons(model: MergedModel): Day[] {
  return WEEKDAYS.filter((day) => model.lessons.some((lesson) => lesson.day === day))
}

function buildWeek(lessons: Lesson[], model: MergedModel, days: Day[]): EntityWeek {
  const grid = new Map<string, Lesson[]>()
  for (const lesson of lessons) {
    const key = `${lesson.day}-${lesson.period}`
    const cell = grid.get(key)
    if (cell) cell.push(lesson)
    else grid.set(key, [lesson])
  }
  const ids = new Set(lessons.map((lesson) => lesson.id))
  const violations = model.violations.filter((violation) =>
    violation.lesson_ids.some((id) => ids.has(id)),
  )
  return { days, periods: effectivePeriods(model), grid, lessons, violations }
}

function usedDays(lessons: Lesson[]): Day[] {
  const used = new Set(lessons.map((lesson) => lesson.day))
  return WEEKDAYS.filter((day) => used.has(day))
}

export function teacherWeek(model: MergedModel, teacher: string, tab: ParityTab): EntityWeek {
  const lessons = model.lessons.filter(
    (lesson) => lesson.teachers.includes(teacher) && matchesParity(lesson, tab),
  )
  return buildWeek(lessons, model, usedDays(lessons))
}

export function groupWeek(model: MergedModel, group: string, tab: ParityTab): EntityWeek {
  const lessons = model.lessons.filter(
    (lesson) =>
      lesson.audience.some((audience) => audience.group === group) && matchesParity(lesson, tab),
  )
  return buildWeek(lessons, model, usedDays(lessons))
}

export function roomWeek(model: MergedModel, room: string, tab: ParityTab): EntityWeek {
  const lessons = model.lessons.filter(
    (lesson) => lesson.room === room && matchesParity(lesson, tab),
  )
  return buildWeek(lessons, model, usedDays(lessons))
}

export interface MultiWeek {
  entities: string[]
  days: Day[]
  periods: Period[]
  cells: Map<string, Lesson[]>
  lessons: Lesson[]
  violations: Violation[]
}

export function cellOf(week: MultiWeek, entityIndex: number, day: Day, period: number): Lesson[] {
  return week.cells.get(`${entityIndex}|${day}|${period}`) ?? []
}

function buildMulti(
  model: MergedModel,
  entities: string[],
  entityLessons: Lesson[][],
  tab: ParityTab,
): MultiWeek {
  const relevant = new Set<number>()
  entityLessons.forEach((lessons) => {
    lessons.forEach((lesson) => {
      if (matchesParity(lesson, tab)) relevant.add(lesson.id)
    })
  })
  const lessons = model.lessons.filter((lesson) => relevant.has(lesson.id))

  const cells = new Map<string, Lesson[]>()
  entities.forEach((_, entityIndex) => {
    for (const lesson of entityLessons[entityIndex] ?? []) {
      if (!matchesParity(lesson, tab)) continue
      const key = `${entityIndex}|${lesson.day}|${lesson.period}`
      const cell = cells.get(key)
      if (cell) cell.push(lesson)
      else cells.set(key, [lesson])
    }
  })

  const ids = new Set(lessons.map((lesson) => lesson.id))
  const violations = model.violations.filter((violation) =>
    violation.lesson_ids.some((id) => ids.has(id)),
  )

  return {
    entities,
    days: daysWithLessons(model),
    periods: effectivePeriods(model),
    cells,
    lessons,
    violations,
  }
}

export function teachersWeek(model: MergedModel, teachers: string[], tab: ParityTab): MultiWeek {
  const perEntity = teachers.map((teacher) =>
    model.lessons.filter((lesson) => lesson.teachers.includes(teacher)),
  )
  return buildMulti(model, teachers, perEntity, tab)
}

export function roomsWeek(model: MergedModel, rooms: string[], tab: ParityTab): MultiWeek {
  const perEntity = rooms.map((room) => model.lessons.filter((lesson) => lesson.room === room))
  return buildMulti(model, rooms, perEntity, tab)
}

export type EntityKind = 'teacher' | 'group' | 'room'

export interface EntityRef {
  kind: EntityKind
  name: string
}

export interface FreeSlot {
  day: Day
  period: number
  parity: HalfWeek
  entities: string[]
}

function lessonsForEntity(model: MergedModel, kind: EntityKind, name: string): Lesson[] {
  switch (kind) {
    case 'teacher':
      return model.lessons.filter((lesson) => lesson.teachers.includes(name))
    case 'group':
      return model.lessons.filter((lesson) =>
        lesson.audience.some((audience) => audience.group === name),
      )
    case 'room':
      return model.lessons.filter((lesson) => lesson.room === name)
  }
}

export function findCommonFreeSlotsMixed(
  refs: EntityRef[],
  model: MergedModel,
  tab: ParityTab,
): FreeSlot[] {
  if (refs.length === 0) return []
  const halves = halvesFor(tab)
  const lessonsPerEntity = refs.map((ref) => lessonsForEntity(model, ref.kind, ref.name))
  const periods = effectivePeriods(model)
  const days = daysWithLessons(model)
  const names = refs.map((ref) => ref.name)
  const slots: FreeSlot[] = []

  for (const parity of halves) {
    for (const day of days) {
      for (const period of periods) {
        if (lessonsPerEntity.every((lessons) => !isSlotBusy(lessons, day, period.n, parity))) {
          slots.push({ day, period: period.n, parity, entities: names })
        }
      }
    }
  }
  return slots
}

export function findCommonFreeSlots(
  entities: string[],
  kind: EntityKind,
  model: MergedModel,
  tab: ParityTab,
): FreeSlot[] {
  return findCommonFreeSlotsMixed(
    entities.map((name) => ({ kind, name })),
    model,
    tab,
  )
}
