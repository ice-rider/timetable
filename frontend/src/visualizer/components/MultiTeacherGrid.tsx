import type { MultiWeek } from '../lib/schedule'
import type { ParityTab } from '../lib/parity'
import type { ScheduleOrientation } from '../lib/viewPreferences'
import { MultiGrid } from './MultiGrid'

interface Props {
  week: MultiWeek
  violated: Set<number>
  compact: boolean
  highlightCommonFree: boolean
  tab: ParityTab
  dense: boolean
  layout: ScheduleOrientation
}

export function MultiTeacherGrid({
  week,
  violated,
  compact,
  dense,
  layout,
  highlightCommonFree,
  tab,
}: Props) {
  return (
    <MultiGrid
      week={week}
      violated={violated}
      variant="teacher"
      compact={compact}
      dense={dense}
      layout={layout}
      highlightCommonFree={highlightCommonFree}
      tab={tab}
    />
  )
}
