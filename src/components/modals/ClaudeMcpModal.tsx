import { useState } from 'react'
import { Check, Copy, MessageSquare, Power, RefreshCcw, ShieldCheck, Sparkles } from 'lucide-react'

export const CLAUDE_INTRO_HIDDEN_KEY = 'nexus-claude-intro-hidden'

const EXAMPLES = [
  'cherche un disjoncteur 16A dans NEXUS',
  'chiffre 50 m de U1000 R2V 3G2,5',
]

interface Props {
  initialHide: boolean
  onClose: (hideNextTime: boolean) => void
}

const stepIcon = {
  width: 34,
  height: 34,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
} as const

export default function ClaudeMcpModal({ initialHide, onClose }: Props) {
  const [hide, setHide] = useState(initialHide)
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied((value) => (value === text ? null : value)), 1500)
    } catch {
      /* presse-papiers indisponible : sans importance */
    }
  }

  const steps = [
    {
      icon: <RefreshCcw size={16} />,
      color: '#34d399',
      bg: 'rgba(52,211,153,0.12)',
      title: 'Mettez NEXUS à jour et ouvrez-le une fois.',
      done: true,
    },
    {
      icon: <Power size={16} />,
      color: '#8ea1ff',
      bg: 'rgba(142,161,255,0.12)',
      title: 'Quittez complètement Claude Desktop et relancez-le.',
      detail: 'Clic droit sur l’icône Claude près de l’horloge, puis Quitter.',
    },
    {
      icon: <MessageSquare size={16} />,
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.12)',
      title: 'Demandez à Claude, par exemple :',
      examples: true,
    },
  ]

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(hide) }}>
      <div className="modal" style={{ width: 'min(580px, 92vw)', overflow: 'hidden' }}>
        <div style={{
          padding: '22px 22px 18px',
          background: 'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.18) 0%, rgba(142,161,255,0.08) 45%, transparent 75%)',
          borderBottom: '1px solid #1d2642',
          display: 'flex',
          gap: 14,
          alignItems: 'center',
        }}>
          <div style={{
            ...stepIcon,
            width: 46,
            height: 46,
            borderRadius: 14,
            background: 'linear-gradient(135deg, #f59e0b, #fb923c)',
            color: '#0b0f1e',
            boxShadow: '0 8px 24px rgba(245,158,11,0.35)',
          }}>
            <Sparkles size={22} />
          </div>
          <div>
            <div className="eyebrow">Nouveau</div>
            <h3 style={{ margin: '4px 0 0', fontSize: 19, color: '#f8fafc' }}>Pour utiliser NEXUS dans Claude</h3>
          </div>
        </div>

        <div className="modal-body" style={{ gap: 10, padding: '18px 22px' }}>
          {steps.map((step, index) => (
            <div key={step.title} style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'rgba(12,18,36,0.7)',
              border: '1px solid #1d2642',
            }}>
              <div style={{ ...stepIcon, background: step.bg, color: step.color }}>{step.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: step.color }}>{index + 1}.</span>
                  <span style={{ color: '#e5e9f4', fontSize: 14, fontWeight: 600 }}>{step.title}</span>
                  {step.done && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 999, padding: '1px 8px' }}>
                      <Check size={11} /> C’est fait
                    </span>
                  )}
                </div>
                {step.detail && <div className="hint" style={{ marginTop: 4 }}>{step.detail}</div>}
                {step.examples && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => void copy(example)}
                        title="Copier"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(245,158,11,0.28)',
                          background: 'rgba(245,158,11,0.06)',
                          color: '#fde68a',
                          fontSize: 13,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <span>« {example} »</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: copied === example ? '#34d399' : '#6b7fa8', flexShrink: 0 }}>
                          {copied === example ? <><Check size={12} /> Copié</> : <><Copy size={12} /> Copier</>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          <div style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(52,211,153,0.06)',
            border: '1px solid rgba(52,211,153,0.22)',
          }}>
            <div style={{ ...stepIcon, background: 'rgba(52,211,153,0.12)', color: '#34d399' }}><ShieldCheck size={16} /></div>
            <div style={{ color: '#c8d4f0', fontSize: 13, lineHeight: 1.55 }}>
              Claude peut aussi <strong style={{ color: '#f8fafc' }}>ajouter, modifier ou supprimer des références</strong> : il montre toujours ce qu’il va changer avant de l’écrire.
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '0 22px 20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9aa5c1', cursor: 'pointer' }}>
            <input type="checkbox" checked={hide} onChange={(event) => setHide(event.target.checked)} style={{ accentColor: '#f59e0b' }} />
            Ne pas montrer au prochain démarrage
          </label>
          <button type="button" className="btn primary" onClick={() => onClose(hide)}>
            C’est compris
          </button>
        </div>
      </div>
    </div>
  )
}
