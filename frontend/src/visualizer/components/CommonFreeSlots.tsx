import { useMemo } from 'react'
import type { MergedModel } from '../api/types'
import { dayLong, parityLabel } from '../lib/labels'
import { findCommonFreeSlotsMixed, type EntityRef, type ParityTab } from '../lib/schedule'

interface Props {
  open: boolean
  onClose: () => void
  refs: EntityRef[]
  model: MergedModel
  tab: ParityTab
}

export function CommonFreeSlots({ open, onClose, refs, model, tab }: Props) {
  const slots = useMemo(
    () => (open ? findCommonFreeSlotsMixed(refs, model, tab) : []),
    [open, refs, model, tab],
  )

  if (!open) return null

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="common-free-title"
        className="w-full max-w-3xl rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 id="common-free-title" className="text-lg font-semibold">
            Общие окна
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>

        <div className="p-4">
          {refs.length === 0 && (
            <p className="text-sm text-slate-600">Выберите хотя бы одну сущность.</p>
          )}

          {refs.length > 0 && slots.length === 0 && (
            <p className="text-sm text-slate-600">В выбранном режиме общих свободных слотов нет.</p>
          )}

          {slots.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-slate-200 bg-slate-100 p-2 text-left">День</th>
                  <th className="border border-slate-200 bg-slate-100 p-2 text-left">Пара</th>
                  <th className="border border-slate-200 bg-slate-100 p-2 text-left">Чётность</th>
                  <th className="border border-slate-200 bg-slate-100 p-2 text-left">Свободны</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot, index) => (
                  <tr key={`${slot.day}-${slot.period}-${slot.parity}-${index}`}>
                    <td className="border border-slate-200 p-2">{dayLong[slot.day]}</td>
                    <td className="border border-slate-200 p-2">{slot.period}</td>
                    <td className="border border-slate-200 p-2">{parityLabel(slot.parity)}</td>
                    <td className="border border-slate-200 p-2">{slot.entities.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
