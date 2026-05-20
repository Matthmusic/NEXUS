interface Props {
  configDraft: AppConfig
  onDraftChange: (next: AppConfig) => void
  onSave: () => void
  onClose: () => void
}

export default function ConfigModal({ configDraft, onDraftChange, onSave, onClose }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Parametres</div>
            <h3>Configuration</h3>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>Fermer</button>
        </div>
        <div className="modal-body">
          <div className="details-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Dossier de donnees</label>
              <input
                value={configDraft.dataDir}
                onChange={(e) => onDraftChange({ ...configDraft, dataDir: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Timeout admin (minutes)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={configDraft.lockTimeoutMin}
                onChange={(e) => onDraftChange({ ...configDraft, lockTimeoutMin: Number(e.target.value) || 10 })}
              />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="button" className="btn primary" onClick={onSave}>Sauvegarder</button>
        </div>
      </div>
    </div>
  )
}
