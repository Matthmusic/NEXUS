import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCcw, X } from 'lucide-react'
import { CABLES, CABLE_CATS, SECTION_RE, COND_RE, normalizeSection } from './components/calc/cableData'
import type { CalcSession, DevisLine } from './components/calc/types'
import TableDesPrix from './components/calc/TableDesPrix'
import DevisPanel from './components/calc/DevisPanel'
import SessionsPanel from './components/calc/SessionsPanel'
import CablePrixImportModal from './components/modals/CablePrixImportModal'

const SESSIONS_KEY = 'nexus-calc-sessions'
const STATE_KEY = 'nexus-calc-state'
const DEFAULT_MARGE = 1.4
const DEFAULT_TAUX = 50
const DEFAULT_QTY = 10

type PersistedCalcState = {
  corrType: string
  corrSection: string
  corrRefRef: string
  corrCalcIdx: number | null
  corrMarge: number
  corrTaux: number
  corrQty: number
}

function matchCalcSection(section: string): number | null {
  const target = normalizeSection(section)
  const idx = CABLES.findIndex((cable) => normalizeSection(cable.designation) === target)
  return idx >= 0 ? idx : null
}

function getDefaultRef(items: PriceItem[]) {
  return items.find((item) => !COND_RE.test(item.name)) ?? items[0] ?? null
}

function loadSessions(): CalcSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    return raw ? (JSON.parse(raw) as CalcSession[]) : []
  } catch {
    return []
  }
}

function persistSessions(sessions: CalcSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

function loadPersistedState(): PersistedCalcState {
  const fallback: PersistedCalcState = {
    corrType: '',
    corrSection: '',
    corrRefRef: '',
    corrCalcIdx: null,
    corrMarge: DEFAULT_MARGE,
    corrTaux: DEFAULT_TAUX,
    corrQty: DEFAULT_QTY,
  }

  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedCalcState>
    return {
      corrType: typeof parsed.corrType === 'string' ? parsed.corrType : fallback.corrType,
      corrSection: typeof parsed.corrSection === 'string' ? parsed.corrSection : fallback.corrSection,
      corrRefRef: typeof parsed.corrRefRef === 'string' ? parsed.corrRefRef : fallback.corrRefRef,
      corrCalcIdx: typeof parsed.corrCalcIdx === 'number' ? parsed.corrCalcIdx : fallback.corrCalcIdx,
      corrMarge: typeof parsed.corrMarge === 'number' ? parsed.corrMarge : fallback.corrMarge,
      corrTaux: typeof parsed.corrTaux === 'number' ? parsed.corrTaux : fallback.corrTaux,
      corrQty: typeof parsed.corrQty === 'number' ? parsed.corrQty : fallback.corrQty,
    }
  } catch {
    return fallback
  }
}

function persistCalcState(state: PersistedCalcState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
}

function sortSections(sections: string[]) {
  return [...sections].sort((a, b) => {
    const parse = (value: string): [number, number] => {
      const match = value.match(/^(\d+)[gGxXjJ](\d+[,.]?\d*)/)
      if (!match) return [999, 999]
      return [Number.parseInt(match[1], 10), Number.parseFloat(match[2].replace(',', '.'))]
    }
    const [aCore, aSection] = parse(a)
    const [bCore, bSection] = parse(b)
    return aCore !== bCore ? aCore - bCore : aSection - bSection
  })
}

interface Props {
  db: PriceDatabase | null
  currentUser: string | null
  isAdmin: boolean
  onDbChange: (db: PriceDatabase) => void
  onToast: (type: 'info' | 'error' | 'warn', message: string) => void
}

function compact(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function ComboField({
  label, value, options, placeholder, disabled, onChange,
}: {
  label: string; value: string; options: string[]; placeholder: string; disabled?: boolean; onChange: (v: string) => void
}) {
  const [inputVal, setInputVal] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setInputVal(value) }, [value])

  useEffect(() => {
    if (!open || !listRef.current) return
    const selected = listRef.current.querySelector<HTMLElement>('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'center' })
  }, [open])

  const filtered = useMemo(() => {
    const q = compact(inputVal)
    if (!q) return options
    return options.filter((o) => compact(o).includes(q))
  }, [inputVal, options])

  function select(opt: string) {
    onChange(opt)
    setInputVal(opt)
    setOpen(false)
  }

  function handleBlur(e: React.FocusEvent) {
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false)
      if (!options.includes(inputVal)) setInputVal(value)
    }
  }

  return (
    <div className="field" ref={wrapRef} style={{ position: 'relative' }} onBlur={handleBlur}>
      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8ea1ff' }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={inputVal}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          style={{ width: '100%', boxSizing: 'border-box', paddingRight: inputVal && !disabled ? 28 : undefined }}
          onChange={(e) => { setInputVal(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); setInputVal(value) }
            if (e.key === 'Enter' && filtered.length > 0) select(filtered[0])
            if (e.key === 'ArrowDown' && open) {
              const list = wrapRef.current?.querySelector<HTMLElement>('[data-combo-list]')
              ;(list?.firstElementChild as HTMLElement)?.focus()
            }
          }}
        />
        {inputVal && !disabled && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); select('') }}
            aria-label="Vider"
            style={{
              position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: '#3a4462', cursor: 'pointer',
              padding: 2, display: 'flex', alignItems: 'center', borderRadius: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#c8d4f0' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#3a4462' }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          data-combo-list
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: 'rgba(6,9,22,0.98)', border: '1px solid #2d3a5f', borderRadius: 10,
            marginTop: 4, maxHeight: 220, overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          {filtered.map((opt) => (
            <div
              key={opt}
              tabIndex={0}
              data-selected={opt === value ? 'true' : undefined}
              onMouseDown={() => select(opt)}
              onKeyDown={(e) => { if (e.key === 'Enter') select(opt) }}
              style={{
                padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                color: opt === value ? '#f59e0b' : '#c8d4f0',
                background: opt === value ? 'rgba(245,158,11,0.1)' : 'transparent',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = opt === value ? 'rgba(245,158,11,0.1)' : 'transparent' }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CableCalculator({ db, currentUser, isAdmin, onDbChange, onToast }: Props) {
  const initialState = useMemo(() => {
    const restored = loadPersistedState()
    if (restored.corrSection && restored.corrCalcIdx === null) {
      return { ...restored, corrCalcIdx: matchCalcSection(restored.corrSection) }
    }
    return restored
  }, [])

  const [corrType, setCorrType] = useState(initialState.corrType)
  const [corrSection, setCorrSection] = useState(initialState.corrSection)
  const [corrRefRef, setCorrRefRef] = useState(initialState.corrRefRef)
  const [corrCalcIdx, setCorrCalcIdx] = useState<number | null>(initialState.corrCalcIdx)
  const [corrMarge, setCorrMarge] = useState(initialState.corrMarge)
  const [corrTaux, setCorrTaux] = useState(initialState.corrTaux)
  const [corrQty, setCorrQty] = useState(initialState.corrQty)
  const [devisLines, setDevisLines] = useState<DevisLine[]>([])
  const [nextId, setNextId] = useState(1)
  const [sessions, setSessions] = useState<CalcSession[]>(() => loadSessions())
  const [sessionNameInput, setSessionNameInput] = useState('')
  const [showSessions, setShowSessions] = useState(false)
  const [showCableImport, setShowCableImport] = useState(false)

  const toolPanelStyle = {
    background: 'rgba(12,18,36,0.7)',
    border: '1px solid #1d2642',
    borderRadius: 16,
    padding: '14px 16px',
  } as const

  const cableTypeMap = useMemo(() => {
    if (!db) return {}
    const map: Record<string, Record<string, PriceItem[]>> = {}
    db.items
      .filter((item) => item.unit === 'm' && CABLE_CATS.includes(item.category ?? ''))
      .forEach((item) => {
        const match = item.name.match(SECTION_RE)
        if (!match) return
        const sectionStart = item.name.indexOf(match[0])
        const type = item.name.substring(0, sectionStart).trim()
        if (!type) return
        const section = match[1].toUpperCase().replace('.', ',')
        if (!map[type]) map[type] = {}
        if (!map[type][section]) map[type][section] = []
        map[type][section].push(item)
      })
    return map
  }, [db])

  const cableTypes = useMemo(() => Object.keys(cableTypeMap).sort(), [cableTypeMap])
  const sectionsForType = useMemo(() => {
    if (!corrType || !cableTypeMap[corrType]) return []
    return sortSections(Object.keys(cableTypeMap[corrType]))
  }, [cableTypeMap, corrType])
  const currentSectionItems = useMemo(() => cableTypeMap[corrType]?.[corrSection] ?? [], [cableTypeMap, corrType, corrSection])
  const corrRef = useMemo(() => currentSectionItems.find((item) => item.ref === corrRefRef) ?? null, [corrRefRef, currentSectionItems])

  const corrCalcCable = corrCalcIdx !== null ? CABLES[corrCalcIdx] : null
  const corrPrixAchat = corrRef?.price ?? null
  const corrPtMat = corrPrixAchat !== null ? corrPrixAchat * corrMarge : null
  const corrPtPose = corrCalcCable !== null ? corrCalcCable.tps_pose * corrTaux : null
  const corrPrixPose = corrPtMat !== null && corrPtPose !== null ? corrPtMat + corrPtPose : null

  useEffect(() => {
    if (!corrType || !corrSection) {
      if (corrRefRef) setCorrRefRef('')
      return
    }
    if (currentSectionItems.length === 0) {
      if (corrRefRef) setCorrRefRef('')
      return
    }
    if (!corrRefRef || !currentSectionItems.some((item) => item.ref === corrRefRef)) {
      const fallback = getDefaultRef(currentSectionItems)
      if (fallback) setCorrRefRef(fallback.ref)
    }
  }, [corrRefRef, corrSection, corrType, currentSectionItems])

  useEffect(() => {
    persistCalcState({ corrType, corrSection, corrRefRef, corrCalcIdx, corrMarge, corrTaux, corrQty })
  }, [corrCalcIdx, corrMarge, corrQty, corrRefRef, corrSection, corrTaux, corrType])

  function handleCorrTypeChange(type: string) {
    setCorrType(type)
    setCorrSection('')
    setCorrRefRef('')
    setCorrCalcIdx(null)
  }

  function handleCorrSectionChange(section: string) {
    setCorrSection(section)
    setCorrRefRef('')
    setCorrCalcIdx(matchCalcSection(section))
  }

  function handleMargeInput(value: string) {
    const parsed = Number.parseFloat(value)
    setCorrMarge(Number.isFinite(parsed) ? parsed : DEFAULT_MARGE)
  }

  function handleTauxInput(value: string) {
    const parsed = Number.parseFloat(value)
    setCorrTaux(Number.isFinite(parsed) ? parsed : DEFAULT_TAUX)
  }

  function handleQtyInput(value: string) {
    const parsed = Number.parseFloat(value)
    setCorrQty(Number.isFinite(parsed) ? Math.max(parsed, 0) : 0)
  }

  function handleAddToDevis() {
    if (corrPrixPose === null || !corrRef) return
    setDevisLines((prev) => [...prev, {
      id: nextId,
      label: `${corrType} ${corrSection}`,
      refRef: corrRef.ref,
      prixAchat: corrPrixAchat ?? 0,
      marge: corrMarge,
      ptMat: corrPtMat ?? 0,
      tpsPose: corrCalcCable?.tps_pose ?? 0,
      taux: corrTaux,
      ptPose: corrPtPose ?? 0,
      prixPose: corrPrixPose,
      qty: corrQty,
    }])
    setNextId((value) => value + 1)
  }

  async function handleExportDevis() {
    if (devisLines.length === 0) return
    const rows: (string | number)[][] = [
      ['Designation', 'Reference', 'Prix achat (EUR/ml)', 'Coeff marge', 'PT Mat (EUR/ml)', 'Tps pose (h/ml)', 'Taux (EUR/h)', 'PT Pose (EUR/ml)', 'Prix pose (EUR/ml)', 'Qte (ml)', 'Total (EUR)'],
      ...devisLines.map((line) => [line.label, line.refRef, line.prixAchat, line.marge, line.ptMat, line.tpsPose, line.taux, line.ptPose, line.prixPose, line.qty, line.prixPose * line.qty]),
      ['TOTAL', '', '', '', '', '', '', '', '', devisLines.reduce((sum, line) => sum + line.qty, 0), devisLines.reduce((sum, line) => sum + line.prixPose * line.qty, 0)],
    ]
    await window.api.exportSheet({ rows, filename: 'devis-cables.xlsx' })
  }

  function handleSaveSession() {
    const name = sessionNameInput.trim()
    if (!name || !corrType || !corrSection) return
    const next = [{
      name,
      savedAt: new Date().toISOString(),
      corrType,
      corrSection,
      corrRefRef,
      corrMarge,
      corrTaux,
      corrQty,
    }, ...sessions.filter((session) => session.name !== name)].slice(0, 10)
    setSessions(next)
    persistSessions(next)
    setSessionNameInput('')
  }

  function handleLoadSession(session: CalcSession) {
    setCorrType(session.corrType)
    setCorrSection(session.corrSection)
    setCorrRefRef(session.corrRefRef)
    setCorrCalcIdx(matchCalcSection(session.corrSection))
    setCorrMarge(session.corrMarge)
    setCorrTaux(session.corrTaux)
    setCorrQty(session.corrQty)
    setShowSessions(false)
  }

  function handleDeleteSession(name: string) {
    const next = sessions.filter((session) => session.name !== name)
    setSessions(next)
    persistSessions(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Calculateur principal</div>
            <h2>Chiffrage cable instantane</h2>
            <p className="hint">Le calculateur garde ton dernier contexte et te laisse partir soit du type/section, soit d'une recherche directe.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
            {isAdmin && (
              <button type="button" className="btn secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setShowCableImport(true)}>
                <RefreshCcw size={13} />
                Mise à jour prix câbles
              </button>
            )}
            <span className="pill readonly">Dernier contexte restaure</span>
            {corrType && corrSection && <span className="pill readonly">{corrType} / {corrSection}</span>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
          <ComboField
            label="Type de cable"
            value={corrType}
            options={cableTypes}
            placeholder="Ex : FR-N1X1G1, U1000R2V…"
            onChange={handleCorrTypeChange}
          />
          <ComboField
            label="Section"
            value={corrSection}
            options={sectionsForType}
            placeholder={corrType ? 'Ex : 3G2,5, 4G6…' : 'Choisir un type d\'abord'}
            disabled={!corrType}
            onChange={handleCorrSectionChange}
          />
          <div className="field">
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8ea1ff' }}>Reference</label>
            <select value={corrRefRef} onChange={(event) => setCorrRefRef(event.target.value)} disabled={!corrSection}>
              <option value="">- Choisir une reference -</option>
              {currentSectionItems.reduce<{ ref: string; displayName: string; price: number }[]>((acc, item) => {
                const base = item.name.replace(COND_RE, '').trim()
                if (!acc.find((entry) => entry.displayName === base)) acc.push({ ref: item.ref, displayName: base, price: item.price })
                return acc
              }, []).map((item) => <option key={item.ref} value={item.ref}>{item.displayName} - {item.price.toFixed(4)} EUR/ml</option>)}
            </select>
          </div>
        </div>

        {corrSection && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 16, alignItems: 'stretch' }}>

            {/* Fourniture */}
            <div style={toolPanelStyle}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Fourniture</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#9aa5c1', fontSize: 13 }}>Prix achat</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#f8fafc' }}>{corrPrixAchat !== null ? `${corrPrixAchat.toFixed(4)} EUR/ml` : '-'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#9aa5c1', fontSize: 13 }}>Coefficient marge</span>
                  <input type="number" value={corrMarge} step={0.01} min={1} onChange={(event) => handleMargeInput(event.target.value)} style={{ width: 82, background: 'rgba(12,18,36,0.9)', border: '1px solid #263255', borderRadius: 8, padding: '4px 8px', color: '#f59e0b', fontSize: 13, textAlign: 'right', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #1d2642' }}>
                  <span style={{ color: '#fb923c', fontWeight: 700, fontSize: 13 }}>PT materiel</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#fb923c', fontSize: 15 }}>{corrPtMat !== null ? `${corrPtMat.toFixed(4)} EUR/ml` : '-'}</span>
                </div>
              </div>
            </div>

            {/* Pose */}
            <div style={toolPanelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8ea1ff', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Pose</div>
                {corrCalcCable ? (
                  <span style={{ fontSize: 11, color: '#34d399', background: 'rgba(5,100,60,0.2)', padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(52,211,153,0.3)' }}>Match: {corrCalcCable.designation}</span>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#f87171' }}>Aucun match</span>
                    <select value={corrCalcIdx ?? ''} onChange={(event) => setCorrCalcIdx(event.target.value === '' ? null : Number.parseInt(event.target.value, 10))} style={{ fontSize: 11, background: 'rgba(12,18,36,0.8)', border: '1px solid #263255', borderRadius: 6, padding: '2px 6px', color: '#f8fafc', outline: 'none' }}>
                      <option value="">- selectionner -</option>
                      {CABLES.map((cable, index) => <option key={cable.row ?? index} value={index}>{cable.designation}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#9aa5c1', fontSize: 13 }}>Temps de pose</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#f8fafc' }}>{corrCalcCable ? `${corrCalcCable.tps_pose.toFixed(3)} h/ml` : '-'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#9aa5c1', fontSize: 13 }}>Taux horaire</span>
                  <input type="number" value={corrTaux} step={0.5} min={0} onChange={(event) => handleTauxInput(event.target.value)} style={{ width: 82, background: 'rgba(12,18,36,0.9)', border: '1px solid #263255', borderRadius: 8, padding: '4px 8px', color: '#22d3ee', fontSize: 13, textAlign: 'right', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid #1d2642' }}>
                  <span style={{ color: '#8ea1ff', fontWeight: 700, fontSize: 13 }}>PT pose</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#8ea1ff', fontSize: 15 }}>{corrPtPose !== null ? `${corrPtPose.toFixed(2)} EUR/ml` : '-'}</span>
                </div>
              </div>
            </div>

            {/* Prix pose — colonne hero */}
            <div style={{
              background: corrPrixPose !== null ? 'rgba(245,158,11,0.07)' : 'rgba(12,18,36,0.5)',
              border: corrPrixPose !== null ? '1px solid rgba(245,158,11,0.32)' : '1px solid #1a2240',
              borderRadius: 16,
              padding: '20px 22px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 18,
              transition: 'border-color 0.2s ease, background 0.2s ease',
            }}>
              {corrPrixPose !== null ? (
                <>
                  <div>
                    <div style={{ fontSize: 10, color: '#6b7fa8', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 6 }}>Prix pose</div>
                    <div style={{ fontSize: 52, fontWeight: 800, color: '#f59e0b', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {corrPrixPose.toFixed(2)}<span style={{ fontSize: 17, fontWeight: 400, color: '#6b7fa8', marginLeft: 6 }}>EUR/ml</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 12 }}>
                      <span style={{ color: '#9aa5c1' }}>Mat <strong style={{ color: '#fb923c', fontVariantNumeric: 'tabular-nums' }}>{corrPtMat?.toFixed(2)}</strong></span>
                      <span style={{ color: '#2d3a5f' }}>+</span>
                      <span style={{ color: '#9aa5c1' }}>Pose <strong style={{ color: '#8ea1ff', fontVariantNumeric: 'tabular-nums' }}>{corrPtPose?.toFixed(2)}</strong></span>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(245,158,11,0.18)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="number" value={corrQty} min={0} step={1} onChange={(event) => handleQtyInput(event.target.value)} style={{ width: 72, background: 'rgba(12,18,36,0.9)', border: '1px solid #164e63', borderRadius: 8, padding: '5px 8px', color: '#22d3ee', fontSize: 14, textAlign: 'right', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
                      <span style={{ fontSize: 12, color: '#6b7fa8' }}>ml</span>
                      <span style={{ fontSize: 20, fontWeight: 800, color: '#34d399', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{(corrPrixPose * corrQty).toFixed(2)} EUR</span>
                    </div>
                    <button type="button" className="btn primary" style={{ justifyContent: 'center', fontSize: 13 }} onClick={handleAddToDevis}>
                      + Ajouter au devis
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '12px 0', color: '#2d3a5f', fontSize: 12, lineHeight: 1.6 }}>
                  Selectionnez type, section<br />et reference pour voir<br />le prix pose
                </div>
              )}
            </div>

          </div>
        )}

        <SessionsPanel
          sessions={sessions}
          nameInput={sessionNameInput}
          onNameChange={setSessionNameInput}
          onSave={handleSaveSession}
          onLoad={handleLoadSession}
          onDelete={handleDeleteSession}
          showSessions={showSessions}
          onToggle={() => setShowSessions((value) => !value)}
          disableSave={!sessionNameInput.trim() || !corrType || !corrSection}
        />
      </div>

      {devisLines.length > 0 && (
        <DevisPanel
          lines={devisLines}
          onQtyChange={(id, qty) => setDevisLines((prev) => prev.map((line) => (line.id === id ? { ...line, qty } : line)))}
          onRemove={(id) => setDevisLines((prev) => prev.filter((line) => line.id !== id))}
          onClear={() => setDevisLines([])}
          onExport={() => void handleExportDevis()}
        />
      )}

      <TableDesPrix />

      {showCableImport && db && currentUser && (
        <CablePrixImportModal
          db={db}
          currentUser={currentUser}
          onClose={() => setShowCableImport(false)}
          onImported={(nextDb) => { onDbChange(nextDb); setShowCableImport(false) }}
          onToast={onToast}
        />
      )}
    </div>
  )
}
