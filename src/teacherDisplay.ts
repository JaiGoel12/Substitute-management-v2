/** Strip honorific prefix (SH., SMT., etc.) for display sorting. */
export function teacherFirstNameSortKey(displayName: string): string {
  const withoutPrefix = displayName
    .trim()
    .replace(/^(SH|SMT|MR|MS|MRS|DR)\.?\s*/i, '')
    .trim()
  const firstName = withoutPrefix.split(/\s+/)[0] ?? withoutPrefix
  return firstName.toLocaleLowerCase()
}

export function compareTeachersByFirstName(a: string, b: string): number {
  const cmp = teacherFirstNameSortKey(a).localeCompare(teacherFirstNameSortKey(b))
  if (cmp !== 0) return cmp
  return a.localeCompare(b)
}

export function sortTeachersByFirstName(teachers: string[]): string[] {
  return [...teachers].sort(compareTeachersByFirstName)
}
