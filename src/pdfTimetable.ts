import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Substitution, TeacherGrid } from './types'
import { roomForClass } from './classRoomMap'
import { groupSubsByAbsent, slotPeriodLabel } from './summaryTableModel'
import { allClassesFromGrid, invertToClassCentric, periodsForDay } from './substituteLogic'

/** Shown at the top of every exported PDF. */
const PDF_SCHOOL_HEADER = 'GMSSSS Jahajpul, Hisar'

function drawPdfSchoolHeader(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(33, 37, 41)
  doc.text(PDF_SCHOOL_HEADER, pageW / 2, 10, { align: 'center' })
  doc.setFont('helvetica', 'normal')
}

function slotKey(day: string, period: string): string {
  return `${day.trim()}|${period.trim()}`
}

type SummaryCell =
  | string
  | { content: string; rowSpan: number; styles: Record<string, unknown> }

/** Repeat absent name each row — only for very tall blocks where rowspan would split across pages badly. */
function buildSummaryBodyFlat(group: {
  absent: string
  rows: { sub: Substitution; originalIndex: number }[]
}): string[][] {
  return group.rows.map((row) => {
    const room = roomForClass(row.sub.className)
    return [
      group.absent,
      slotPeriodLabel(row.sub.slotKey),
      row.sub.className,
      room || '—',
      row.sub.substituteTeacher,
      '',
    ]
  })
}

/** Teacher on leave once per block (merged cell). */
function buildSummaryBodyRowspan(group: {
  absent: string
  rows: { sub: Substitution; originalIndex: number }[]
}): SummaryCell[][] {
  const n = group.rows.length
  const body: SummaryCell[][] = []
  group.rows.forEach((row, i) => {
    const period = slotPeriodLabel(row.sub.slotKey)
    const room = roomForClass(row.sub.className) || '—'
    if (i === 0) {
      body.push([
        {
          content: group.absent,
          rowSpan: n,
          styles: {
            valign: 'middle',
            fontStyle: 'bold',
            fontSize: 9,
          },
        },
        period,
        row.sub.className,
        room,
        row.sub.substituteTeacher,
        '',
      ])
    } else {
      body.push([period, row.sub.className, room, row.sub.substituteTeacher, ''])
    }
  })
  return body
}

/** Rough max rows so one absent block fits a single page with head (rowspan must not span pages). */
function maxRowsForRowspanPdf(doc: jsPDF): number {
  const pageH = doc.internal.pageSize.getHeight()
  const headMm = 10
  const rowMm = 5.8
  const topBottomReserve = 28
  const usable = pageH - topBottomReserve
  return Math.max(1, Math.floor((usable - headMm) / rowMm))
}

function formatSubstitutionDate(): string {
  return new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Light-theme substitution summary: gaps between blocks; no manual outer rect (avoids multi-page border bugs). */
export function downloadSubstitutionSummaryPdf(
  subs: Substitution[],
  title = 'Substitution summary',
): void {
  if (!subs.length) return

  const groups = groupSubsByAbsent(subs)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = { left: 14, right: 14 }
  const gapBetweenGroupsMm = 10

  drawPdfSchoolHeader(doc)

  doc.setTextColor(33, 37, 41)
  doc.setFontSize(14)
  doc.text(title, margin.left, 19)

  const dateStr = formatSubstitutionDate()
  doc.setFontSize(14)
  doc.setTextColor(33, 37, 41)
  const dateW = doc.getTextWidth(dateStr)
  doc.text(dateStr, pageW - margin.right - dateW, 19)

  const columnStylesRowspan = {
    0: { cellWidth: 36 },
    1: { cellWidth: 16 },
    2: { cellWidth: 28 },
    3: { cellWidth: 16 },
    4: { cellWidth: 'auto' as const },
    5: { cellWidth: 22 },
  }
  const columnStylesFlat = {
    0: { cellWidth: 36, fontStyle: 'bold' as const },
    1: { cellWidth: 16 },
    2: { cellWidth: 28 },
    3: { cellWidth: 16 },
    4: { cellWidth: 'auto' as const },
    5: { cellWidth: 22 },
  }

  let startY = 27
  const rowspanLimit = maxRowsForRowspanPdf(doc)

  groups.forEach((group, gIdx) => {
    const useFlat = group.rows.length > rowspanLimit
    const body = useFlat ? buildSummaryBodyFlat(group) : buildSummaryBodyRowspan(group)

    autoTable(doc, {
      startY,
      head: [['Teacher on leave', 'Period', 'Class', 'Room No.', 'Substitute', 'Signature']],
      showHead: 'everyPage',
      body,
      theme: 'grid',
      pageBreak: 'avoid',
      rowPageBreak: 'avoid',
      styles: {
        fontSize: 9,
        cellPadding: 2.5,
        textColor: [33, 37, 41],
        lineColor: [210, 215, 222],
        lineWidth: 0.12,
      },
      headStyles: {
        fillColor: [236, 238, 242],
        textColor: [33, 37, 41],
        fontStyle: 'bold',
        fontSize: 9,
      },
      columnStyles: useFlat ? columnStylesFlat : columnStylesRowspan,
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const i = data.row.index
        const light: [number, number, number] = [255, 255, 255]
        const alt: [number, number, number] = [248, 249, 252]
        data.cell.styles.fillColor = i % 2 === 0 ? light : alt
        data.cell.styles.textColor = [33, 37, 41]
      },
      margin: { left: margin.left, right: margin.right },
    })

    const last = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable
    const finalY = last?.finalY ?? startY

    if (gIdx < groups.length - 1) {
      startY = finalY + gapBetweenGroupsMm
    }
  })

  doc.save(`substitution-summary-${sanitizeFilename(new Date().toISOString().slice(0, 10))}.pdf`)
}

/**
 * PDF: one table per scope — rows = classes, columns = periods for the chosen day.
 * Cell = teacher name after substitutions.
 */
export function downloadSubstitutedClassTimetablePdf(
  grid: TeacherGrid,
  day: string,
  title = 'Substituted timetable',
): void {
  const periods = periodsForDay(grid, day)
  const classes = allClassesFromGrid(grid)
  const classCentric = invertToClassCentric(grid)

  const head = ['Class', ...periods.map(periodColumnTitle)]
  const body = classes.map((cls) => {
    const row: string[] = [cls]
    for (const p of periods) {
      const sk = slotKey(day, p)
      const t = classCentric[sk]?.[cls] ?? ''
      row.push(t || '—')
    }
    return row
  })

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  drawPdfSchoolHeader(doc)
  doc.setFontSize(14)
  const dayTitle = day.trim() === 'Timetable' ? 'Daily timetable' : day.trim()
  doc.text(`${title} — ${dayTitle}`, 14, 19)
  doc.setFontSize(9)

  autoTable(doc, {
    startY: 25,
    head: [head],
    body,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [66, 73, 85] },
    margin: { left: 14, right: 14 },
  })

  doc.save(`substituted-timetable-${sanitizeFilename(dayTitle)}.pdf`)
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'export'
}

/** Avoid "PP1" when period id is already "P1". */
function periodColumnTitle(p: string): string {
  const t = p.trim()
  if (/^P\s*\d+$/i.test(t)) return t.replace(/\s+/g, '')
  return `P${t}`
}
