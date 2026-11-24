import type { MultiWeek } from '../lib/schedule'
import type { ParityTab } from '../lib/parity'
import type { ScheduleOrientation } from '../lib/viewPreferences'
import { MultiGrid } from './MultiGrid'

interface Props {
  week: MultiWeek
  violated: Set<number>
  highlightCommonFree: boolean
  tab: ParityTab
  dense: boolean
  layout: ScheduleOrientation
}

export function RoomGrid({ week, violated, highlightCommonFree, dense, layout, tab }: Props) {
  return (
    <MultiGrid
      week={week}
      violated={violated}
      variant="room"
      highlightFree
      highlightCommonFree={highlightCommonFree}
      dense={dense}
      layout={layout}
      tab={tab}
    />
  )
}
