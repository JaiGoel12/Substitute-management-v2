/** Blank, whitespace, or the word "Free" (any case) = not teaching. */
export function isCellFree(raw: string): boolean {
  const s = raw.trim()
  if (!s) return true
  return /^free$/i.test(s)
}

/** Store in grid: empty string if free, else normalized class label. */
export function normalizeScheduleCell(raw: string): string {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!s || /^free$/i.test(s)) return ''
  return s
}
