import { useMemo, useState } from 'react'
import type { Lesson, MergedModel, Violation } from '../api/types'
import {
  findGapsWithParity,
  groupWeek,
  roomWeek,
  teacherWeek,
  type EntityWeek,
  type HalfGap,
} from '../lib/schedule'
import {
  dayLong,
  lessonTypeLabel,
  parityBadge,
  parityLabel,
  pluralPairs,
  typeStyle,
} from '../lib/labels'

interface Props {
  model: MergedModel
  onOpenTeacher: (name: string) => void
  onOpenGroup: (name: string) => void
  onOpenRoom: (key: string) => void
}

type Tab = 'violations' | 'gaps'
type GapKind = 'group' | 'teacher' | 'room'

const KIND_LABEL: Record<GapKind, string> = {
  group: 'Группы',
  teacher: 'Преподаватели',
  room: 'Кабинеты',
}

function ViolationLessonCard({ lesson }: { lesson: Lesson }) {
  const style = typeStyle(lesson.lesson_type)
  const groups = lesson.audience
    .map((audience) =>
      audience.subgroup ? `${audience.group} п/г ${audience.subgroup}` : audience.group,
    )
    .join(', ')
  const location = lesson.room
    ? `ауд. ${lesson.room}`
    : lesson.place === 'online'
      ? 'онлайн'
      : (lesson.place ?? '—')

  return (
    <div
      className={`rounded border-l-4 border-y border-r border-slate-200 p-2 text-xs ${style.border} ${style.bg}`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
          {lessonTypeLabel(lesson.lesson_type)}
        </span>
        {lesson.parity !== 'every' && (
          <span className="rounded bg-white/70 px-1 text-[9px] text-slate-700">
            {parityBadge(lesson.parity)} чертой
          </span>
        )}
      </div>
      <div className="mt-0.5 font-medium text-slate-900">{lesson.discipline}</div>
      <dl className="mt-1 space-y-0.5 text-[10px]">
        <div className="flex gap-1">
          <dt className="text-slate-500">Препод.:</dt>
          <dd className="flex-1 text-slate-800">{lesson.teachers.join(', ') || '—'}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-slate-500">Группы:</dt>
          <dd className="flex-1 text-slate-800">{groups || '—'}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-slate-500">Место:</dt>
          <dd className="flex-1 text-slate-800">{location}</dd>
        </div>
      </dl>
    </div>
  )
}

interface ViolationItemProps {
  violation: Violation
  byId: Map<number, Lesson>
  onOpenTeacher: (name: string) => void
  onOpenGroup: (name: string) => void
  onOpenRoom: (key: string) => void
}

function ViolationItem({
  violation,
  byId,
  onOpenTeacher,
  onOpenGroup,
  onOpenRoom,
}: ViolationItemProps) {
  const [open, setOpen] = useState(false)
  const lessons = violation.lesson_ids
    .map((id) => byId.get(id))
    .filter((lesson): lesson is Lesson => lesson !== undefined)

  const slot = violation.day
    ? `${dayLong[violation.day]}${violation.period ? `, ${violation.period} пара` : ''}`
    : ''

  function openResource() {
    if (!violation.resource) return
    if (violation.resource.kind === 'teacher') onOpenTeacher(violation.resource.name)
    else if (violation.resource.kind === 'group') onOpenGroup(violation.resource.name)
    else onOpenRoom(violation.resource.name)
  }

  return (
    <li className="violation-item border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="violation-item-trigger flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
      >
        <span className="w-3 shrink-0 text-slate-400">{open ? '▼' : '▶'}</span>
        {violation.resource && (
          <span className="shrink-0 font-medium text-slate-800">{violation.resource.name}</span>
        )}
        <span className="flex-1 truncate text-slate-600">{violation.message}</span>
        {slot && <span className="ml-auto shrink-0 text-xs text-slate-500">{slot}</span>}
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-3 text-xs text-slate-600">
            {violation.resource && (
              <span>
                Ресурс:{' '}
                <button
                  type="button"
                  onClick={openResource}
                  className="text-blue-600 hover:underline"
                >
                  {violation.resource.name}
                </button>
              </span>
            )}
            {slot && (
              <span>
                Слот: <b className="text-slate-800">{slot}</b>
              </span>
            )}
            <span>Участников: {lessons.length}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {lessons.map((lesson) => (
              <ViolationLessonCard key={lesson.id} lesson={lesson} />
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

interface EntityGaps {
  name: string
  gaps: HalfGap[]
  totalLength: number
  maxLength: number
}

interface GapsSectionProps {
  model: MergedModel
  kind: GapKind
  onOpen: (name: string) => void
}

function weekForGaps(model: MergedModel, kind: GapKind, name: string): EntityWeek {
  switch (kind) {
    case 'teacher':
      return teacherWeek(model, name, 'combine')
    case 'group':
      return groupWeek(model, name, 'combine')
    case 'room':
      return roomWeek(model, name, 'combine')
  }
}

function GapsSection({ model, kind, onOpen }: GapsSectionProps) {
  const [showAll, setShowAll] = useState(false)

  const entities = useMemo(() => {
    const names =
      kind === 'teacher'
        ? model.teachers
        : kind === 'group'
          ? model.groups
          : model.rooms.map((room) => room.key)

    const list: EntityGaps[] = []
    for (const name of names) {
      const gaps = findGapsWithParity(weekForGaps(model, kind, name)).sort(
        (a, b) => b.length - a.length || a.day.localeCompare(b.day),
      )
      if (gaps.length === 0) continue
      list.push({
        name,
        gaps,
        totalLength: gaps.reduce((sum, gap) => sum + gap.length, 0),
        maxLength: Math.max(...gaps.map((gap) => gap.length)),
      })
    }
    list.sort(
      (a, b) =>
        b.totalLength - a.totalLength ||
        b.maxLength - a.maxLength ||
        a.name.localeCompare(b.name, 'ru'),
    )
    return list
  }, [model, kind])

  if (entities.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Окон не найдено.
      </p>
    )
  }

  const visible = showAll ? entities : entities.slice(0, 15)

  return (
    <div className="space-y-2">
      {visible.map((entity) => (
        <div key={entity.name} className="rounded border border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-100 px-3 py-2">
            <button
              type="button"
              onClick={() => onOpen(entity.name)}
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              {entity.name}
            </button>
            <span className="text-xs text-slate-500">
              {entity.gaps.length} окон · суммарно {entity.totalLength}{' '}
              {pluralPairs(entity.totalLength)} · макс {entity.maxLength}{' '}
              {pluralPairs(entity.maxLength)}
            </span>
          </div>
          <ul className="grid gap-1 px-3 py-2 text-xs text-slate-700 md:grid-cols-2 lg:grid-cols-3">
            {entity.gaps.map((gap, index) => (
              <li
                key={`${gap.day}-${gap.startPeriod}-${gap.parity}-${index}`}
                className="rounded bg-amber-50 px-1.5 py-0.5 ring-1 ring-amber-200"
              >
                {dayLong[gap.day]}, {gap.startPeriod}
                {gap.endPeriod !== gap.startPeriod ? `–${gap.endPeriod}` : ''} пара ·{' '}
                <b>
                  {gap.length} {pluralPairs(gap.length)}
                </b>{' '}
                · {parityLabel(gap.parity)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {entities.length > 15 && (
        <button
          type="button"
          onClick={() => setShowAll((show) => !show)}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
        >
          {showAll ? 'Свернуть' : `Показать все (${entities.length})`}
        </button>
      )}
    </div>
  )
}

export function ViolationsPage({ model, onOpenTeacher, onOpenGroup, onOpenRoom }: Props) {
  const [tab, setTab] = useState<Tab>('violations')
  const [gapKind, setGapKind] = useState<GapKind>('group')

  const byId = useMemo(() => {
    const map = new Map<number, Lesson>()
    for (const lesson of model.lessons) map.set(lesson.id, lesson)
    return map
  }, [model.lessons])

  const groupedViolations = useMemo(() => {
    const map = new Map<string, { rule: string; title: string; items: Violation[] }>()
    for (const violation of model.violations) {
      const key = `${violation.rule}|${violation.title}`
      const entry = map.get(key)
      if (entry) entry.items.push(violation)
      else {
        map.set(key, {
          rule: violation.rule,
          title: violation.title,
          items: [violation],
        })
      }
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length)
  }, [model.violations])

  return (
    <div className="space-y-4">
      <div className="issues-tabs no-print flex flex-wrap gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab('violations')}
          className={
            'rounded-t px-4 py-1.5 text-sm ' +
            (tab === 'violations'
              ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:bg-white/60')
          }
        >
          Накладки ({model.violations.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('gaps')}
          className={
            'rounded-t px-4 py-1.5 text-sm ' +
            (tab === 'gaps'
              ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200'
              : 'text-slate-600 hover:bg-white/60')
          }
        >
          Окна
        </button>
      </div>

      {tab === 'violations' && (
        <>
          {groupedViolations.length === 0 ? (
            <p className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              Накладок нет.
            </p>
          ) : (
            <div className="space-y-4">
              {groupedViolations.map((group) => (
                <section className="violation-group" key={group.rule + group.title}>
                  <h3 className="mb-1.5 flex items-baseline gap-2 text-sm font-semibold text-slate-800">
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold">
                      {group.rule}
                    </span>
                    {group.title}
                    <span className="text-xs text-slate-500">({group.items.length})</span>
                  </h3>
                  <ul className="violation-list rounded border border-slate-200 bg-white">
                    {group.items.map((violation, index) => (
                      <ViolationItem
                        key={`${violation.rule}-${violation.lesson_ids.join('-')}-${index}`}
                        violation={violation}
                        byId={byId}
                        onOpenTeacher={onOpenTeacher}
                        onOpenGroup={onOpenGroup}
                        onOpenRoom={onOpenRoom}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'gaps' && (
        <div className="space-y-3">
          <div className="issues-tabs no-print flex flex-wrap gap-1">
            {(['group', 'teacher', 'room'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setGapKind(kind)}
                className={
                  'rounded px-3 py-1 text-sm ' +
                  (gapKind === kind
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                }
              >
                {KIND_LABEL[kind]}
              </button>
            ))}
          </div>
          <GapsSection
            model={model}
            kind={gapKind}
            onOpen={(name) => {
              if (gapKind === 'teacher') onOpenTeacher(name)
              else if (gapKind === 'group') onOpenGroup(name)
              else onOpenRoom(name)
            }}
          />
        </div>
      )}
    </div>
  )
}
