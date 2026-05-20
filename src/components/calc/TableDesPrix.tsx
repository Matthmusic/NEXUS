import { useMemo, useState } from 'react'
import { CABLES } from './cableData'
import { thS, tdS } from './styles'
import type { Overrides } from './types'

export default function TableDesPrix() {
  const [overrides, setOverrides] = useState<Overrides>({})
  const [useGlobal, setUseGlobal] = useState(false)
  const [globalMarge, setGlobalMarge] = useState(1.4)
  const [globalTaux, setGlobalTaux] = useState(50)
  const [qty, setQty] = useState(1)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [tableOpen, setTableOpen] = useState(false)
  const [modal, setModal] = useState<{ idx: number; field: 'marge' | 'taux' } | null>(null)
  const [modalValue, setModalValue] = useState('')

  const cats = useMemo(() => [...new Set(CABLES.map((c) => c.categorie))].sort(), [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return CABLES.map((c, i) => ({ c, i })).filter(({ c }) => {
      const matchSearch = !q || c.designation.toLowerCase().includes(q) || c.categorie.toLowerCase().includes(q)
      const matchCat = !catFilter || c.categorie === catFilter
      return matchSearch && matchCat
    })
  }, [search, catFilter])

  function getEffective(idx: number) {
    const cable = CABLES[idx]
    const ov = overrides[idx] || {}
    return {
      marge: ov.marge !== undefined ? ov.marge : useGlobal ? globalMarge : cable.marge,
      taux: ov.taux !== undefined ? ov.taux : useGlobal ? globalTaux : cable.pu_pose,
    }
  }

  function calc(idx: number) {
    const cable = CABLES[idx]
    const { marge, taux } = getEffective(idx)
    const ptMat = cable.pu_materiel_eur_ml * marge
    const ptPose = cable.tps_pose * taux
    return { marge, taux, ptMat, ptPose, total: ptMat + ptPose }
  }

  function openModal(idx: number, field: 'marge' | 'taux') {
    const { marge, taux } = getEffective(idx)
    setModal({ idx, field })
    setModalValue((field === 'marge' ? marge : taux).toFixed(2))
  }

  function applyModal() {
    if (!modal) return
    const val = parseFloat(modalValue)
    if (isNaN(val) || val <= 0) return
    setOverrides((prev) => ({ ...prev, [modal.idx]: { ...(prev[modal.idx] || {}), [modal.field]: val } }))
    setModal(null)
  }

  function resetModal() {
    if (!modal) return
    setOverrides((prev) => {
      const next = { ...prev }
      if (next[modal.idx]) {
        const ov = { ...next[modal.idx] }
        delete ov[modal.field]
        if (Object.keys(ov).length === 0) delete next[modal.idx]
        else next[modal.idx] = ov
      }
      return next
    })
    setModal(null)
  }

  function resetAll() {
    setOverrides({})
    setGlobalMarge(1.4)
    setGlobalTaux(50)
    setQty(1)
    setUseGlobal(false)
    setSearch('')
    setCatFilter('')
  }

  function exportCSV() {
    const headers = [
      'Désignation', 'Catégorie', 'PU Matériel (€/ml)', 'Marge', 'PT Matériel (€/ml)',
      'Tps Pose (h/ml)', 'Taux/h (€/h)', 'PT Pose (€/ml)', 'Total /ml (€)', `Total (${qty} ml) (€)`,
    ]
    const rows = CABLES.map((c, i) => {
      const { marge, taux, ptMat, ptPose, total } = calc(i)
      return [c.designation, c.categorie, c.pu_materiel_eur_ml, marge.toFixed(2), ptMat.toFixed(4),
        c.tps_pose, taux.toFixed(2), ptPose.toFixed(2), total.toFixed(2), (total * qty).toFixed(2)]
    })
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'prix_cables.csv'
    a.click()
  }

  const pct = Math.round((globalMarge - 1) * 100)
  const modCount = Object.keys(overrides).length
  const modalCable = modal !== null ? CABLES[modal.idx] : null

  return (
    <>
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Accordéon header */}
        <button
          type="button"
          onClick={() => setTableOpen((o) => !o)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: tableOpen ? '1px solid #1d2642' : 'none' }}
        >
          <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>Table des prix</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>{CABLES.length} références</span>
          {modCount > 0 && (
            <span style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(245,158,11,0.3)' }}>
              {modCount} modif.
            </span>
          )}
          {!tableOpen && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Marge <strong style={{ color: '#f59e0b' }}>×{globalMarge.toFixed(2)}</strong>
                {' · '}Taux <strong style={{ color: '#22d3ee' }}>{globalTaux} €/h</strong>
                {useGlobal && <span style={{ color: '#f59e0b', marginLeft: 6 }}>● actives</span>}
              </span>
            </div>
          )}
          <span style={{ marginLeft: tableOpen ? 'auto' : 0, fontSize: 11, color: '#64748b', fontWeight: 700 }}>
            {tableOpen ? '▲ Réduire' : '▼ Développer'}
          </span>
        </button>

        {tableOpen && (
          <>
            {/* Variables globales */}
            <div style={{ padding: '10px 18px', borderBottom: '1px solid #1d2642', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', background: 'rgba(10,14,28,0.5)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 10px', border: '1px solid #1d2642', borderRadius: 10, background: useGlobal ? 'rgba(245,158,11,0.08)' : 'transparent', transition: 'all 0.2s' }}>
                <div style={{ position: 'relative', width: 34, height: 19 }}>
                  <input type="checkbox" checked={useGlobal} onChange={(e) => setUseGlobal(e.target.checked)} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 10, background: useGlobal ? '#f59e0b' : '#263255', transition: 'background 0.2s' }} />
                  <div style={{ position: 'absolute', top: 2, left: useGlobal ? 17 : 2, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </div>
                <span style={{ fontWeight: 600, color: useGlobal ? '#f59e0b' : '#9aa5c1', fontSize: 12, transition: 'color 0.2s' }}>Globales actives</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9aa5c1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Marge</span>
                <input type="number" value={globalMarge} step={0.01} min={1} max={5}
                  onChange={(e) => setGlobalMarge(parseFloat(e.target.value) || 1.4)}
                  style={{ width: 72, background: 'rgba(12,18,36,0.8)', border: '1px solid #263255', borderRadius: 8, padding: '5px 8px', color: '#f8fafc', fontSize: 13, textAlign: 'center', outline: 'none' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: pct >= 0 ? '#f59e0b' : '#f87171', background: pct >= 0 ? 'rgba(245,158,11,0.1)' : 'rgba(248,113,113,0.1)', padding: '2px 6px', borderRadius: 5 }}>
                  {pct >= 0 ? '+' : ''}{pct}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9aa5c1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Taux/h</span>
                <input type="number" value={globalTaux} step={0.5} min={0} max={999}
                  onChange={(e) => setGlobalTaux(parseFloat(e.target.value) || 50)}
                  style={{ width: 72, background: 'rgba(12,18,36,0.8)', border: '1px solid #263255', borderRadius: 8, padding: '5px 8px', color: '#f8fafc', fontSize: 13, textAlign: 'center', outline: 'none' }} />
                <span style={{ fontSize: 11, color: '#9aa5c1' }}>€/h</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12, borderLeft: '1px solid #1d2642' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#22d3ee', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Qté</span>
                <input type="number" value={qty} step={1} min={0}
                  onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
                  style={{ width: 72, background: 'rgba(12,18,36,0.8)', border: '1px solid #164e63', borderRadius: 8, padding: '5px 8px', color: '#22d3ee', fontSize: 13, textAlign: 'center', outline: 'none' }} />
                <span style={{ fontSize: 11, color: '#22d3ee' }}>ml</span>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={resetAll}>↺ Réinit.</button>
                <button type="button" className="btn ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={exportCSV}>⬇ CSV</button>
              </div>
            </div>

            {/* Filtres */}
            <div style={{ padding: '10px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #1d2642' }}>
              <input className="search-input" style={{ maxWidth: 200, padding: '7px 12px' }} placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
                style={{ background: 'rgba(12,18,36,0.7)', border: '1px solid #263255', borderRadius: 10, padding: '7px 10px', color: '#f8fafc', fontSize: 13, outline: 'none' }}>
                <option value="">Toutes les familles</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span style={{ fontSize: 12, color: '#64748b' }}>{filtered.length} câble(s)</span>
            </div>

            {/* Table scrollable */}
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={thS}>Désignation</th>
                    <th style={thS}>Catégorie</th>
                    <th style={{ ...thS, textAlign: 'right' }}>PU Mat.<br /><span style={{ fontWeight: 400, color: '#64748b' }}>(€/ml achat)</span></th>
                    <th style={{ ...thS, textAlign: 'right', cursor: 'help' }} title="Cliquez pour modifier">Marge ✏</th>
                    <th style={{ ...thS, textAlign: 'right', color: '#8ea1ff' }}>PT Mat.<br /><span style={{ fontWeight: 400, color: '#64748b' }}>(€/ml)</span></th>
                    <th style={{ ...thS, textAlign: 'right' }}>Tps Pose<br /><span style={{ fontWeight: 400, color: '#64748b' }}>(h/ml)</span></th>
                    <th style={{ ...thS, textAlign: 'right', cursor: 'help' }} title="Cliquez pour modifier">Taux/h ✏</th>
                    <th style={{ ...thS, textAlign: 'right', color: '#8ea1ff' }}>PT Pose<br /><span style={{ fontWeight: 400, color: '#64748b' }}>(€/ml)</span></th>
                    <th style={{ ...thS, textAlign: 'right', color: '#fb923c' }}>TOTAL /ml</th>
                    <th style={{ ...thS, textAlign: 'right', color: '#34d399' }}>TOTAL ({qty} ml)</th>
                    <th style={{ ...thS, textAlign: 'center', width: 44 }}>↺</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ c, i }, ri) => {
                    const { marge, taux, ptMat, ptPose, total } = calc(i)
                    const ov = overrides[i] || {}
                    const hasMOv = ov.marge !== undefined
                    const hasTOv = ov.taux !== undefined
                    const hasOv = hasMOv || hasTOv
                    const rowBg = ri % 2 === 0 ? 'transparent' : 'rgba(12,18,36,0.4)'
                    return (
                      <tr key={`${c.row}-${i}`} style={{ borderBottom: '1px solid #1a2240', background: rowBg, transition: 'background 0.1s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(245,158,11,0.05)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}>
                        <td style={tdS}><strong style={{ color: '#f8fafc' }}>{c.designation}</strong></td>
                        <td style={tdS}><span style={{ fontSize: 11, color: '#8ea1ff', background: 'rgba(99,110,255,0.12)', padding: '2px 7px', borderRadius: 5 }}>{c.categorie}</span></td>
                        <td style={{ ...tdS, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#9aa5c1' }}>{c.pu_materiel_eur_ml.toFixed(4)}</td>
                        <td style={{ ...tdS, textAlign: 'right', cursor: 'pointer', color: hasMOv ? '#f59e0b' : '#cbd5f4', fontWeight: hasMOv ? 700 : 400 }} onClick={() => openModal(i, 'marge')} title="Cliquer pour modifier">
                          {marge.toFixed(2)}{hasMOv ? ' ✏' : ''}
                        </td>
                        <td style={{ ...tdS, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#c7d3ff', background: 'rgba(99,110,255,0.06)' }}>{ptMat.toFixed(4)}</td>
                        <td style={{ ...tdS, textAlign: 'right', color: '#9aa5c1' }}>{c.tps_pose.toFixed(3)}</td>
                        <td style={{ ...tdS, textAlign: 'right', cursor: 'pointer', color: hasTOv ? '#f59e0b' : '#cbd5f4', fontWeight: hasTOv ? 700 : 400 }} onClick={() => openModal(i, 'taux')} title="Cliquer pour modifier">
                          {taux.toFixed(2)}{hasTOv ? ' ✏' : ''}
                        </td>
                        <td style={{ ...tdS, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#c7d3ff', background: 'rgba(99,110,255,0.06)' }}>{ptPose.toFixed(2)}</td>
                        <td style={{ ...tdS, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#fb923c', fontWeight: 700, background: 'rgba(180,80,10,0.1)' }}>{total.toFixed(2)} €</td>
                        <td style={{ ...tdS, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#34d399', fontWeight: 700, background: 'rgba(5,100,60,0.1)' }}>{(total * qty).toFixed(2)} €</td>
                        <td style={{ ...tdS, textAlign: 'center' }}>
                          {hasOv ? (
                            <button type="button" onClick={() => { const next = { ...overrides }; delete next[i]; setOverrides(next) }}
                              style={{ fontSize: 14, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }} title="Remettre les valeurs originales">↺</button>
                          ) : <span style={{ color: '#1d2642' }}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal édition */}
      {modal !== null && modalCable && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="modal" style={{ width: 360, maxHeight: 'unset' }}>
            <div className="modal-head">
              <div>
                <div className="eyebrow">{modal.field === 'marge' ? 'Coefficient de marge' : 'Taux horaire'}</div>
                <h3>{modalCable.designation}</h3>
              </div>
              <button type="button" className="btn ghost" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>{modal.field === 'marge' ? 'Marge (coefficient)' : 'Taux horaire (€/h)'}</label>
                <input
                  type="number"
                  value={modalValue}
                  step={modal.field === 'marge' ? 0.01 : 0.5}
                  autoFocus
                  onChange={(e) => setModalValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyModal(); if (e.key === 'Escape') setModal(null) }}
                />
              </div>
              <p className="hint" style={{ fontSize: 11 }}>
                Valeur originale : <strong style={{ color: '#f8fafc' }}>{modal.field === 'marge' ? modalCable.marge : modalCable.pu_pose}</strong>
                {useGlobal && <> · Globale : <strong style={{ color: '#f59e0b' }}>{modal.field === 'marge' ? globalMarge.toFixed(2) : globalTaux.toFixed(2)}</strong></>}
                {(overrides[modal.idx] || {})[modal.field] !== undefined && <> · Surcharge : <strong style={{ color: '#f59e0b' }}>{((overrides[modal.idx] || {})[modal.field] as number).toFixed(2)}</strong></>}
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn ghost" onClick={resetModal}>Remettre original</button>
              <button type="button" className="btn primary" onClick={applyModal}>Appliquer</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
