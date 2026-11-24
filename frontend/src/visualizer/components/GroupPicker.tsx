interface Props {
  groups: string[]
  value: string | null
  onChange: (name: string) => void
}

export function GroupPicker({ groups, value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Группа:</span>
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {!value && <option value="">— выберите —</option>}
        {groups.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>
    </label>
  )
}
