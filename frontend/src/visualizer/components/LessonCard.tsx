import { useState } from 'react'
import type { Lesson } from '../api/types'
import { parityBadge, typeStyle } from '../lib/labels'

export type LessonCardVariant = 'teacher' | 'group' | 'room'

interface Props {
  lesson: Lesson
  violated: boolean
  variant?: LessonCardVariant
  compact?: boolean
  dense?: boolean
  highlighted?: boolean
}

function locationOf(lesson: Lesson): string {
  if (lesson.room) return lesson.room
  if (lesson.place === 'online') return 'онлайн'
  if (lesson.place === 'none') return 'без ауд.'
  return lesson.place ?? ''
}

function groupsOf(lesson: Lesson): string {
  return lesson.audience
    .map((audience) =>
      audience.subgroup ? `${audience.group} п/г ${audience.subgroup}` : audience.group,
    )
    .join(', ')
}

function teachersOf(lesson: Lesson): string {
  return lesson.teachers.length > 0 ? lesson.teachers.join(', ') : '(не указан)'
}

export function LessonCard({
  lesson,
  violated,
  variant = 'teacher',
  compact = false,
  dense = false,
  highlighted = false,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  const style = typeStyle(lesson.lesson_type, { softBg: !violated })
  const badge = parityBadge(lesson.parity)
  const groups = groupsOf(lesson)
  const teachers = teachersOf(lesson)
  const location = locationOf(lesson)

  if (compact && !expanded) {
    const short = variant === 'teacher' ? location : variant === 'group' ? teachers : groups
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={
          'lesson-card lesson-card-compact mb-1 block w-full truncate rounded border px-2 py-1 text-left text-xs ' +
          (violated ? 'border-red-400 bg-red-50' : `${style.border} ${style.bg}`)
        }
        title={`${lesson.discipline}${short ? ` · ${short}` : ''}`}
      >
        {lesson.discipline}
        {short ? ` · ${short}` : ''}
      </button>
    )
  }

  const topRight = location
  const bottomLeft = variant === 'group' ? teachers : groups
  const onClick = compact ? () => setExpanded(false) : undefined
  const toneClass = violated
    ? 'is-violated border-red-500 bg-red-50 ring-1 ring-red-300'
    : highlighted
      ? `is-highlighted ${style.border} ${style.bg} border-slate-200 ring-2 ring-blue-400`
      : `${style.border} ${style.bg} border-y border-r border-slate-200`
  const className = `lesson-card${topRight ? ' lesson-card--has-corner' : ''} mb-1 rounded-md border text-xs leading-snug shadow-sm transition ${toneClass}`

  const contents = (
    <>
      {topRight && <span className="lesson-card__corner">{topRight}</span>}
      <div className="lesson-card__subject">{lesson.discipline}</div>
      <div className="lesson-card__meta">
        <span className="lesson-card__details">{bottomLeft}</span>
        {badge && <span className="lesson-card__parity">{badge} чертой</span>}
      </div>
    </>
  )

  const fullDetails = (
    <div className="lesson-card__full-details" aria-hidden="true">
      <div className="lesson-card__full-title">
        <span>Название предмета</span>
        <strong>{lesson.discipline}</strong>
      </div>
      <div className="lesson-card__full-row">
        <span>Группа(-ы)</span>
        <strong>{groups || 'Не указана'}</strong>
      </div>
      <div className="lesson-card__full-row">
        <span>Преподаватель</span>
        <strong>{teachers}</strong>
      </div>
      <div className="lesson-card__full-row">
        <span>Кабинет</span>
        <strong>{location || 'Не указан'}</strong>
      </div>
      {badge && (
        <div className="lesson-card__full-row">
          <span>Неделя</span>
          <strong>{badge} чертой</strong>
        </div>
      )}
      {lesson.note && (
        <div className="lesson-card__full-row">
          <span>Примечание</span>
          <strong>{lesson.note}</strong>
        </div>
      )}
    </div>
  )

  if (dense) {
    const compactLocation = location || ''
    const accessibilityLabel = [lesson.discipline, compactLocation].filter(Boolean).join('. ')

    return (
      <div
        className={`lesson-card lesson-card--dense-preview is-dense ${toneClass}`}
        tabIndex={0}
        role="group"
        aria-label={accessibilityLabel}
      >
        <div className="lesson-card__dense-summary" aria-hidden="true">
          <span className="lesson-card__dense-subject">{lesson.discipline}</span>
          <strong className="lesson-card__dense-room">{compactLocation}</strong>
        </div>
        <div className={`lesson-card lesson-card__hover-detail ${toneClass}`} aria-hidden="true">
          {fullDetails}
        </div>
      </div>
    )
  }

  return compact ? (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left ${className}`}
      title={lesson.discipline}
    >
      {contents}
    </button>
  ) : (
    <div className={className} title={lesson.discipline}>
      {contents}
      {fullDetails}
    </div>
  )
}
