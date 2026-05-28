import type { Substitution } from './types'

export function slotPeriodLabel(slotKey: string): string {
  const i = slotKey.indexOf('|')
  return i === -1 ? slotKey : slotKey.slice(i + 1)
}

/** Preserve confirmation order; one block per absent teacher. */
export function groupSubsByAbsent(
  subs: Substitution[],
): { absent: string; rows: { sub: Substitution; originalIndex: number }[] }[] {
  const order: string[] = []
  const buckets = new Map<string, { sub: Substitution; originalIndex: number }[]>()
  subs.forEach((sub, originalIndex) => {
    const a = sub.absentTeacher
    if (!buckets.has(a)) {
      buckets.set(a, [])
      order.push(a)
    }
    buckets.get(a)!.push({ sub, originalIndex })
  })
  return order.map((absent) => ({ absent, rows: buckets.get(absent)! }))
}
