/**
 * Room allocation (W.e.f. 15.04.2026). Keys are normalized for lookup; values as on the notice.
 * Edit `DEFAULT_CLASS_ROOM_ENTRIES` if your timetable uses different class spellings.
 */
const DEFAULT_CLASS_ROOM_ENTRIES: [string, string][] = [
  ['10th A', '24'],
  ['10th B', '35'],
  ['10th C', '36'],
  ['10th D', '38'],
  ['10th E', '37'],
  ['9th A', '40'],
  ['9th B', '41'],
  ['9th C', '42'],
  ['9th D', '43'],
  ['9th E', '44'],
  ['9th F', '45'],
  ['12th Arts A', '29'],
  ['12th Arts B', '30'],
  ['12th Arts C', '31'],
  ['12th Arts D', '32'],
  ['12th Arts E', '33'],
  ['12th Arts F', '34'],
  ['11th Arts A', '34 A'],
  ['11th Arts B', '34 B'],
  ['11th Arts C', '34 C'],
  ['11th Arts D', '34 D'],
  ['11th Arts E', '105'],
  ['11th Arts F', '106'],
  ['12th Commerce A', '06'],
  ['12th Commerce B', '05'],
  ['12th Commerce C', '04'],
  ['11th Commerce A', '07'],
  ['11th Commerce B', '08'],
  ['11th Commerce C', '09'],
  ['12th Science A', '16'],
  ['12th Science B', '15'],
  ['12th Science C', '20'],
  ['11th Science A', '101'],
  ['11th Science B', '102'],
  ['11th Science C', '103'],
  ['11th Science D', '104'],
]

/**
 * Maps timetable / Excel labels (e.g. "11 COMM A", "12 SCI B", "12 ARTS C") to the same keys as
 * the official notice ("11th Commerce A", …).
 */
function normalizeClassForRoomLookup(raw: string): string {
  let s = raw.trim().replace(/-/g, ' ').replace(/\s+/g, ' ')
  // Notice typo "11 Arts D" → treat as 11th Arts D
  s = s.replace(/^11\s+Arts\b/i, '11th Arts')
  // Excel often omits space: "12COMM C" → "12 COMM C"
  s = s.replace(/^(\d{1,2})(COMM|SCI|ARTS)\b/i, '$1 $2')
  s = s.toLowerCase()
  // Abbreviations used in sheets (must use \b so "commerce"/"science" are not broken)
  s = s.replace(/\bcomm\b/g, 'commerce')
  s = s.replace(/\bsci\b/g, 'science')
  // Normalize 9–12 to 9th…12th when "th" is missing (e.g. "11 commerce a")
  s = s.replace(/^(\d{1,2})(?:st|nd|rd|th)?(\s+)(.+)$/i, (_, n, sp: string, rest: string) => {
    const v = parseInt(String(n), 10)
    const ord: Record<number, string> = { 9: '9th', 10: '10th', 11: '11th', 12: '12th' }
    const head = ord[v] ?? String(n)
    return `${head}${sp}${rest}`.replace(/\s+/g, ' ').trim()
  })
  return s
}

const LOOKUP: ReadonlyMap<string, string> = new Map(
  DEFAULT_CLASS_ROOM_ENTRIES.map(([cls, room]) => [normalizeClassForRoomLookup(cls), room.trim()]),
)

/** Room number for PDF / display; empty string if class is not in the default list. */
export function roomForClass(className: string): string {
  const key = normalizeClassForRoomLookup(className)
  return LOOKUP.get(key) ?? ''
}
