import type { ScheduleDensity } from '../lib/viewPreferences'

interface Props {
  value: ScheduleDensity
  onChange: (value: ScheduleDensity) => void
}

export function DensityToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Плотность расписания"
      className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange('wide')}
        aria-pressed={value === 'wide'}
        className={
          'rounded-md px-2.5 py-1 text-xs font-medium transition ' +
          (value === 'wide'
            ? 'bg-white text-blue-700 shadow-sm'
            : 'text-slate-600 hover:text-slate-900')
        }
      >
        Широко
      </button>
      <button
        type="button"
        onClick={() => onChange('compact')}
        aria-pressed={value === 'compact'}
        className={
          'rounded-md px-2.5 py-1 text-xs font-medium transition ' +
          (value === 'compact'
            ? 'bg-white text-blue-700 shadow-sm'
            : 'text-slate-600 hover:text-slate-900')
        }
      >
        Компактно
      </button>
    </div>
  )
}
