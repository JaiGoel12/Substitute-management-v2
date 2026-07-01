/** 1 = Monday … 6 = Saturday (matches the substitute file). */
export const WEEKDAY_NUMBERS = [1, 2, 3, 4, 5, 6] as const

export const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}

export const WEEKDAY_NAME_TO_NUMBER: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
}

export interface ScheduleCellSegment {
  className: string
  /** null = every weekday; otherwise only these day numbers (1–6). */
  dayNums: number[] | null
}

/** Parse `(1-2)`, `(1,3)`, `(5,6)` into day numbers 1–6. */
export function parseDayNumberSpec(spec: string): number[] {
  const nums = new Set<number>()
  for (const part of spec.split(',')) {
    const chunk = part.trim()
    if (!chunk) continue
    if (chunk.includes('-')) {
      const [aRaw, bRaw] = chunk.split('-')
      const a = parseInt(aRaw.trim(), 10)
      const b = parseInt(bRaw.trim(), 10)
      if (Number.isNaN(a) || Number.isNaN(b)) continue
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      for (let d = lo; d <= hi; d++) {
        if (d >= 1 && d <= 6) nums.add(d)
      }
    } else {
      const d = parseInt(chunk, 10)
      if (!Number.isNaN(d) && d >= 1 && d <= 6) nums.add(d)
    }
  }
  return [...nums].sort((a, b) => a - b)
}

/**
 * Split a cell into class + weekday rules.
 * Examples: `11TH SCI B(1-2)`, `11 SCI C(5,6)`, two classes in one cell.
 */
export function parseScheduleCell(raw: string): ScheduleCellSegment[] {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!trimmed || /^free$/i.test(trimmed)) return []

  const re = /([^(]+?)\s*\(\s*(\d+(?:\s*[-,]\s*\d+)*)\s*\)/gi
  const segments: ScheduleCellSegment[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    const className = m[1].trim()
    const dayNums = parseDayNumberSpec(m[2])
    if (!className || dayNums.length === 0) continue
    segments.push({ className, dayNums })
  }

  if (segments.length > 0) return segments

  return [{ className: trimmed, dayNums: null }]
}

/** For each weekday 1–6, the class taught that day (empty = free). */
export function expandCellByWeekday(raw: string): Record<number, string> {
  const out: Record<number, string> = {}
  for (const d of WEEKDAY_NUMBERS) out[d] = ''

  for (const seg of parseScheduleCell(raw)) {
    if (seg.dayNums === null) {
      for (const d of WEEKDAY_NUMBERS) out[d] = seg.className
    } else {
      for (const d of seg.dayNums) {
        if (d >= 1 && d <= 6) out[d] = seg.className
      }
    }
  }
  return out
}

export function weekdayNumberFromName(day: string): number | null {
  const key = day.trim().toLowerCase()
  return WEEKDAY_NAME_TO_NUMBER[key] ?? null
}

/** Today's weekday name (Monday–Saturday), or null on Sunday. */
export function todaysWeekdayName(now: Date = new Date()): string | null {
  // JS getDay(): 0 = Sunday, 1 = Monday, … 6 = Saturday.
  const jsDay = now.getDay()
  if (jsDay === 0) return null
  return WEEKDAY_NAMES[jsDay] ?? null
}

export function sortWeekdayNames(days: string[]): string[] {
  const rank = (name: string): number => {
    const n = weekdayNumberFromName(name)
    return n ?? 99
  }
  return [...days].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
}
