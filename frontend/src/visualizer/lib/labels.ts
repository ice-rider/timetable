import type { Day, Parity } from '../api/types'

export const dayShort: Record<Day, string> = {
  mon: 'пн',
  tue: 'вт',
  wed: 'ср',
  thu: 'чт',
  fri: 'пт',
  sat: 'сб',
  sun: 'вс',
}

export const dayLong: Record<Day, string> = {
  mon: 'Понедельник',
  tue: 'Вторник',
  wed: 'Среда',
  thu: 'Четверг',
  fri: 'Пятница',
  sat: 'Суббота',
  sun: 'Воскресенье',
}

export const typeRU: Record<string, string> = {
  lecture: 'лекция',
  practice: 'практика',
  lab: 'лабораторная',
  curator: 'кураторский',
  internship: 'практика (пр.)',
  credit: 'зачёт',
  graded_credit: 'диф. зачёт',
  exam: 'экзамен',
  consultation: 'консультация',
  other: '—',
}

export function lessonTypeLabel(kind: string): string {
  return typeRU[kind] ?? kind
}

export function parityBadge(p: Parity): string | null {
  if (p === 'odd') return 'над'
  if (p === 'even') return 'под'
  return null
}

export function parityLabel(p: Parity): string {
  if (p === 'odd') return 'над чертой'
  if (p === 'even') return 'под чертой'
  return ''
}

export function pluralPairs(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'пара'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'пары'
  return 'пар'
}

/** Пастельный фон и цвет полосы для типа занятия. */
export interface TypeStyle {
  bg: string // фон карточки
  border: string // цвет левой полосы и рамки
  label: string // подпись типа (заглавными)
}

export function typeStyle(kind: string, opts?: { softBg?: boolean }): TypeStyle {
  const soft = opts?.softBg !== false

  switch (kind) {
    case 'lecture':
      return { bg: soft ? 'bg-sky-50' : 'bg-white', border: 'border-sky-500', label: 'Лекция' }
    case 'practice':
      return {
        bg: soft ? 'bg-emerald-50' : 'bg-white',
        border: 'border-emerald-500',
        label: 'Практика',
      }
    case 'lab':
      return {
        bg: soft ? 'bg-amber-50' : 'bg-white',
        border: 'border-amber-500',
        label: 'Лабораторная',
      }
    case 'curator':
      return {
        bg: soft ? 'bg-orange-50' : 'bg-white',
        border: 'border-orange-500',
        label: 'Кураторский',
      }
    case 'internship':
      return {
        bg: soft ? 'bg-teal-50' : 'bg-white',
        border: 'border-teal-500',
        label: 'Практика (пр.)',
      }
    case 'credit':
    case 'graded_credit':
    case 'exam':
      return {
        bg: soft ? 'bg-rose-50' : 'bg-white',
        border: 'border-rose-500',
        label: 'Зачёт / экзамен',
      }
    case 'consultation':
      return {
        bg: soft ? 'bg-indigo-50' : 'bg-white',
        border: 'border-indigo-500',
        label: 'Консультация',
      }
    default:
      return { bg: soft ? 'bg-slate-50' : 'bg-white', border: 'border-slate-400', label: 'Занятие' }
  }
}
