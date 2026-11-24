interface Props {
  teachers: string[]
  value: string | null
  onChange: (name: string) => void
}

export function TeacherSelect({ teachers, value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Преподаватель:</span>
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value && <option value="">— выберите —</option>}
        {teachers.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  )
}
