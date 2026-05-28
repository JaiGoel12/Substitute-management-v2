import { isCellFree } from './cellNormalize'
import type { SlotKey, TeacherGrid } from './types'

function periodsForDay(grid: TeacherGrid, day: string): string[] {
  const d = day.trim()
  const periods = new Set<string>()
  for (const key of Object.keys(grid.slots)) {
    const [dayPart, periodPart] = key.split('|')
    if (dayPart === d && periodPart) periods.add(periodPart)
  }
  return [...periods].sort((a, b) => {
    const ma = a.match(/^P\s*(\d+)$/i)
    const mb = b.match(/^P\s*(\d+)$/i)
    if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10)
    const na = Number(a)
    const nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
}

/**
 * Teachers who must not be assigned as substitutes in the first N periods of the day
 * (e.g. duty elsewhere even if the timetable cell looks free).
 */
const BLOCKED_AS_SUBSTITUTE_FIRST_PERIODS: { nameMatch: string; periodCount: number }[] = [
  { nameMatch: 'SOURABH', periodCount: 2 },
  { nameMatch: 'RAVINDER', periodCount: 2 },
  { nameMatch: 'NANCY', periodCount: 2 },
]

function periodIndexOnDay(grid: TeacherGrid, day: string, slotKey: SlotKey): number {
  const period = slotKey.split('|')[1]?.trim() ?? ''
  const order = periodsForDay(grid, day)
  const idx = order.indexOf(period)
  return idx >= 0 ? idx : order.length
}

export function teacherNameMatches(teacher: string, nameMatch: string): boolean {
  const normalized = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const t = normalized(teacher)
  const m = normalized(nameMatch)
  if (t === m) return true
  // Avoid "JITENDER" matching a rule meant for "RAVINDER" via substring overlap.
  return t.endsWith(m) || t.startsWith(m) || t.includes(`.${m}`)
}

/** True when this teacher cannot cover as substitute in this period. */
export function isBlockedAsSubstituteInSlot(
  grid: TeacherGrid,
  teacher: string,
  slotKey: SlotKey,
): boolean {
  const day = slotKey.split('|')[0]?.trim() ?? ''
  const idx = periodIndexOnDay(grid, day, slotKey)
  for (const rule of BLOCKED_AS_SUBSTITUTE_FIRST_PERIODS) {
    if (teacherNameMatches(teacher, rule.nameMatch) && idx < rule.periodCount) {
      return true
    }
  }
  return false
}

export function canTeachAsSubstituteInSlot(
  grid: TeacherGrid,
  teacher: string,
  slotKey: SlotKey,
): boolean {
  const row = grid.slots[slotKey]
  if (!row) return false
  if (!isCellFree(row[teacher] ?? '')) return false
  if (isBlockedAsSubstituteInSlot(grid, teacher, slotKey)) return false
  return true
}
