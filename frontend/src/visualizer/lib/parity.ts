import type { Day, Lesson } from '../api/types'

export type ParityTab = 'odd' | 'even' | 'combine' | 'collapse'
export type HalfWeek = 'odd' | 'even'

export const WEEKDAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export function matchesParity(lesson: Lesson, tab: ParityTab): boolean {
  if (tab === 'combine' || tab === 'collapse' || lesson.parity === 'every') return true
  return lesson.parity === tab
}

export function halvesFor(tab: ParityTab): HalfWeek[] {
  if (tab === 'odd') return ['odd']
  if (tab === 'even') return ['even']
  return ['odd', 'even']
}

export function isSlotBusy(lessons: Lesson[], day: Day, period: number, half: HalfWeek): boolean {
  return lessons.some(
    (l) => l.day === day && l.period === period && (l.parity === 'every' || l.parity === half),
  )
}
