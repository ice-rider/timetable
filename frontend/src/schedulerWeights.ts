export const SOFT_CRITERIA = [
  { key: 'gaps', title: 'Окна' },
  { key: 'corpus_transitions', title: 'Переходы между корпусами' },
  { key: 'teacher_compactness', title: 'Учебные дни преподавателей' },
  { key: 'min_working_days', title: 'Повторы дисциплины в один день' },
  { key: 'curriculum_compactness', title: 'Одиночные пары в дне' },
  { key: 'room_stability', title: 'Смена аудиторий у дисциплины' },
  { key: 'room_capacity_waste', title: 'Пустые места (десятки)' },
  { key: 'edge_slots', title: 'Первая и последняя пара' },
  { key: 'room_count', title: 'Задействовано аудиторий' },
  { key: 'teacher_preferences', title: 'Нежелательные слоты' },
] as const

export type CriterionKey = (typeof SOFT_CRITERIA)[number]['key']

// Current backend soft.DefaultWeights().
export const DEFAULT_WEIGHTS: Record<CriterionKey, number> = {
  gaps: 5,
  corpus_transitions: 5,
  teacher_compactness: 1,
  min_working_days: 2,
  curriculum_compactness: 2,
  room_stability: 1,
  room_capacity_waste: 1,
  edge_slots: 2,
  room_count: 0,
  teacher_preferences: 5,
}

export type Weights = Record<CriterionKey, number>

export type Row = {
  key: CriterionKey
  title: string
  weight: number
  stableOrder: number
}

const STORAGE_KEY = 'timetable-weight-last-positive'

// Plain-language decoding of every soft criterion, shown next to the row "?" marker.
export const CRITERION_DESCRIPTIONS: Record<CriterionKey, string> = {
  gaps: 'Окна — пустые периоды между занятиями группы или преподавателя в её дне.',
  corpus_transitions:
    'Переходы между корпусами — смена здания между соседними занятиями в один день.',
  teacher_compactness:
    'Учебные дни преподавателей — сколько учебных дней у преподавателя за неделю (меньше — больше свободных).',
  min_working_days: 'Повторы дисциплины в один день — не хватает различных дней для повторения.',
  curriculum_compactness:
    'Одиночные пары в дне — занятие пары изолировано, если у группы нет других занятий.',
  room_stability:
    'Смена аудиторий у дисциплины — на сколько дополнительных аудиторий рассчитано занятие.',
  room_capacity_waste:
    'Пустые места (десятки) — сколько целых десятков мест не занято в занятой аудитории.',
  edge_slots: 'Первая и последняя пара — занятия стоят в первом или последнем периоде дня.',
  room_count: 'Задействовано аудиторий — сколько аудиторий вообще вовлечено в расписание.',
  teacher_preferences:
    'Нежелательные слоты — занятия попадают в нежелательные слоты преподавателя или аудитории.',
}

export function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(v)))
}

export function readLastPositive(): Partial<Record<CriterionKey, number>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Record<CriterionKey, number>>) : {}
  } catch {
    return {}
  }
}

export function writeLastPositive(v: Partial<Record<CriterionKey, number>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    // localStorage may be unavailable; ordering still works in memory.
  }
}

export function normalizeWeights(weights: Partial<Record<string, number>>): Weights {
  const out = { ...DEFAULT_WEIGHTS }
  for (const c of SOFT_CRITERIA) {
    const v = weights[c.key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[c.key] = Math.trunc(v)
  }
  return out
}

export function makeRows(weights: Weights): Row[] {
  return SOFT_CRITERIA.map((c, i) => ({
    key: c.key,
    title: c.title,
    weight: weights[c.key],
    stableOrder: i,
  }))
}

export function sortRows(rows: Row[]): Row[] {
  const checked = rows
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.stableOrder - b.stableOrder)
  const unchecked = rows.filter((r) => r.weight === 0).sort((a, b) => a.stableOrder - b.stableOrder)
  return [...checked, ...unchecked]
}

export function toWeights(rows: Row[]): Weights {
  const out = { ...DEFAULT_WEIGHTS }
  for (const c of SOFT_CRITERIA) out[c.key] = 0
  for (const r of rows) out[r.key] = Math.max(0, Math.trunc(r.weight))
  return out
}

export function moveCriterion(rows: Row[], movedKey: CriterionKey, newIndex: number): Row[] {
  const sorted = sortRows(rows)
  const moved = sorted.find((r) => r.key === movedKey)
  if (!moved || moved.weight === 0) return sorted

  const checked = sorted.filter((r) => r.weight > 0 && r.key !== movedKey)
  const unchecked = sorted.filter((r) => r.weight === 0)
  const insertion = clampInt(newIndex, 0, checked.length)

  const upper = checked[insertion - 1]?.weight ?? null
  const lower = checked[insertion]?.weight ?? null

  let weight = 1

  if (upper == null && lower == null) {
    weight = 1
  } else if (upper == null) {
    weight = (lower ?? 0) + 1
  } else if (lower == null) {
    weight = Math.max(1, upper - 1)
  } else {
    const mid = Math.floor((upper + lower) / 2)
    if (mid > lower && mid < upper) {
      weight = mid
      const next = [...checked]
      next.splice(insertion, 0, { ...moved, weight })
      return sortRows([...next, ...unchecked])
    }

    const above = checked
      .slice(0, insertion)
      .map((x) => (x.weight >= upper ? { ...x, weight: x.weight + 1 } : x))
    const rest = checked.slice(insertion)
    const next = [...above, ...rest]
    next.splice(insertion, 0, { ...moved, weight: (lower ?? 0) + 1 })
    return sortRows([...next, ...unchecked])
  }

  const next = [...checked]
  next.splice(insertion, 0, { ...moved, weight })
  return sortRows([...next, ...unchecked])
}
