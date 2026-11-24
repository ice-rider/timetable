import type { ScheduleOrientation } from '../lib/viewPreferences'

interface Props {
  value: ScheduleOrientation
  onChange: (value: ScheduleOrientation) => void
}

const OPTIONS: { value: ScheduleOrientation; label: string }[] = [
  { value: 'horizontal', label: 'Горизонтально' },
  { value: 'vertical', label: 'Вертикально' },
]

export function OrientationToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Ориентация расписания"
      className="orientation-toggle inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
