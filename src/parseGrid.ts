import * as XLSX from 'xlsx'
import type { SlotKey, TeacherGrid } from './types'
import { normalizeScheduleCell } from './cellNormalize'

const SINGLE_DAY_LABEL = 'Timetable'

function normDay(s: string): string {
  return s.trim()
}

function normPeriod(s: string | number): string {
  if (typeof s === 'number') return String(s)
  return String(s).trim()
}

function makeSlotKey(day: string, period: string): SlotKey {
  return `${normDay(day)}|${normPeriod(period)}`
}

function periodSortKey(name: string): number {
  const m = name.match(/P\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : 0
}

function normalizePeriodColumnHeader(h: string): string {
  return h.replace(/\s+/g, '').replace(/^period/i, 'P')
}

type RowMatrix = (string | number)[][]

function rowStrings(row: (string | number)[] | undefined): string[] {
  if (!row) return []
  return row.map((c) => String(c ?? '').trim())
}

/** P1, P 2, P.3, PERIOD 4 */
function isPeriodColumnHeader(h: string): boolean {
  if (!h) return false
  if (/^P[\s.]*\d+$/i.test(h)) return true
  if (/^period\s*\d+$/i.test(h)) return true
  return false
}

/** First column often "Teacher" or "TEACHER NAME" */
function isTeacherColumnHeader(h: string): boolean {
  return /^teachers?(\s+name)?$/i.test(h) || /^teacher$/i.test(h)
}

/** Scan first rows for a header line with Teacher + at least one P column. */
function findTeacherPeriodHeaderRow(rows: RowMatrix): number {
  const max = Math.min(50, rows.length)
  for (let r = 0; r < max; r++) {
    const h = rowStrings(rows[r])
    const teacherIdx = h.findIndex((cell) => isTeacherColumnHeader(cell))
    const hasP = h.some((cell) => isPeriodColumnHeader(cell))
    if (teacherIdx >= 0 && hasP) return r
  }
  return -1
}

function findDayPeriodHeaderRow(rows: RowMatrix): number {
  const max = Math.min(50, rows.length)
  for (let r = 0; r < max; r++) {
    const h = rowStrings(rows[r])
    const hasDay = h.some((cell) => /^day$/i.test(cell))
    const hasPeriod = h.some((cell) => /^period$/i.test(cell))
    if (hasDay && hasPeriod) return r
  }
  return -1
}

/**
 * Long format: `Day`, `Period`, then one column per teacher (cells = class or empty).
 * Header must be row 0 of `rows` (caller slices from workbook).
 */
function parseLongFormat(rows: RowMatrix): TeacherGrid {
  const header = rowStrings(rows[0])
  const dayIdx = header.findIndex((h) => /^day$/i.test(h))
  const periodIdx = header.findIndex((h) => /^period$/i.test(h))
  if (dayIdx === -1 || periodIdx === -1) {
    throw new Error('Missing Day or Period columns.')
  }

  const teachers = header
    .map((h, i) => (i !== dayIdx && i !== periodIdx ? h : ''))
    .filter(Boolean)

  if (teachers.length === 0) {
    throw new Error('No teacher columns found after Day and Period.')
  }

  const slots: Record<SlotKey, Record<string, string>> = {}

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length === 0) continue
    const dayRaw = row[dayIdx]
    const periodRaw = row[periodIdx]
    if (dayRaw === '' || dayRaw === undefined || periodRaw === '' || periodRaw === undefined) {
      continue
    }
    const day = normDay(String(dayRaw))
    const period = normPeriod(periodRaw)
    const key = makeSlotKey(day, period)
    if (!slots[key]) slots[key] = {}
    for (const t of teachers) {
      const colIndex = header.indexOf(t)
      if (colIndex === -1) continue
      const cell = row[colIndex]
      const val = normalizeScheduleCell(String(cell ?? ''))
      slots[key][t] = val
    }
  }

  if (Object.keys(slots).length === 0) {
    throw new Error('No data rows found under the header.')
  }

  return { teachers, slots }
}

/**
 * Teacher column + P1…Pn columns, one row per teacher.
 * Header must be row 0 of `rows`.
 */
function parseTeacherRowPerPeriodColumns(rows: RowMatrix): TeacherGrid {
  const header = rowStrings(rows[0])
  const teacherIdx = header.findIndex((h) => isTeacherColumnHeader(h))
  if (teacherIdx === -1) {
    throw new Error(
      'Could not find a "Teacher" column. Put names in the first column (header "Teacher"), or use Day + Period layout.',
    )
  }

  const periodCols: { index: number; name: string }[] = []
  for (let i = 0; i < header.length; i++) {
    if (i === teacherIdx) continue
    const h = header[i]
    if (!h) continue
    if (isPeriodColumnHeader(h)) {
      periodCols.push({ index: i, name: normalizePeriodColumnHeader(h) })
    }
  }

  periodCols.sort((a, b) => periodSortKey(a.name) - periodSortKey(b.name))

  if (periodCols.length === 0) {
    throw new Error(
      'No period columns found (expected P1, P2, …). Check the header row.',
    )
  }

  const slots: Record<SlotKey, Record<string, string>> = {}
  const day = SINGLE_DAY_LABEL
  for (const pc of periodCols) {
    slots[makeSlotKey(day, pc.name)] = {}
  }

  const teachers: string[] = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length === 0) continue
    const teacherName = String(row[teacherIdx] ?? '').trim()
    if (!teacherName) continue
    teachers.push(teacherName)
    for (const pc of periodCols) {
      const raw = row[pc.index]
      const val = normalizeScheduleCell(String(raw ?? ''))
      slots[makeSlotKey(day, pc.name)][teacherName] = val
    }
  }

  if (teachers.length === 0) {
    throw new Error('No teacher rows found under the header.')
  }

  return { teachers, slots }
}

function tryParseSheet(sheet: XLSX.WorkSheet, sheetName: string): TeacherGrid {
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as RowMatrix

  if (!rows.length) {
    throw new Error(`Sheet "${sheetName}" is empty.`)
  }

  const tpRow = findTeacherPeriodHeaderRow(rows)
  const dpRow = findDayPeriodHeaderRow(rows)

  if (tpRow >= 0) {
    const sliced = rows.slice(tpRow) as RowMatrix
    return parseTeacherRowPerPeriodColumns(sliced)
  }
  if (dpRow >= 0) {
    const sliced = rows.slice(dpRow) as RowMatrix
    return parseLongFormat(sliced)
  }

  throw new Error(
    `Sheet "${sheetName}": could not find a header row with (Teacher + P1…) or (Day + Period). Put titles above the header row, or move the header to the top.`,
  )
}

export function parseTeacherGridFromBuffer(buf: ArrayBuffer): TeacherGrid {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, {
      type: 'array',
      cellDates: false,
      cellNF: false,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Could not read this Excel file (${msg}). Try saving as .xlsx again or export CSV.`)
  }

  if (!wb.SheetNames?.length) {
    throw new Error('Workbook has no sheets.')
  }

  const failures: string[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue
    try {
      return tryParseSheet(sheet, name)
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e))
    }
  }

  throw new Error(
    failures.length
      ? `No sheet worked:\n${failures.slice(0, 5).join('\n')}`
      : 'Could not parse the workbook.',
  )
}
