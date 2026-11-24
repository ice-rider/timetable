import { useMemo } from 'react'
import type { Room } from '../api/types'
import { PRESET_KEYS } from '../lib/storage'
import { MultiPicker, type PickerOption } from './MultiPicker'

interface Props {
  rooms: Room[]
  selected: string[]
  onChange: (next: string[]) => void
}

export function RoomPicker({ rooms, selected, onChange }: Props) {
  const options = useMemo<PickerOption[]>(
    () =>
      rooms.map((room) => ({
        value: room.key,
        label: room.key,
        hint: room.title && room.title !== room.key ? room.title : undefined,
      })),
    [rooms],
  )

  return (
    <MultiPicker
      label="Кабинеты"
      placeholder="Поиск…"
      options={options}
      selected={selected}
      onChange={onChange}
      presetKey={PRESET_KEYS.rooms}
    />
  )
}
