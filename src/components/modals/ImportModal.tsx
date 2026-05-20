type ImportFieldKey = 'ref' | 'name' | 'unit' | 'price' | 'category' | 'supplier' | 'keywords'
type ImportMapping = Record<ImportFieldKey, number>

const IMPORT_FIELDS: Array<{ key: ImportFieldKey; label: string; required?: boolean }> = [
  { key: 'ref', label: 'Reference', required: true },
  { key: 'name', label: 'Libelle', required: true },
  { key: 'unit', label: 'Unite' },
  { key: 'price', label: 'Prix HT', required: true },
  { key: 'category', label: 'Categorie' },
  { key: 'supplier', label: 'Fournisseur' },
  { key: 'keywords', label: 'Mots-cles' },
]

interface Props {
  excelData: ExcelData
  importFilePath: string | null
  sheetNames: string[]
  selectedSheetName: string
  headerRowIndex: number
  importMode: 'replace' | 'skip'
  importMapping: ImportMapping
  onClose: () => void
  onConfirm: () => void
  onSheetChange: (sheet: string) => void
  onHeaderRowChange: (n: number) => void
  onModeChange: (mode: 'replace' | 'skip') => void
  onMappingChange: (key: ImportFieldKey, colIndex: number) => void
}

export default function ImportModal({
  excelData, importFilePath, sheetNames, selectedSheetName,
  headerRowIndex, importMode, importMapping,
  onClose, onConfirm, onSheetChange, onHeaderRowChange, onModeChange, onMappingChange,
}: Props) {
  const headerIndex = Math.max(1, Math.min(headerRowIndex, excelData.rows.length))
  const headerRow = excelData.rows[headerIndex - 1] ?? []
  const dataRows = excelData.rows.slice(headerIndex)
  const previewRow = dataRows[0] ?? []

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Import Excel</div>
            <h3>Mapper les colonnes</h3>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">
            Fichier: {importFilePath || '-'} | Colonnes: {excelData.columns.length} | Lignes: {excelData.rows.length}
          </p>
          <div className="details-grid">
            {sheetNames.length > 1 && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Feuille Excel ({sheetNames.length} disponibles)</label>
                <select value={selectedSheetName} onChange={(e) => onSheetChange(e.target.value)}>
                  {sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label>Ligne d'en-tete</label>
              <input
                type="number"
                min={1}
                max={excelData.rows.length}
                value={headerRowIndex}
                onChange={(e) => onHeaderRowChange(Number(e.target.value) || 1)}
              />
            </div>
            <div className="field">
              <label>Mode</label>
              <select value={importMode} onChange={(e) => onModeChange(e.target.value as 'replace' | 'skip')}>
                <option value="replace">Remplacer si ref existe</option>
                <option value="skip">Ignorer les doublons</option>
              </select>
            </div>
          </div>
          <div className="mapping-grid">
            {IMPORT_FIELDS.map((field) => {
              const previewValue = importMapping[field.key] >= 0 ? String(previewRow[importMapping[field.key]] ?? '') : ''
              return (
                <div key={field.key} className="mapping-row">
                  <div className="mapping-label">
                    {field.label} {field.required ? '*' : ''}
                  </div>
                  <select
                    value={importMapping[field.key]}
                    onChange={(e) => onMappingChange(field.key, Number(e.target.value))}
                  >
                    <option value={-1}>Ignorer</option>
                    {excelData.columns.map((col, index) => {
                      const headerLabel = String(headerRow[index] || '').trim()
                      const label = headerLabel ? `${col} - ${headerLabel}` : col
                      return (
                        <option key={col} value={index}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                  <div className="mapping-preview">{previewValue || '-'}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn primary" onClick={onConfirm}>
            Importer {dataRows.length} lignes
          </button>
        </div>
      </div>
    </div>
  )
}
