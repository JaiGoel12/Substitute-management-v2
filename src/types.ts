/** Normalized key: `${day}|${period}` */
export type SlotKey = string

export interface TeacherGrid {
  /** Column headers after Day + Period */
  teachers: string[]
  /** For each slot, teacher name -> class name (empty = free) */
  slots: Record<SlotKey, Record<string, string>>
}

export interface Substitution {
  slotKey: SlotKey
  absentTeacher: string
  substituteTeacher: string
  /** Class the substitute covers (from the absent teacher’s cell). */
  className: string
}
