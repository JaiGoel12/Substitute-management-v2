import { isCellFree } from './cellNormalize'
import { sortWeekdayNames } from './scheduleCell'
import {
  canTeachAsSubstituteInSlot,
  isBlockedAsSubstituteInSlot,
  maxSubstitutionsPerDayForTeacher,
} from './substituteAvailability'
import type { SlotKey, Substitution, TeacherGrid } from './types'

export const MAX_SUBSTITUTIONS_PER_TEACHER_PER_DAY = 3

export type UnassignReason = 'no_eligible_teacher' | 'all_at_max_load'

export interface AutoAssignUnassigned {
  slotKey: SlotKey
  absentTeacher: string
  className: string
  reason: UnassignReason
}

export interface AutoAssignResult {
  picks: Record<string, string>
  unassigned: AutoAssignUnassigned[]
  filledKeys: string[]
}

export interface SubstituteSlotOptions {
  existingSubs?: Substitution[]
  day?: string
  maxPerDay?: number
  /** When editing one row, do not count its pick toward the substitute’s daily cap. */
  excludePickKey?: string
}

export function dayFromSlotKey(slotKey: SlotKey): string {
  return slotKey.split('|')[0]?.trim() ?? ''
}

export function picksRecordFromSubs(rows: Substitution[]): Record<string, string> {
  const o: Record<string, string> = {}
  for (const s of rows) {
    o[makePickKey(s.slotKey, s.absentTeacher)] = s.substituteTeacher
  }
  return o
}

export function unassignReasonLabel(reason: UnassignReason): string {
  switch (reason) {
    case 'no_eligible_teacher':
      return 'No free teacher available in this period'
    case 'all_at_max_load':
      return 'All free teachers already at 3 substitutions today'
  }
}

export function teachersAtDailySubstitutionCap(
  subs: Substitution[],
  picks: Record<string, string>,
  day: string,
  teachers: string[],
  max = MAX_SUBSTITUTIONS_PER_TEACHER_PER_DAY,
): string[] {
  return teachers.filter(
    (t) =>
      substitutionCountOnDay(subs, picks, day, t) >=
      maxSubstitutionsPerDayForTeacher(t, max),
  )
}

/** How many substitution periods this teacher covers on `day` (confirmed + in-progress picks). */
export function substitutionCountOnDay(
  subs: Substitution[],
  picks: Record<string, string>,
  day: string,
  teacher: string,
  excludePickKey?: string,
): number {
  const t = teacher.trim()
  const d = day.trim()
  const excludeParsed = excludePickKey ? parsePickKey(excludePickKey) : null
  let n = 0
  for (const s of subs) {
    if (dayFromSlotKey(s.slotKey) !== d) continue
    if (
      excludeParsed &&
      s.slotKey === excludeParsed.slotKey &&
      s.absentTeacher === excludeParsed.absentTeacher
    ) {
      continue
    }
    if (s.substituteTeacher.trim() === t) n++
  }
  for (const [key, sub] of Object.entries(picks)) {
    if (key === excludePickKey) continue
    const subTrim = sub.trim()
    if (!subTrim) continue
    const parsed = parsePickKey(key)
    if (!parsed) continue
    if (dayFromSlotKey(parsed.slotKey) !== d) continue
    if (subTrim === t) n++
  }
  return n
}

function isSubstitutingInSlot(
  subs: Substitution[],
  picks: Record<string, string>,
  slotKey: SlotKey,
  teacher: string,
): boolean {
  const t = teacher.trim()
  for (const s of subs) {
    if (s.slotKey === slotKey && s.substituteTeacher.trim() === t) return true
  }
  for (const [key, sub] of Object.entries(picks)) {
    const subTrim = sub.trim()
    if (!subTrim) continue
    const parsed = parsePickKey(key)
    if (parsed?.slotKey === slotKey && subTrim === t) return true
  }
  return false
}

/** Remaining free periods on `day` after simulated sub assignments (base grid + picks). */
export function freePeriodCountOnDay(
  grid: TeacherGrid,
  day: string,
  teacher: string,
  subs: Substitution[],
  picks: Record<string, string>,
): number {
  const t = teacher.trim()
  const d = day.trim()
  let count = 0
  for (const period of periodsForDay(grid, d)) {
    const slotKey: SlotKey = `${d}|${period}`
    const row = grid.slots[slotKey]
    if (!row) continue
    if (!isCellFree(row[t] ?? '')) continue
    if (isBlockedAsSubstituteInSlot(grid, t, slotKey)) continue
    if (isSubstitutingInSlot(subs, picks, slotKey, t)) continue
    count++
  }
  return count
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
  opts?: SubstituteSlotOptions,
): string[] {
  const row = grid.slots[slotKey]
  if (!row) return []

  const existingSubs = opts?.existingSubs ?? []
  const mergedPicks = { ...picksRecordFromSubs(existingSubs), ...picks }

  const absentSet = new Set(allAbsentTeachers.map((a) => a.trim()))
  const takenSubs = new Set<string>()
  for (const [key, sub] of Object.entries(mergedPicks)) {
    const subTrim = sub.trim()
    if (!subTrim) continue
    const parsed = parsePickKey(key)
    if (!parsed) continue
    if (parsed.slotKey !== slotKey) continue
    if (parsed.absentTeacher === currentAbsent.trim()) continue
    takenSubs.add(subTrim)
  }

  let result = grid.teachers.filter((t) => {
    if (absentSet.has(t)) return false
    if (takenSubs.has(t)) return false
    return canTeachAsSubstituteInSlot(grid, t, slotKey)
  })

  if (opts?.maxPerDay != null && opts.day) {
    const max = opts.maxPerDay
    const day = opts.day
    result = result.filter(
      (t) =>
        substitutionCountOnDay(existingSubs, picks, day, t, opts.excludePickKey) <
        maxSubstitutionsPerDayForTeacher(t, max),
    )
  }

  return result
}

export function eligibleSubstitutesForNeed(
  grid: TeacherGrid,
  slotKey: SlotKey,
  allAbsentTeachers: string[],
  existingSubs: Substitution[],
  picks: Record<string, string>,
  day: string,
  currentAbsent: string,
): string[] {
  return substituteOptionsForPeriodSlot(
    grid,
    slotKey,
    allAbsentTeachers,
    picks,
    currentAbsent,
    {
      existingSubs,
      day,
      maxPerDay: MAX_SUBSTITUTIONS_PER_TEACHER_PER_DAY,
      excludePickKey: makePickKey(slotKey, currentAbsent),
    },
  )
}

function periodIndexOnDay(grid: TeacherGrid, day: string, slotKey: SlotKey): number {
  const period = slotKey.split('|')[1]?.trim() ?? ''
  const order = periodsForDay(grid, day)
  const idx = order.indexOf(period)
  return idx >= 0 ? idx : order.length
}

function sortNeedsScarcityFirst(
  grid: TeacherGrid,
  day: string,
  needs: { slotKey: SlotKey; absentTeacher: string; className: string }[],
  orderedAbsent: string[],
  existingSubs: Substitution[],
  picks: Record<string, string>,
): typeof needs {
  return [...needs].sort((a, b) => {
    const optsA = eligibleSubstitutesForNeed(
      grid,
      a.slotKey,
      orderedAbsent,
      existingSubs,
      picks,
      day,
      a.absentTeacher,
    ).length
    const optsB = eligibleSubstitutesForNeed(
      grid,
      b.slotKey,
      orderedAbsent,
      existingSubs,
      picks,
      day,
      b.absentTeacher,
    ).length
    if (optsA !== optsB) return optsA - optsB
    const pa = periodIndexOnDay(grid, day, a.slotKey)
    const pb = periodIndexOnDay(grid, day, b.slotKey)
    if (pa !== pb) return pa - pb
    const ia = orderedAbsent.indexOf(a.absentTeacher)
    const ib = orderedAbsent.indexOf(b.absentTeacher)
    return ia - ib
  })
}

function rankSubstituteCandidates(
  grid: TeacherGrid,
  day: string,
  candidates: string[],
  existingSubs: Substitution[],
  picks: Record<string, string>,
): string[] {
  return [...candidates].sort((x, y) => {
    const fx = freePeriodCountOnDay(grid, day, x, existingSubs, picks)
    const fy = freePeriodCountOnDay(grid, day, y, existingSubs, picks)
    if (fy !== fx) return fy - fx
    const cx = substitutionCountOnDay(existingSubs, picks, day, x)
    const cy = substitutionCountOnDay(existingSubs, picks, day, y)
    if (cx !== cy) return cx - cy
    return x.localeCompare(y)
  })
}

/** Rule-based auto-assign: scarcity-first, prefer most free periods, max 3 subs/teacher/day. */
export function autoAssignSubstitutions(
  grid: TeacherGrid,
  day: string,
  orderedAbsent: string[],
  existingSubs: Substitution[],
): AutoAssignResult {
  const picks: Record<string, string> = {}
  const unassigned: AutoAssignUnassigned[] = []
  const filledKeys: string[] = []

  const needs = collectSubstitutionNeeds(grid, day, orderedAbsent)
  const sorted = sortNeedsScarcityFirst(grid, day, needs, orderedAbsent, existingSubs, picks)

  for (const need of sorted) {
    const eligible = eligibleSubstitutesForNeed(
      grid,
      need.slotKey,
      orderedAbsent,
      existingSubs,
      picks,
      day,
      need.absentTeacher,
    )

    if (eligible.length === 0) {
      const freeOnly = substituteOptionsForPeriodSlot(
        grid,
        need.slotKey,
        orderedAbsent,
        picks,
        need.absentTeacher,
        { existingSubs },
      )
      unassigned.push({
        ...need,
        reason: freeOnly.length === 0 ? 'no_eligible_teacher' : 'all_at_max_load',
      })
      continue
    }

    const ranked = rankSubstituteCandidates(grid, day, eligible, existingSubs, picks)
    const chosen = ranked[0]
    const key = makePickKey(need.slotKey, need.absentTeacher)
    picks[key] = chosen
    filledKeys.push(key)
  }

  return { picks, unassigned, filledKeys }
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
      if (!s.substituteTeacher.trim()) {
        continue
      }
      const subCell = (row[s.substituteTeacher] ?? '').trim()
      if (!isCellFree(subCell)) {
        throw new Error(
          `Cannot assign ${s.substituteTeacher} as substitute in ${s.slotKey}: they already teach "${subCell}".`,
        )
      }
      if (isBlockedAsSubstituteInSlot(next, s.substituteTeacher, s.slotKey)) {
        throw new Error(
          `Cannot assign ${s.substituteTeacher} as substitute in ${s.slotKey}: not available in this period.`,
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
  return sortWeekdayNames([...set])
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
