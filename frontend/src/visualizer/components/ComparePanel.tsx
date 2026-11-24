import { useMemo, useState } from 'react'
import type { MergedModel } from '../api/types'
import { dayLong, parityLabel } from '../lib/labels'
import {
  findCommonFreeSlotsMixed,
  groupWeek,
  roomWeek,
  teacherWeek,
  type EntityKind,
  type EntityRef,
  type EntityWeek,
  type ParityTab,
} from '../lib/schedule'
import type { ScheduleOrientation } from '../lib/viewPreferences'
import type { LessonCardVariant } from './LessonCard'
import { ScheduleGrid } from './ScheduleGrid'

interface Props {
  model: MergedModel
  tab: ParityTab
  dense: boolean
  layout: ScheduleOrientation
}

interface SideSelection extends EntityRef {
  name: string
}

const KIND_LABEL: Record<EntityKind, string> = {
  teacher: 'Преподаватель',
  group: 'Группа',
  room: 'Кабинет',
}

const KIND_VARIANT: Record<EntityKind, LessonCardVariant> = {
  teacher: 'teacher',
  group: 'group',
  room: 'room',
}

function weekFor(ref: EntityRef, model: MergedModel, tab: ParityTab): EntityWeek {
  switch (ref.kind) {
    case 'teacher':
      return teacherWeek(model, ref.name, tab)
    case 'group':
      return groupWeek(model, ref.name, tab)
    case 'room':
      return roomWeek(model, ref.name, tab)
  }
}

interface SidePickerProps {
  label: string
  model: MergedModel
  value: SideSelection
  onChange: (selection: SideSelection) => void
}

function SidePicker({ label, model, value, onChange }: SidePickerProps) {
  const entities =
    value.kind === 'teacher'
      ? model.teachers
      : value.kind === 'group'
        ? model.groups
        : model.rooms.map((room) => room.key)

  return (
    <div className="compare-picker-card rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 text-sm font-medium">{label}</div>
      <div className="mb-2 flex flex-wrap gap-1">
        {(Object.keys(KIND_LABEL) as EntityKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onChange({ kind, name: '' })}
            className={
              'rounded px-2 py-1 text-xs ' +
              (value.kind === kind
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
            }
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>
      <select
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
      >
        <option value="">— выберите —</option>
        {entities.map((entity) => (
          <option key={entity} value={entity}>
            {entity}
          </option>
        ))}
      </select>
    </div>
  )
}

export function ComparePanel({ model, tab, dense, layout }: Props) {
  const [left, setLeft] = useState<SideSelection>({ kind: 'teacher', name: '' })
  const [right, setRight] = useState<SideSelection>({ kind: 'teacher', name: '' })

  const both = left.name !== '' && right.name !== ''
  const refs = useMemo(
    () => [left, right].filter((selection): selection is EntityRef => selection.name !== ''),
    [left, right],
  )
  const slots = useMemo(
    () => (both ? findCommonFreeSlotsMixed(refs, model, tab) : []),
    [both, refs, model, tab],
  )
  const highlightSet = useMemo(() => {
    const result = new Set<string>()
    for (const slot of slots) {
      result.add(`${slot.day}-${slot.period}-${slot.parity}`)
    }
    return result
  }, [slots])
  const leftWeek = useMemo(
    () => (both ? weekFor(left, model, tab) : null),
    [both, left, model, tab],
  )
  const rightWeek = useMemo(
    () => (both ? weekFor(right, model, tab) : null),
    [both, right, model, tab],
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <SidePicker label="Слева:" model={model} value={left} onChange={setLeft} />
        <SidePicker label="Справа:" model={model} value={right} onChange={setRight} />
      </div>

      {!both && (
        <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Выберите по одной сущности с каждой стороны.
        </p>
      )}

      {both && leftWeek && rightWeek && (
        <>
          <div className="compare-schedules grid gap-4 lg:grid-cols-2">
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-700">
                {KIND_LABEL[left.kind]}: <span className="font-normal">{left.name}</span>
              </h3>
              <ScheduleGrid
                week={leftWeek}
                violated={model.violatedLessons}
                variant={KIND_VARIANT[left.kind]}
                tab={tab}
                highlightFree={highlightSet}
                showGaps={false}
                dense={dense}
                layout={layout}
              />
            </section>
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-700">
                {KIND_LABEL[right.kind]}: <span className="font-normal">{right.name}</span>
              </h3>
              <ScheduleGrid
                week={rightWeek}
                violated={model.violatedLessons}
                variant={KIND_VARIANT[right.kind]}
                tab={tab}
                highlightFree={highlightSet}
                showGaps={false}
                dense={dense}
                layout={layout}
              />
            </section>
          </div>

          <section>
            <h3 className="mb-2 text-base font-semibold">Общие окна</h3>
            {slots.length === 0 ? (
              <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
                Общих свободных слотов в выбранном режиме нет.
              </p>
            ) : (
              <div className="compare-results overflow-x-auto rounded border border-slate-200 bg-white">
                <table className="compare-results-table w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border border-slate-200 bg-slate-100 p-2 text-left">День</th>
                      <th className="border border-slate-200 bg-slate-100 p-2 text-left">Пара</th>
                      <th className="border border-slate-200 bg-slate-100 p-2 text-left">
                        Чётность
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((slot, index) => (
                      <tr key={`${slot.day}-${slot.period}-${slot.parity}-${index}`}>
                        <td className="border border-slate-200 p-2">{dayLong[slot.day]}</td>
                        <td className="border border-slate-200 p-2">{slot.period}</td>
                        <td className="border border-slate-200 p-2">{parityLabel(slot.parity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
