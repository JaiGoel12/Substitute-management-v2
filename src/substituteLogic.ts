import { isCellFree } from './cellNormalize'
import type { SlotKey, Substitution, TeacherGrid } from './types'

/** class name -> teacher for each slot (inverse of teacher grid for that slot). */
export type ClassCentric = Record<SlotKey, Record<string, string>>

/**
 * Class → teacher(s) for each slot. If two teachers share the same class in one period
 * (co-teaching / split), names are merged with " · " in the PDF cell.
 */
export function invertToClassCentric(grid: TeacherGrid): ClassCentric {
  const out: ClassCentric = {}
  for (const [slotKey, byTeacher] of Object.entries(grid.slots)) {
    out[slotKey] = {}
    for (const [teacher, className] of Object.entries(byTeacher)) {
      const c = className.trim()
      if (!c || isCellFree(c)) continue
      const existing = out[slotKey][c]
      if (!existing) {
        out[slotKey][c] = teacher
      } else {
        const parts = existing.split(' · ')
        if (!parts.includes(teacher)) {
          out[slotKey][c] = `${existing} · ${teacher}`
        }
      }
    }
  }
  return out
}

export function makePickKey(slotKey: SlotKey, absentTeacher: string): string {
  return JSON.stringify([slotKey, absentTeacher])
}

export function parsePickKey(key: string): { slotKey: SlotKey; absentTeacher: string } | null {
  try {
    const [slotKey, absentTeacher] = JSON.parse(key) as [string, string]
    if (typeof slotKey !== 'string' || typeof absentTeacher !== 'string') return null
    return { slotKey, absentTeacher }
  } catch {
    return null
  }
}

/**
 * Who can cover this period for `currentAbsent`: free in that slot, not any absent teacher,
 * and not already chosen to cover another absent teacher in the *same* period.
 */
export function substituteOptionsForPeriodSlot(
  grid: TeacherGrid,
  slotKey: SlotKey,
  allAbsentTeachers: string[],
  picks: Record<string, string>,
  currentAbsent: string,
): string[] {
  const row = grid.slots[slotKey]
  if (!row) return []

  const absentSet = new Set(allAbsentTeachers.map((a) => a.trim()))
  const takenSubs = new Set<string>()
  for (const [key, sub] of Object.entries(picks)) {
    const subTrim = sub.trim()
    if (!subTrim) continue
    const parsed = parsePickKey(key)
    if (!parsed) continue
    if (parsed.slotKey !== slotKey) continue
    if (parsed.absentTeacher === currentAbsent.trim()) continue
    takenSubs.add(subTrim)
  }

  return grid.teachers.filter((t) => {
    if (absentSet.has(t)) return false
    if (takenSubs.has(t)) return false
    return isCellFree(row[t] ?? '')
  })
}

/** Every (slot, class) where an absent teacher has a real class — skip Free/blank periods. */
export function collectSubstitutionNeeds(
  grid: TeacherGrid,
  day: string,
  absentTeachersInOrder: string[],
): { slotKey: SlotKey; absentTeacher: string; className: string }[] {
  const periods = periodsForDay(grid, day)
  const out: { slotKey: SlotKey; absentTeacher: string; className: string }[] = []
  const d = day.trim()

  for (const absent of absentTeachersInOrder) {
    for (const period of periods) {
      const slotKey: SlotKey = `${d}|${period.trim()}`
      const row = grid.slots[slotKey]
      if (!row) continue
      const raw = (row[absent] ?? '').trim()
      if (!raw || isCellFree(raw)) continue
      out.push({ slotKey, absentTeacher: absent, className: raw })
    }
  }
  return out
}

export function removePicksForAbsentTeacher(
  picks: Record<string, string>,
  absentTeacher: string,
): Record<string, string> {
  const next = { ...picks }
  for (const k of Object.keys(next)) {
    const p = parsePickKey(k)
    if (p?.absentTeacher === absentTeacher) delete next[k]
  }
  return next
}

export function classesTaughtBy(grid: TeacherGrid, slotKey: SlotKey, teacher: string): string[] {
  const row = grid.slots[slotKey]
  if (!row) return []
  const cls = (row[teacher] ?? '').trim()
  if (!cls || isCellFree(cls)) return []
  return [cls]
}

export function applySubstitutions(
  base: TeacherGrid,
  subs: Substitution[],
): TeacherGrid {
  const next: TeacherGrid = {
    teachers: [...base.teachers],
    slots: JSON.parse(JSON.stringify(base.slots)) as TeacherGrid['slots'],
  }

  for (const s of subs) {
    const row = next.slots[s.slotKey]
    if (!row) continue
    const classes = classesTaughtBy(next, s.slotKey, s.absentTeacher)
    for (const className of classes) {
      row[s.absentTeacher] = ''
      const subCell = (row[s.substituteTeacher] ?? '').trim()
      if (!isCellFree(subCell)) {
        throw new Error(
          `Cannot assign ${s.substituteTeacher} as substitute in ${s.slotKey}: they already teach "${subCell}".`,
        )
      }
      row[s.substituteTeacher] = className
    }
  }

  return next
}

export function uniqueDays(grid: TeacherGrid): string[] {
  const set = new Set<string>()
  for (const key of Object.keys(grid.slots)) {
    const day = key.split('|')[0]
    if (day) set.add(day)
  }
  return [...set].sort()
}

export function periodsForDay(grid: TeacherGrid, day: string): string[] {
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

export function allClassesFromGrid(grid: TeacherGrid): string[] {
  const set = new Set<string>()
  for (const row of Object.values(grid.slots)) {
    for (const cls of Object.values(row)) {
      const c = cls.trim()
      if (c && !isCellFree(c)) set.add(c)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}
