export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type Parity = 'every' | 'odd' | 'even'

export interface SourceRef {
  sheet: string
  row: number
  col: string
}
export interface AudienceMember {
  group: string
  subgroup: number | null
}
export interface Period {
  n: number
  start: string
  end: string
}
export interface Source {
  id: string
  adapter: string
  file?: string
  sha256?: string
  title?: string
}
export interface Stats {
  lessons: number
  groups: number
  teachers: number
  rooms: number
  disciplines: number
  hard: number
}
export interface Room {
  key: string
  building: string
  type: string
  title: string
  capacity: number | null
}
export interface ViolationResource {
  kind: 'teacher' | 'group' | 'room'
  name: string
}
export interface Violation {
  rule: string
  title: string
  message: string
  lesson_ids: number[]
  resource?: ViolationResource
  day?: Day
  period?: number
}
export interface Criterion {
  key: string
  title: string
  value: number
  weight: number
  weighted: number
  available: boolean
}
export interface EntityScore {
  name: string
  lessons: number
  gaps: number
  transitions: number
  max_per_day: number
  conflicts: number
}
export interface Issue {
  kind?: 'issue'
  code: string
  ref?: SourceRef
  message: string
}

export interface Lesson {
  id: number
  refs: SourceRef[]
  audience: AudienceMember[]
  day: Day
  period: number
  parity: Parity
  lesson_type: string
  discipline: string
  teachers: string[]
  room?: string
  place?: string
  raw?: Record<string, string>
  note?: string
  flags?: string[]
}

export interface ReviewReport {
  source: Source
  periods: Period[]
  stats: Stats
  lessons: Lesson[]
  rooms: Room[]
  violations: Violation[]
  soft: Criterion[]
  soft_total: number
  groups: EntityScore[]
  teachers: EntityScore[]
  issues: Issue[]
  notes: string[]
}

/** Клиентская модель после слияния N файлов. */
export interface MergedModel {
  periods: Period[]
  lessons: Lesson[]
  teachers: string[] // ключи, отсортированы
  groups: string[] // union lesson.audience[].group, отсортированы
  rooms: Room[] // union Report.rooms по key, отсортированы
  violations: Violation[]
  soft: Criterion[] // union по key, weighted/value суммарно
  softTotal: number
  sources: Source[]
  issues: Issue[]
  violatedLessons: Set<number> // lesson_id → участвует в violation
}
