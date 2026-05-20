import { useState } from 'react'
import { Download, Upload, X } from 'lucide-react'

const TEMPLATE_HEADERS = ['ref', 'name', 'price', 'unit', 'category', 'supplier']
const TEMPLATE_EXAMPLES: (string | number)[][] = [
  ['', 'U1000R2V 3G1,5', 1.234, 'm', 'Câbles industriels rigides', 'Nexans'],
  ['', 'U1000R2V 3G2,5', 1.89, 'm', 'Câbles industriels rigides', 'Nexans'],
  ['REF-003', 'CR1-C1 2x1,5', 2.15, 'm', 'Câbles incendie', 'Belden'],
]

interface Props {
  db: PriceDatabase
  currentUser: string
  onClose: () => void
  onImported: (db: PriceDatabase) => void
  onToast: (type: 'info' | 'error' | 'warn', message: string) => void
}

type ColMap = Partial<Record<'ref' | 'name' | 'price' | 'unit' | 'category' | 'supplier', number>>

type PreviewStats = {
  updated: number
  added: number
  skipped: number
  rows: Array<[string, string, string, 'maj' | 'nouveau']>
}

function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function parsePrice(value: string | number | boolean | Date): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const s = String(value || '').trim().replace(',', '.')
  const match = s.match(/-?\d+(?:\.\d+)?/)
  if (!match) return 0
  const parsed = Number.parseFloat(match[0])
  return Number.isFinite(parsed) ? parsed : 0
}

function cellStr(value: string | number | boolean | Date | undefined): string {
  if (value === undefined || value === null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

function detectColMap(headerRow: Array<string | number | boolean | Date>): ColMap {
  const map: ColMap = {}
  for (const key of TEMPLATE_HEADERS as Array<keyof ColMap>) {
    const idx = headerRow.findIndex((h) => norm(cellStr(h)) === key)
    if (idx >= 0) map[key] = idx
  }
  return map
}

function computeStats(
  rows: Array<Array<string | number | boolean | Date>>,
  colMap: ColMap,
  db: PriceDatabase,
): PreviewStats {
  const byRef = new Map(db.items.map((item) => [norm(item.ref), item]))
  const byName = new Map(db.items.map((item) => [norm(item.name), item]))
  let updated = 0; let added = 0; let skipped = 0
  const previewRows: Array<[string, string, string, 'maj' | 'nouveau']> = []

  for (const row of rows) {
    const ref = colMap.ref !== undefined ? cellStr(row[colMap.ref]) : ''
    const name = colMap.name !== undefined ? cellStr(row[colMap.name]) : ''
    const price = colMap.price !== undefined ? parsePrice(row[colMap.price]) : 0
    if (!ref && !name) { skipped++; continue }

    const match = (ref ? byRef.get(norm(ref)) : null) ?? (name ? byName.get(norm(name)) : null)
    if (match) {
      updated++
      if (previewRows.length < 5) previewRows.push([match.ref, name || match.name, price.toFixed(4), 'maj'])
    } else {
      if (!name) { skipped++; continue }
      added++
      if (previewRows.length < 5) previewRows.push([ref || '(auto)', name, price.toFixed(4), 'nouveau'])
    }
  }

  return { updated, added, skipped, rows: previewRows }
}

export default function CablePrixImportModal({ db, currentUser, onClose, onImported, onToast }: Props) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [dataRows, setDataRows] = useState<Array<Array<string | number | boolean | Date>>>([])
  const [colMap, setColMap] = useState<ColMap>({})
  const [stats, setStats] = useState<PreviewStats | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleDownloadTemplate() {
    try {
      await window.api.exportSheet({
        rows: [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES],
        filename: 'modele-prix-cables.xlsx',
      })
    } catch {
      onToast('error', 'Erreur lors du téléchargement du modèle')
    }
  }

  async function handlePickFile() {
    setLoading(true)
    try {
      const filePath = await window.api.pickExcelFile()
      if (!filePath) return
      const data = await window.api.importExcel(filePath, '')
      if (!data.rows.length) {
        onToast('warn', 'Fichier vide ou non lisible')
        return
      }
      const detected = detectColMap(data.rows[0])
      if (detected.name === undefined && detected.ref === undefined) {
        onToast('warn', 'Colonnes non détectées — utilise le modèle fourni')
        return
      }
      const rows = data.rows.slice(1)
      setDataRows(rows)
      setColMap(detected)
      setFileName(filePath.split('\\').pop() ?? filePath)
      setStats(computeStats(rows, detected, db))
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : 'Erreur lecture fichier')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!stats || stats.updated + stats.added === 0) return
    setLoading(true)
    try {
      const byRef = new Map(db.items.map((item) => [norm(item.ref), item]))
      const byName = new Map(db.items.map((item) => [norm(item.name), item]))
      const now = new Date().toISOString()
      const nextItems: PriceItem[] = db.items.map((item) => ({ ...item }))
      const itemIdxByRef = new Map(nextItems.map((item, i) => [norm(item.ref), i]))
      let autoIdx = 0

      for (const row of dataRows) {
        const ref = colMap.ref !== undefined ? cellStr(row[colMap.ref]) : ''
        const name = colMap.name !== undefined ? cellStr(row[colMap.name]) : ''
        const price = colMap.price !== undefined ? parsePrice(row[colMap.price]) : 0
        const unit = colMap.unit !== undefined ? cellStr(row[colMap.unit]) || 'm' : 'm'
        const category = colMap.category !== undefined ? cellStr(row[colMap.category]) : ''
        const supplier = colMap.supplier !== undefined ? cellStr(row[colMap.supplier]) : ''
        if (!ref && !name) continue

        const match = (ref ? byRef.get(norm(ref)) : null) ?? (name ? byName.get(norm(name)) : null)
        if (match) {
          const idx = itemIdxByRef.get(norm(match.ref))
          if (idx !== undefined) {
            const prev = nextItems[idx]
            const historyEntry: PriceHistoryEntry | null = prev.price !== price
              ? { price: prev.price, updatedAt: prev.updatedAt ?? now, updatedBy: prev.updatedBy ?? 'inconnu' }
              : null
            nextItems[idx] = {
              ...prev,
              price,
              updatedAt: now,
              updatedBy: currentUser,
              history: historyEntry
                ? [historyEntry, ...(prev.history ?? [])].slice(0, 10)
                : (prev.history ?? []),
            }
          }
        } else {
          if (!name) continue
          const newRef = ref || `CABLE-${Date.now()}-${autoIdx++}`
          nextItems.push({ ref: newRef, name, price, unit, category, supplier, keywords: [], updatedAt: now, updatedBy: currentUser })
        }
      }

      const nextDb: PriceDatabase = {
        ...db,
        meta: { ...db.meta, updatedAt: now, updatedBy: currentUser },
        items: nextItems,
      }
      await window.api.backupPrices()
      await window.api.savePrices({ db: nextDb, user: currentUser })
      onImported(nextDb)
      onToast('info', `Prix câbles mis à jour : ${stats.updated} modifiés, ${stats.added} ajoutés`)
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : 'Erreur enregistrement')
    } finally {
      setLoading(false)
    }
  }

  const total = (stats?.updated ?? 0) + (stats?.added ?? 0)

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Import câbles</div>
            <h3>Mise à jour des prix câbles</h3>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Étape 1 */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8ea1ff', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Étape 1 — Télécharger le modèle
            </div>
            <p className="hint" style={{ marginBottom: 10 }}>
              Remplis ce fichier avec tes prix. La colonne <strong>name</strong> (désignation) est obligatoire.
              La colonne <strong>ref</strong> est optionnelle — si absente, la désignation sert de clé de correspondance.
            </p>
            <button type="button" className="btn ghost" onClick={() => void handleDownloadTemplate()}>
              <Download size={14} />
              Télécharger modele-prix-cables.xlsx
            </button>
          </div>

          {/* Étape 2 */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8ea1ff', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Étape 2 — Importer le fichier rempli
            </div>
            <button type="button" className="btn secondary" onClick={() => void handlePickFile()} disabled={loading}>
              <Upload size={14} />
              {loading ? 'Lecture...' : 'Choisir un fichier Excel'}
            </button>
            {fileName && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#34d399' }}>✓ {fileName}</div>
            )}
          </div>

          {/* Résultat attendu */}
          {stats && (
            <div style={{ background: 'rgba(12,18,36,0.6)', border: '1px solid #1d2642', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', gap: 24, marginBottom: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13 }}>
                  <strong style={{ color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>{stats.updated}</strong>
                  <span style={{ color: '#9aa5c1' }}> mis à jour</span>
                </span>
                <span style={{ fontSize: 13 }}>
                  <strong style={{ color: '#8ea1ff', fontVariantNumeric: 'tabular-nums' }}>{stats.added}</strong>
                  <span style={{ color: '#9aa5c1' }}> nouveaux</span>
                </span>
                <span style={{ fontSize: 13 }}>
                  <strong style={{ color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>{stats.skipped}</strong>
                  <span style={{ color: '#9aa5c1' }}> ignorés (sans désignation)</span>
                </span>
              </div>

              {stats.rows.length > 0 && (
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: '#64748b', marginBottom: 6 }}>Aperçu :</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Référence', 'Désignation', 'Prix EUR/ml', 'Action'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '3px 8px', borderBottom: '1px solid #1d2642', color: '#64748b', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.rows.map((row, i) => (
                        <tr key={i}>
                          <td style={{ padding: '3px 8px', color: '#9aa5c1', fontVariantNumeric: 'tabular-nums' }}>{row[0]}</td>
                          <td style={{ padding: '3px 8px', color: '#f8fafc' }}>{row[1]}</td>
                          <td style={{ padding: '3px 8px', color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{row[2]}</td>
                          <td style={{ padding: '3px 8px', color: row[3] === 'maj' ? '#34d399' : '#8ea1ff', fontWeight: 600 }}>
                            {row[3] === 'maj' ? '↑ mise à jour' : '+ nouveau'}
                          </td>
                        </tr>
                      ))}
                      {(stats.updated + stats.added) > 5 && (
                        <tr>
                          <td colSpan={4} style={{ padding: '3px 8px', color: '#64748b', fontStyle: 'italic' }}>
                            ... et {total - 5} autres
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          {stats && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleConfirm()}
              disabled={loading || total === 0}
            >
              {loading ? 'Enregistrement...' : `Confirmer (${total} articles)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
