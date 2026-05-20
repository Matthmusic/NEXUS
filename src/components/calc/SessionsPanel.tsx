import type { CalcSession } from './types'

interface Props {
  sessions: CalcSession[]
  nameInput: string
  onNameChange: (v: string) => void
  onSave: () => void
  onLoad: (session: CalcSession) => void
  onDelete: (name: string) => void
  showSessions: boolean
  onToggle: () => void
  disableSave: boolean
}

export default function SessionsPanel({
  sessions, nameInput, onNameChange, onSave, onLoad, onDelete,
  showSessions, onToggle, disableSave,
}: Props) {
  return (
    <>
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #1d2642', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={nameInput}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSave()}
          placeholder="Nom de la session..."
          style={{ flex: 1, minWidth: 160, background: 'rgba(12,18,36,0.7)', border: '1px solid #263255', borderRadius: 10, padding: '7px 12px', color: '#f8fafc', fontSize: 13, outline: 'none' }}
        />
        <button type="button" className="btn ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={onSave} disabled={disableSave}>
          💾 Sauvegarder
        </button>
        {sessions.length > 0 && (
          <button type="button" className={`btn ${showSessions ? 'secondary' : 'ghost'}`} style={{ fontSize: 12, padding: '6px 12px' }} onClick={onToggle}>
            📂 Sessions ({sessions.length})
          </button>
        )}
      </div>
      {showSessions && sessions.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sessions.map((s) => (
            <div key={s.name} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(12,18,36,0.5)', borderRadius: 10, padding: '8px 12px' }}>
              <button type="button" className="btn ghost" style={{ flex: 1, fontSize: 12, padding: '4px 10px', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => onLoad(s)}>
                <strong style={{ color: '#f8fafc' }}>{s.name}</strong>
                <span style={{ color: '#64748b', marginLeft: 10 }}>{s.corrType} {s.corrSection} · {new Date(s.savedAt).toLocaleDateString('fr-FR')}</span>
              </button>
              <button type="button" className="btn danger" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => onDelete(s.name)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
