import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { parseTeacherGridFromBuffer } from './parseGrid'
import type { Substitution, TeacherGrid } from './types'
import { isCellFree } from './cellNormalize'
import {
  applySubstitutions,
  collectSubstitutionNeeds,
  makePickKey,
  periodsForDay,
  removePicksForAbsentTeacher,
  substituteOptionsForPeriodSlot,
  uniqueDays,
} from './substituteLogic'
import { downloadSubstitutionSummaryPdf } from './pdfTimetable'
import { groupSubsByAbsent, slotPeriodLabel } from './summaryTableModel'
import { DEFAULT_TIMETABLE_URL } from './defaultTimetable'

function picksFromSubsExcluding(subs: Substitution[], excludeIndex: number): Record<string, string> {
  const o: Record<string, string> = {}
  subs.forEach((s, i) => {
    if (i === excludeIndex) return
    o[makePickKey(s.slotKey, s.absentTeacher)] = s.substituteTeacher
  })
  return o
}

function uniqueAbsentsFromSubs(subs: Substitution[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of subs) {
    if (!seen.has(s.absentTeacher)) {
      seen.add(s.absentTeacher)
      out.push(s.absentTeacher)
    }
  }
  return out
}

function picksRecordFromSubs(rows: Substitution[]): Record<string, string> {
  const o: Record<string, string> = {}
  for (const s of rows) {
    o[makePickKey(s.slotKey, s.absentTeacher)] = s.substituteTeacher
  }
  return o
}

/** Saved summary rows + current assign step; UI picks override saved when the user changes a row. */
function mergedAssignmentPicks(
  subs: Substitution[],
  substitutePicks: Record<string, string>,
): Record<string, string> {
  return { ...picksRecordFromSubs(subs), ...substitutePicks }
}

function effectiveSubstitutePick(
  subs: Substitution[],
  substitutePicks: Record<string, string>,
  slotKey: string,
  absent: string,
): string {
  const key = makePickKey(slotKey, absent)
  if (Object.prototype.hasOwnProperty.call(substitutePicks, key)) {
    return substitutePicks[key] ?? ''
  }
  const fromSubs = subs.find((s) => s.slotKey === slotKey && s.absentTeacher === absent)
  return fromSubs?.substituteTeacher ?? ''
}

function App() {
  const [error, setError] = useState<string | null>(null)
  const [baseGrid, setBaseGrid] = useState<TeacherGrid | null>(null)
  const [subs, setSubs] = useState<Substitution[]>([])
  /** `makePickKey(slot, absent)` while editing that row’s substitute */
  const [editingPickKey, setEditingPickKey] = useState<string | null>(null)
  const [editSubstituteDraft, setEditSubstituteDraft] = useState('')

  const [day, setDay] = useState('')
  /** Teachers absent (whole day / session); cannot be substitutes in any period. */
  const [absentees, setAbsentees] = useState<string[]>([])
  /** Keys from makePickKey(slotKey, absentTeacher) → substitute name */
  const [substitutePicks, setSubstitutePicks] = useState<Record<string, string>>({})
  const [assignPhase, setAssignPhase] = useState<'mark-absent' | 'choose-subs'>('mark-absent')

  const working = useMemo(() => {
    if (!baseGrid) return { grid: null as TeacherGrid | null, err: null as string | null }
    try {
      return { grid: applySubstitutions(baseGrid, subs), err: null }
    } catch (e) {
      return {
        grid: null,
        err: e instanceof Error ? e.message : 'Invalid substitutions.',
      }
    }
  }, [baseGrid, subs])

  const workingGrid = working.grid
  const workingErr = working.err

  const days = baseGrid ? uniqueDays(baseGrid) : []
  const periods = day && baseGrid ? periodsForDay(baseGrid, day) : []

  const orderedAbsent =
    baseGrid && absentees.length
      ? baseGrid.teachers.filter((t) => absentees.includes(t))
      : []

  useEffect(() => {
    setAbsentees([])
    setSubstitutePicks({})
    setAssignPhase('mark-absent')
  }, [day])

  useEffect(() => {
    if (assignPhase === 'choose-subs' && absentees.length === 0) {
      setAssignPhase('mark-absent')
    }
  }, [assignPhase, absentees.length])

  async function ingestArrayBuffer(buf: ArrayBuffer) {
    await new Promise<void>((r) => {
      setTimeout(r, 0)
    })
    const g = parseTeacherGridFromBuffer(buf)
    setBaseGrid(g)
    const d0 = uniqueDays(g)[0] ?? ''
    setDay(d0)
  }

  useEffect(() => {
    let cancelled = false
    async function loadDefault() {
      setError(null)
      setSubs([])
      setEditingPickKey(null)
      setEditSubstituteDraft('')
      setAbsentees([])
      setSubstitutePicks({})
      setAssignPhase('mark-absent')
      try {
        const res = await fetch(DEFAULT_TIMETABLE_URL)
        if (!res.ok) {
          throw new Error(
            `Default timetable not found (${res.status}). Place Substitution_System.xlsx in the public folder.`,
          )
        }
        const buf = await res.arrayBuffer()
        if (cancelled) return
        await ingestArrayBuffer(buf)
      } catch (e) {
        if (!cancelled) {
          setBaseGrid(null)
          setError(
            e instanceof Error
              ? e.message
              : 'Could not load default timetable. Check that Substitution_System.xlsx is in the public folder.',
          )
        }
      }
    }
    void loadDefault()
    return () => {
      cancelled = true
    }
  }, [])

  function toggleAbsent(name: string) {
    setAbsentees((prev) => {
      if (prev.includes(name)) {
        setSubstitutePicks((picks) => removePicksForAbsentTeacher(picks, name))
        return prev.filter((x) => x !== name)
      }
      return [...prev, name]
    })
  }

  function clearAbsentSelection() {
    setAbsentees([])
    setSubstitutePicks({})
  }

  function setPickSlot(slotKey: string, absent: string, substitute: string) {
    const key = makePickKey(slotKey, absent)
    setSubstitutePicks((p) => ({ ...p, [key]: substitute }))
  }

  function pickValue(slotKey: string, absent: string): string {
    return effectiveSubstitutePick(subs, substitutePicks, slotKey, absent)
  }

  function applyAllSubstitutions() {
    if (!baseGrid || !day || orderedAbsent.length === 0) return
    setError(null)

    const needs = collectSubstitutionNeeds(baseGrid, day, orderedAbsent)
    if (needs.length === 0) {
      setError('No classes to cover — selected teachers are free in every period (nothing to assign).')
      return
    }

    for (const n of needs) {
      if (!effectiveSubstitutePick(subs, substitutePicks, n.slotKey, n.absentTeacher).trim()) {
        setError(
          `Choose a substitute for ${n.absentTeacher} in ${slotPeriodLabel(n.slotKey)} (class ${n.className}).`,
        )
        return
      }
    }

    const batch: Substitution[] = needs.map((n) => ({
      slotKey: n.slotKey,
      absentTeacher: n.absentTeacher,
      substituteTeacher: effectiveSubstitutePick(subs, substitutePicks, n.slotKey, n.absentTeacher).trim(),
      className: n.className,
    }))

    const absentSet = new Set(orderedAbsent)
    const keep = subs.filter((s) => !absentSet.has(s.absentTeacher))
    const nextSubs = [...keep, ...batch]

    try {
      applySubstitutions(baseGrid, nextSubs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid substitution batch.')
      return
    }

    setSubs(nextSubs)
    setEditingPickKey(null)
    setEditSubstituteDraft('')
    setSubstitutePicks({})
    setAssignPhase('mark-absent')
  }

  function goToSubstituteStep() {
    setError(null)
    if (orderedAbsent.length === 0) {
      setError('Mark at least one absent teacher first.')
      return
    }
    setAssignPhase('choose-subs')
  }

  function backToAbsentStep() {
    setError(null)
    setAssignPhase('mark-absent')
  }

  function cancelSummaryEdit() {
    setEditingPickKey(null)
    setEditSubstituteDraft('')
  }

  function startSummaryEdit(sub: Substitution) {
    setError(null)
    setEditingPickKey(makePickKey(sub.slotKey, sub.absentTeacher))
    setEditSubstituteDraft(sub.substituteTeacher)
  }

  function saveSummaryEdit() {
    if (!baseGrid || !editingPickKey) return
    const idx = subs.findIndex(
      (s) => makePickKey(s.slotKey, s.absentTeacher) === editingPickKey,
    )
    if (idx < 0) {
      cancelSummaryEdit()
      return
    }
    const trimmed = editSubstituteDraft.trim()
    if (!trimmed) {
      setError('Choose a substitute or cancel.')
      return
    }
    const next = subs.map((s, i) =>
      i === idx ? { ...s, substituteTeacher: trimmed } : s,
    )
    try {
      applySubstitutions(baseGrid, next)
      setSubs(next)
      cancelSummaryEdit()
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid substitute.')
    }
  }

  function removeSubstitution(i: number) {
    const removed = subs[i]
    if (
      removed &&
      editingPickKey === makePickKey(removed.slotKey, removed.absentTeacher)
    ) {
      cancelSummaryEdit()
    }
    setSubs((s) => s.filter((_, j) => j !== i))
  }

  function downloadSummaryPdf() {
    if (!subs.length) {
      setError('Confirm at least one substitution before downloading the summary PDF.')
      return
    }
    setError(null)
    try {
      downloadSubstitutionSummaryPdf(subs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF failed.')
    }
  }

  return (
    <div className="app">
      <header className="header">
        <p className="header-kicker">Substitution planner</p>
        <h1>Substitute timetable</h1>
      </header>

      {baseGrid && (
        <section className="card">
          <h2>Day + absent teachers</h2>
          {days.length > 1 && (
            <div className="row">
              <label>
                Day
                <select
                  value={day}
                  onChange={(e) => {
                    const d = e.target.value
                    setDay(d)
                  }}
                >
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <p className="hint step-hint">
            Periods in your file:{' '}
            <strong>{periods.length ? periods.join(', ') : '—'}</strong>. Substitutions are built{' '}
            <strong>per period</strong> for each absent teacher (skip periods where they are already
            Free).
          </p>

          {assignPhase === 'mark-absent' && (
            <fieldset className="absent-fieldset">
              <legend>Who is absent?</legend>
              <p className="hint inline-hint">
                These teachers cannot be assigned as substitutes in any period.
              </p>
              <div className="checkbox-grid">
                {baseGrid.teachers.map((t) => (
                  <label key={t} className="check-row">
                    <input
                      type="checkbox"
                      checked={absentees.includes(t)}
                      onChange={() => toggleAbsent(t)}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
              <div className="step-actions">
                {absentees.length > 0 && (
                  <button type="button" className="secondary" onClick={clearAbsentSelection}>
                    Clear absent selection
                  </button>
                )}
                <button type="button" className="primary" onClick={goToSubstituteStep}>
                  Next: assign substitutes by period
                </button>
              </div>
            </fieldset>
          )}

          {assignPhase === 'choose-subs' && orderedAbsent.length > 0 && day && (
            <div className="assign-block">
              <h3 className="assign-title">Substitutes (per period, per class)</h3>
              <p className="hint">
                For each <strong>class period</strong>, pick a teacher who is free then. Teachers
                already assigned (including from earlier confirmations in this session) are hidden
                from other rows in that period.
              </p>
              <p className="hint edit-absent-line">
                <button type="button" className="linkish" onClick={backToAbsentStep}>
                  ← Edit absent list
                </button>
              </p>

              {orderedAbsent.map((absent) => (
                <div key={absent} className="absent-block">
                  <h4 className="absent-name">{absent}</h4>
                  <table className="assign-table period-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Class / status</th>
                        <th>Substitute (free in this period)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((period) => {
                        const slotKey = `${day}|${period}`
                        const raw = baseGrid.slots[slotKey]?.[absent] ?? ''
                        const cell = String(raw).trim()
                        const free = !cell || isCellFree(cell)
                        if (free) {
                          return (
                            <tr key={slotKey} className="row-muted">
                              <td>{period}</td>
                              <td colSpan={2}>
                                <span className="muted">Free — no substitution</span>
                              </td>
                            </tr>
                          )
                        }
                        const options = substituteOptionsForPeriodSlot(
                          baseGrid,
                          slotKey,
                          orderedAbsent,
                          mergedAssignmentPicks(subs, substitutePicks),
                          absent,
                        )
                        const val = pickValue(slotKey, absent)
                        return (
                          <tr key={slotKey}>
                            <td>{period}</td>
                            <td className="class-cell">{cell}</td>
                            <td>
                              <select
                                value={val}
                                onChange={(e) => setPickSlot(slotKey, absent, e.target.value)}
                              >
                                <option value="">Choose substitute…</option>
                                {options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                              {options.length === 0 && (
                                <span className="warn-inline"> No free teacher.</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}

              <div className="step-actions">
                <button type="button" className="secondary" onClick={backToAbsentStep}>
                  Back
                </button>
                <button type="button" className="primary" onClick={applyAllSubstitutions}>
                  Confirm all substitutions
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {subs.length > 0 && (
        <section className="card">
          <h2>Substitution summary</h2>
          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Teacher on leave</th>
                  <th>Period</th>
                  <th>Class</th>
                  <th>Substitute</th>
                  <th className="summary-actions-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupSubsByAbsent(subs).map((group, groupIndex) =>
                  group.rows.map((row, rowInGroup) => {
                    const zebra = groupIndex % 2 === 0 ? 'summary-zebra-a' : 'summary-zebra-b'
                    const isFirstInGroup = rowInGroup === 0
                    const isNotFirstGroup = groupIndex > 0
                    const rowPickKey = makePickKey(row.sub.slotKey, row.sub.absentTeacher)
                    const isEditing = editingPickKey === rowPickKey
                    const editIdx = row.originalIndex
                    let editOptions: string[] = []
                    if (baseGrid && isEditing) {
                      editOptions = substituteOptionsForPeriodSlot(
                        baseGrid,
                        row.sub.slotKey,
                        uniqueAbsentsFromSubs(subs),
                        picksFromSubsExcluding(subs, editIdx),
                        row.sub.absentTeacher,
                      )
                      const d = editSubstituteDraft.trim()
                      if (d && !editOptions.includes(d)) {
                        editOptions = [...editOptions, d].sort()
                      } else {
                        editOptions = [...editOptions].sort()
                      }
                    }
                    return (
                      <tr
                        key={`${row.sub.slotKey}-${row.sub.absentTeacher}-${row.originalIndex}`}
                        className={`${zebra}${isFirstInGroup && isNotFirstGroup ? ' summary-group-divider' : ''}${isFirstInGroup ? ' summary-group-first-row' : ''}`}
                      >
                        {isFirstInGroup && (
                          <td className="summary-absent-cell" rowSpan={group.rows.length}>
                            <span className="summary-absent-name">{group.absent}</span>
                          </td>
                        )}
                        <td className="summary-period">{slotPeriodLabel(row.sub.slotKey)}</td>
                        <td>{row.sub.className}</td>
                        <td>
                          {isEditing ? (
                            baseGrid ? (
                              <>
                                <select
                                  className="summary-sub-select"
                                  value={editSubstituteDraft}
                                  onChange={(e) => setEditSubstituteDraft(e.target.value)}
                                >
                                  <option value="">Choose substitute…</option>
                                  {editOptions.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                                {editOptions.length === 0 && !editSubstituteDraft.trim() && (
                                  <span className="warn-inline"> No free teacher.</span>
                                )}
                              </>
                            ) : (
                              row.sub.substituteTeacher
                            )
                          ) : (
                            row.sub.substituteTeacher
                          )}
                        </td>
                        <td className="summary-actions">
                          <div className="summary-actions-inner">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  className="primary summary-inline-btn"
                                  onClick={saveSummaryEdit}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="secondary summary-inline-btn"
                                  onClick={cancelSummaryEdit}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="row-edit"
                                  disabled={!baseGrid}
                                  onClick={() => startSummaryEdit(row.sub)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="row-remove"
                                  onClick={() => removeSubstitution(row.originalIndex)}
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {workingGrid && day && (
        <section className="card">
          <h2>Download PDF</h2>
          <p className="hint">
            The <strong>substitution summary PDF</strong> adds a blank <strong>Signature</strong> column for
            printing; the on-screen table above does not show that column.
          </p>
          <div className="pdf-actions">
            <button
              type="button"
              className="primary"
              onClick={downloadSummaryPdf}
              disabled={!subs.length}
            >
              Download substitution summary PDF
            </button>
          </div>
        </section>
      )}

      {(error || workingErr) && (
        <p className="error">{error ?? workingErr}</p>
      )}
    </div>
  )
}

export default App
