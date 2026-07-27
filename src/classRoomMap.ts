/**
 * Room allocation (W.e.f. 15.04.2026). Keys are normalized for lookup; values as on the notice.
 * Edit `DEFAULT_CLASS_ROOM_ENTRIES` if your timetable uses different class spellings.
 */
const DEFAULT_CLASS_ROOM_ENTRIES: [string, string][] = [
  ['10th A', '20'],
  ['10th B', '39'],
  ['10th C', '40'],
  ['10th D', '41'],
  ['10th E', '42'],
  ['9th A', '44'],
  ['9th B', '45'],
  ['9th C', '46'],
  ['9th D', '47'],
  ['9th E', '48'],
  ['9th F', '49'],
  ['12th Arts A', '29'],
  ['12th Arts B', '30'],
  ['12th Arts C', '31'],
  ['12th Arts D', '32'],
  ['12th Arts E', '33'],
  ['12th Arts F', '34'],
  ['11th Arts A', '35'],
  ['11th Arts B', '36'],
  ['11th Arts C', '37'],
  ['11th Arts D', '38'],
  ['11th Arts E', '105'],
  ['11th Arts F', '106'],
  ['12th Commerce A', '06'],
  ['12th Commerce B', '05'],
  ['12th Commerce C', '04'],
  ['11th Commerce A', '07'],
  ['11th Commerce B', '08'],
  ['11th Commerce C', '50'],
  ['12th Science A', '16'],
  ['12th Science B', '15'],
  ['12th Science C', '09'],
  ['11th Science A', '101'],
  ['11th Science B', '102'],
  ['11th Science C', '103'],
  ['11th Science D', '104'],

  ['12TH ARTS E (SKT)', '18'],
  ['11TH ARTS (SKT)', '18'],
  ['10TH (SKT)', '18'],

  ['11TH ARTS B (CS)', '102'],
  ['12TH ARTS+COMM+SCI (CS)', '9'],
  ['11TH ARTS+COMM+SCI (CS)', '102'],
  ['9TH (CS)', '48'],
  ['10TH (CS)', '41'],

  ['12 ARTS+COMM+SCI (P)', '16'],
  ['11 ARTS+COMM+SCI (P)', '8'],
  ['9TH (P)', '49'],
  ['10TH (P)', '40'],

  ['12  ARTS+COMM+SCI (IT)', '103'],
  ['11  ARTS+COMM+SCI (IT)', '101'],
  ['9TH (IT)', '45'],
  ['10TH (IT)', '42'],

  ['12 ARTS+COMM+SCI (PAT)', '32'],
  ['11 ARTS+COMM+SCI (PAT)', '104'],
  ['9TH (PAT)', '46'],
  ['10TH (PAT)', '20'],

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
