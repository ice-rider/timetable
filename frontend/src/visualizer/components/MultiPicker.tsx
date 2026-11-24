import { useEffect, useMemo, useRef, useState } from 'react'
import { deletePreset, listPresets, savePreset, type Preset } from '../lib/storage'

export interface PickerOption {
  value: string
  label: string
  hint?: string
}

interface Props {
  label: string
  placeholder: string
  options: PickerOption[]
  selected: string[]
  onChange: (next: string[]) => void
  presetKey: string
  emptyText?: string
}

export function MultiPicker({
  label,
  placeholder,
  options,
  selected,
  onChange,
  presetKey,
  emptyText = 'Ничего не найдено',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState<Preset<string[]>[]>(() => listPresets(presetKey))
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return

    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const byValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return options.filter((option) => {
      if (selected.includes(option.value)) return false
      if (!normalizedQuery) return true
      return (
        option.label.toLowerCase().includes(normalizedQuery) ||
        (option.hint ?? '').toLowerCase().includes(normalizedQuery) ||
        option.value.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [options, selected, query])

  function remove(value: string) {
    onChange(selected.filter((item) => item !== value))
  }

  function add(value: string) {
    if (!selected.includes(value)) onChange([...selected, value])
  }

  function refresh() {
    setPresets(listPresets<string[]>(presetKey))
  }

  return (
    <div ref={rootRef} className="multi-picker relative">
      <div
        onClick={() => {
          if (!open) setQuery('')
          setOpen(true)
          inputRef.current?.focus()
        }}
        className={
          'multi-picker-input flex min-h-[2.25rem] w-full max-w-md cursor-text flex-wrap items-center gap-1 rounded border bg-white px-2 py-1 text-sm ' +
          (open ? 'border-blue-500 ring-1 ring-blue-200' : 'border-slate-300')
        }
      >
        {selected.length === 0 && <span className="text-slate-400">{label}: выберите…</span>}
        {selected.map((value) => (
          <span
            key={value}
            className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs"
          >
            <span className="truncate">{byValue.get(value)?.label ?? value}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                remove(value)
              }}
              className="shrink-0 rounded-full px-0.5 text-slate-500 hover:bg-slate-300 hover:text-slate-900"
              aria-label={`Убрать ${value}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (!open) setQuery('')
            setOpen(true)
          }}
          className="min-w-[6rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none"
          placeholder={selected.length === 0 ? '' : placeholder}
        />
      </div>

      {open && (
        <div className="multi-picker-menu absolute z-40 mt-1 w-full max-w-md rounded border border-slate-300 bg-white shadow-lg">
          <div className="max-h-64 overflow-auto p-1">
            {filtered.length === 0 && <div className="p-2 text-sm text-slate-500">{emptyText}</div>}
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => add(option.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium">{option.label}</span>
                {option.hint && option.hint !== option.label && (
                  <span className="truncate text-xs text-slate-500">{option.hint}</span>
                )}
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-slate-200 p-2">
            <div className="flex gap-1">
              <input
                placeholder="Имя пресета"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (!presetName.trim() || selected.length === 0) return
                  savePreset(presetKey, presetName.trim(), selected)
                  setPresetName('')
                  refresh()
                }}
                disabled={!presetName.trim() || selected.length === 0}
                className="shrink-0 rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:bg-slate-300"
              >
                Сохранить
              </button>
            </div>

            {presets.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Пресеты</div>
                {presets.map((preset) => (
                  <div key={preset.name} className="flex items-center gap-1 text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        onChange(preset.value)
                        setOpen(false)
                        setQuery('')
                      }}
                      className="flex-1 truncate rounded border border-slate-200 px-2 py-1 text-left hover:bg-slate-50"
                    >
                      {preset.name}{' '}
                      <span className="text-xs text-slate-500">({preset.value.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deletePreset(presetKey, preset.name)
                        refresh()
                      }}
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                      aria-label={`Удалить пресет ${preset.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
