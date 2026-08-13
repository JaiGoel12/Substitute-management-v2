import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import './App.css'
import { parseTeacherGridFromBuffer } from './parseGrid'
import type { Substitution, TeacherGrid } from './types'
import { isCellFree } from './cellNormalize'
import {
  applySubstitutions,
  autoAssignSubstitutions,
  collectSubstitutionNeeds,
  makePickKey,
  MAX_SUBSTITUTIONS_PER_TEACHER_PER_DAY,
  periodsForDay,
  removePicksForAbsentTeacher,
  substituteOptionsForPeriodSlot,
  teachersAtDailySubstitutionCap,
  unassignReasonLabel,
  uniqueDays,
  type AutoAssignResult,
} from './substituteLogic'
import { downloadSubstitutionSummaryPdf } from './pdfTimetable'
import { groupSubsByAbsent, slotPeriodLabel } from './summaryTableModel'
import { DEFAULT_TIMETABLE_URL } from './defaultTimetable'
import { sortTeachersByFirstName } from './teacherDisplay'
import { todaysWeekdayName } from './scheduleCell'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'

  const savedTheme = window.localStorage.getItem('theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

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

function substituteDisplayName(name: string): string {
  return name.trim() || 'Not assigned'
}

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
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
  const [autoAssignReport, setAutoAssignReport] = useState<AutoAssignResult | null>(null)
  const [autoFilledKeys, setAutoFilledKeys] = useState<Set<string>>(() => new Set())
  const [teacherSearch, setTeacherSearch] = useState('')

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

  const periods = day && baseGrid ? periodsForDay(baseGrid, day) : []

  const teachersByFirstName = useMemo(
    () => (baseGrid ? sortTeachersByFirstName(baseGrid.teachers) : []),
    [baseGrid],
  )

  const filteredTeachers = useMemo(() => {
    const q = teacherSearch.trim().toLowerCase()
    if (!q) return teachersByFirstName
    return teachersByFirstName.filter((t) => t.toLowerCase().includes(q))
  }, [teachersByFirstName, teacherSearch])

  const orderedAbsent = useMemo(() => {
    if (!baseGrid || !absentees.length) return []
    return sortTeachersByFirstName(baseGrid.teachers.filter((t) => absentees.includes(t)))
  }, [baseGrid, absentees])

  const currentNeedsCount =
    baseGrid && day && orderedAbsent.length
      ? collectSubstitutionNeeds(baseGrid, day, orderedAbsent).length
      : 0

  const teachersAtCapToday = useMemo(() => {
    if (!baseGrid || !day) return []
    return teachersAtDailySubstitutionCap(subs, substitutePicks, day, baseGrid.teachers)
  }, [baseGrid, day, subs, substitutePicks])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    setAbsentees([])
    setSubstitutePicks({})
    setAssignPhase('mark-absent')
    setAutoAssignReport(null)
    setAutoFilledKeys(new Set())
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
    const availableDays = uniqueDays(g)
    const today = todaysWeekdayName()
    const d0 = (today && availableDays.includes(today) ? today : availableDays[0]) ?? ''
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
      setAutoAssignReport(null)
      setAutoFilledKeys(new Set())
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
    setAutoFilledKeys((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  function runAutoAssign(andGoToStep: boolean) {
    if (!baseGrid || !day || orderedAbsent.length === 0) {
      setError('Mark at least one absent teacher first.')
      return
    }
    setError(null)
    const result = autoAssignSubstitutions(baseGrid, day, orderedAbsent, subs)
    setSubstitutePicks(result.picks)
    setAutoAssignReport(result)
    setAutoFilledKeys(new Set(result.filledKeys))
    if (andGoToStep) setAssignPhase('choose-subs')
  }

  function clearCurrentPicks() {
    if (!baseGrid || !day || orderedAbsent.length === 0) return
    setSubstitutePicks((prev) => {
      const next = { ...prev }
      for (const absent of orderedAbsent) {
        for (const period of periodsForDay(baseGrid, day)) {
          delete next[makePickKey(`${day}|${period}`, absent)]
        }
      }
      return next
    })
    setAutoAssignReport(null)
    setAutoFilledKeys(new Set())
    setError(null)
  }

  /** Manual pick dropdown — no daily substitution cap (cap applies to auto-assign only). */
  function substituteSlotOptions(
    slotKey: string,
    absent: string,
    picks: Record<string, string>,
  ): string[] {
    if (!baseGrid || !day) return []
    const options = substituteOptionsForPeriodSlot(
      baseGrid,
      slotKey,
      orderedAbsent,
      picks,
      absent,
      { existingSubs: subs },
    )
    const current = effectiveSubstitutePick(subs, picks, slotKey, absent).trim()
    if (current && !options.includes(current)) {
      return [...options, current].sort((a, b) => a.localeCompare(b))
    }
    return options
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
    setAutoAssignReport(null)
    setAutoFilledKeys(new Set())
  }

  function goToSubstituteStep() {
    setError(null)
    if (orderedAbsent.length === 0) {
      setError('Mark at least one absent teacher first.')
      return
    }
    setAssignPhase('choose-subs')
  }

  function goToSubstituteStepAndAutoAssign() {
    runAutoAssign(true)
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
    <MotionConfig reducedMotion="user">
    <div className="app">
      <header className="header">
        <div className="header-topbar">
          <p className="header-kicker">Substitution planner</p>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
        </div>
        <h1>Substitute timetable</h1>
      </header>

      {baseGrid && (
        <section className="card">
          <h2>Day + absent teachers</h2>
          <p className="hint step-hint">
            Day: <strong>{day || '—'}</strong>
          </p>

          <AnimatePresence mode="wait" initial={false}>
          {assignPhase === 'mark-absent' && (
            <motion.fieldset
              key="mark-absent"
              className="absent-fieldset"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <legend>Who is absent?</legend>
              <div className="teacher-search">
                <input
                  type="search"
                  className="teacher-search-input"
                  placeholder="Search teacher by name…"
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                  aria-label="Search teachers"
                />
                {teacherSearch && (
                  <button
                    type="button"
                    className="linkish teacher-search-clear"
                    onClick={() => setTeacherSearch('')}
                  >
                    Clear
                  </button>
                )}
              </div>
              <motion.div className="checkbox-grid" layout>
                <AnimatePresence mode="popLayout" initial={false}>
                  {filteredTeachers.map((t) => (
                    <motion.label
                      key={t}
                      className="check-row"
                      layout
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <input
                        type="checkbox"
                        checked={absentees.includes(t)}
                        onChange={() => toggleAbsent(t)}
                      />
                      <span>{t}</span>
                    </motion.label>
                  ))}
                </AnimatePresence>
              </motion.div>
              {filteredTeachers.length === 0 && (
                <p className="hint inline-hint">No teacher matches “{teacherSearch}”.</p>
              )}
              <div className="step-actions">
                {absentees.length > 0 && (
                  <button type="button" className="secondary" onClick={clearAbsentSelection}>
                    Clear absent selection
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={absentees.length === 0}
                  onClick={goToSubstituteStepAndAutoAssign}
                >
                  Auto-assign &amp; review
                </button>
                <button type="button" className="primary" onClick={goToSubstituteStep}>
                  Next: assign substitutes by period
                </button>
              </div>
            </motion.fieldset>
          )}

          {assignPhase === 'choose-subs' && orderedAbsent.length > 0 && day && (
            <motion.div
              className="assign-block"
              key="choose-subs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="assign-title">Substitutes (per period, per class)</h3>
              <p className="hint">
                <strong>Auto-assign</strong> limits each substitute to max{' '}
                <strong>{MAX_SUBSTITUTIONS_PER_TEACHER_PER_DAY}</strong> periods per day (and other
                school rules). <strong>Manual</strong> picks are not capped — choose anyone free in
                that period. You can change any row before confirming.
              </p>
              {autoAssignReport && (
                <div
                  className={`auto-assign-banner${autoAssignReport.unassigned.length ? ' auto-assign-banner-warn' : ''}`}
                  role="status"
                >
                  <p className="auto-assign-banner-title">
                    Assigned {autoAssignReport.filledKeys.length} of {currentNeedsCount} periods
                  </p>
                  {autoAssignReport.unassigned.length > 0 && (
                    <ul className="auto-assign-unassigned">
                      {autoAssignReport.unassigned.map((u) => (
                        <li key={makePickKey(u.slotKey, u.absentTeacher)}>
                          <strong>{u.absentTeacher}</strong> — {slotPeriodLabel(u.slotKey)} (
                          {u.className}): {unassignReasonLabel(u.reason)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {teachersAtCapToday.length > 0 && (
                    <p className="auto-assign-cap-hint">
                      At auto-assign limit ({MAX_SUBSTITUTIONS_PER_TEACHER_PER_DAY}/day):{' '}
                      <strong>{teachersAtCapToday.join(', ')}</strong> — you may still assign them
                      manually if needed.
                    </p>
                  )}
                </div>
              )}
              <div className="step-actions assign-toolbar">
                <button type="button" className="primary" onClick={() => runAutoAssign(false)}>
                  Auto-assign using rules
                </button>
                <button type="button" className="secondary" onClick={clearCurrentPicks}>
                  Clear picks
                </button>
              </div>
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
                              <td data-label="Period">{period}</td>
                              <td colSpan={2} data-label="Status">
                                <span className="muted">Free — no substitution</span>
                              </td>
                            </tr>
                          )
                        }
                        const pickKey = makePickKey(slotKey, absent)
                        const val = pickValue(slotKey, absent)
                        const options = substituteSlotOptions(
                          slotKey,
                          absent,
                          substitutePicks,
                        )
                        const isAutoSuggested =
                          autoFilledKeys.has(pickKey) &&
                          val.trim() !== '' &&
                          options.includes(val)
                        return (
                          <tr key={slotKey}>
                            <td data-label="Period">{period}</td>
                            <td className="class-cell" data-label="Class">{cell}</td>
                            <td data-label="Substitute">
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
                              {isAutoSuggested && (
                                <span className="auto-suggest-hint">Suggested — most free periods</span>
                              )}
                              {options.length === 0 && (
                                <span className="warn-inline"> No eligible teacher.</span>
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
            </motion.div>
          )}
          </AnimatePresence>
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
                        { existingSubs: subs },
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
                              substituteDisplayName(row.sub.substituteTeacher)
                            )
                          ) : (
                            substituteDisplayName(row.sub.substituteTeacher)
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

      <footer className="app-footer">
        <p>&copy; {new Date().getFullYear()} All rights reserved.</p>
      </footer>
    </div>
    </MotionConfig>
  )
}

export default App
