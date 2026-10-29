import { AlertCircle, Download, RefreshCcw, Sparkles, X } from 'lucide-react'

// Notes de version GitHub (HTML) -> quelques lignes de texte lisibles.
function formatReleaseNotes(notes?: string) {
  if (!notes) return []
  const text = notes
    .replace(/<\/(li|p|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  return text
    .split('\n')
    .map((line) => line.replace(/^[\s*•-]+/, '').replace(/\s+by @\S+ in \S+$/i, '').trim())
    .filter((line) => line && !/^(what's changed|full changelog|new contributors)/i.test(line) && !/^https?:\/\//.test(line))
    .slice(0, 5)
}

function mb(bytes?: number) {
  return bytes ? (bytes / 1024 / 1024).toFixed(1) : '0'
}

interface Props {
  update: UpdateState
  onDismiss: () => void
  onDownload: () => void
  onInstall: () => void
}

export default function UpdateNotification({ update, onDismiss, onDownload, onInstall }: Props) {
  const { state } = update
  const notes = formatReleaseNotes(update.releaseNotes)
  const percent = Math.max(0, Math.min(100, update.progress?.percent ?? 0))

  const accent = state === 'error' ? '#f87171' : state === 'downloaded' ? '#34d399' : '#f59e0b'
  const title = state === 'error'
    ? 'Erreur de mise à jour'
    : state === 'downloaded'
      ? 'Mise à jour prête'
      : state === 'downloading'
        ? 'Téléchargement en cours'
        : 'Mise à jour disponible'
  const Icon = state === 'error' ? AlertCircle : state === 'downloaded' ? RefreshCcw : state === 'downloading' ? Download : Sparkles

  return (
    <div style={{
      position: 'fixed',
      top: 48,
      right: 16,
      zIndex: 45,
      width: 'min(380px, calc(100vw - 32px))',
      background: 'rgba(8,12,26,0.98)',
      border: `1px solid ${accent}55`,
      borderRadius: 16,
      boxShadow: `0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02), 0 0 40px ${accent}1f`,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        background: `linear-gradient(90deg, ${accent}26, transparent)`,
        borderBottom: '1px solid #1d2642',
      }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${accent}22`, color: accent }}>
          <Icon size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{title}</div>
          <div style={{ fontSize: 11, color: '#6b7fa8' }}>
            v{update.currentVersion}{update.version && update.version !== update.currentVersion ? ` → v${update.version}` : ''}
          </div>
        </div>
        <button type="button" className="btn ghost sm" onClick={onDismiss} title="Plus tard" style={{ padding: 4 }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {state === 'available' && (
          <>
            <div style={{ fontSize: 13, color: '#c8d4f0' }}>
              La version <strong style={{ color: '#f8fafc' }}>v{update.version}</strong> de NEXUS est disponible.
            </div>
            {notes.length > 0 && (
              <div style={{ background: 'rgba(12,18,36,0.8)', border: '1px solid #1d2642', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8ea1ff', marginBottom: 4 }}>Nouveautés</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9aa5c1', lineHeight: 1.5 }}>
                  {notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={onDownload}>
                <Download size={14} />
                Télécharger
              </button>
              <button type="button" className="btn ghost" onClick={onDismiss}>Plus tard</button>
            </div>
          </>
        )}

        {state === 'downloading' && (
          <>
            <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
              <div style={{ width: `${percent}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #f59e0b, #fb923c)', transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9aa5c1', fontVariantNumeric: 'tabular-nums' }}>
              <span>{Math.round(percent)} %</span>
              {update.progress?.total ? <span>{mb(update.progress.transferred)} / {mb(update.progress.total)} Mo</span> : <span>Préparation…</span>}
              {update.progress?.bytesPerSecond ? <span>{mb(update.progress.bytesPerSecond)} Mo/s</span> : null}
            </div>
            <div className="hint">Tu peux continuer à travailler pendant le téléchargement.</div>
          </>
        )}

        {state === 'downloaded' && (
          <>
            <div style={{ fontSize: 13, color: '#c8d4f0' }}>
              La version <strong style={{ color: '#f8fafc' }}>v{update.version}</strong> est téléchargée. NEXUS va se fermer, s'installer puis se relancer.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={onInstall}>
                <RefreshCcw size={14} />
                Redémarrer et installer
              </button>
              <button type="button" className="btn ghost" onClick={onDismiss}>Plus tard</button>
            </div>
            <div className="hint">Sinon, elle s'installera à la prochaine fermeture de NEXUS.</div>
          </>
        )}

        {state === 'error' && (
          <>
            <div style={{ fontSize: 13, color: '#c8d4f0' }}>Le téléchargement de la mise à jour a échoué.</div>
            {update.message && (
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#fca5a5', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, padding: '6px 8px', maxHeight: 80, overflow: 'auto', wordBreak: 'break-word' }}>
                {update.message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onDownload}>
                <RefreshCcw size={14} />
                Réessayer
              </button>
              <button type="button" className="btn ghost" onClick={onDismiss}>Fermer</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
