import { useMemo } from 'react'
import { PRESET_KEYS } from '../lib/storage'
import { MultiPicker, type PickerOption } from './MultiPicker'

interface Props {
  teachers: string[]
  selected: string[]
  onChange: (next: string[]) => void
}

export function TeacherPicker({ teachers, selected, onChange }: Props) {
  const options = useMemo<PickerOption[]>(
    () => teachers.map((teacher) => ({ value: teacher, label: teacher })),
    [teachers],
  )

  return (
    <MultiPicker
      label="Преподаватели"
      placeholder="Поиск…"
      options={options}
      selected={selected}
      onChange={onChange}
      presetKey={PRESET_KEYS.teachers}
    />
  )
}
