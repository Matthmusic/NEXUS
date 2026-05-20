import { thS, tdS } from './styles'
import type { DevisLine } from './types'

interface Props {
  lines: DevisLine[]
  onQtyChange: (id: number, qty: number) => void
  onRemove: (id: number) => void
  onClear: () => void
  onExport: () => void
}

export default function DevisPanel({ lines, onQtyChange, onRemove, onClear, onExport }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Récapitulatif</div>
          <h2>Devis — {lines.length} ligne{lines.length > 1 ? 's' : ''}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn ghost" style={{ fontSize: 12 }} onClick={onClear}>
            Vider
          </button>
          <button type="button" className="btn primary" style={{ fontSize: 12 }} onClick={onExport}>
            ⬇ Exporter xlsx
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1d2642' }}>
              <th style={{ ...thS, textAlign: 'left' }}>Désignation</th>
              <th style={{ ...thS, textAlign: 'left' }}>Référence</th>
              <th style={{ ...thS, textAlign: 'right', color: '#fb923c' }}>Prix posé /ml</th>
              <th style={{ ...thS, textAlign: 'right', color: '#22d3ee' }}>Qté (ml)</th>
              <th style={{ ...thS, textAlign: 'right', color: '#34d399' }}>Total (€)</th>
              <th style={{ ...thS, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} style={{ borderBottom: '1px solid #1a2240' }}>
                <td style={tdS}><strong style={{ color: '#f8fafc' }}>{line.label}</strong></td>
                <td style={{ ...tdS, color: '#64748b', fontSize: 11 }}>{line.refRef}</td>
                <td style={{ ...tdS, textAlign: 'right', color: '#fb923c', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {line.prixPose.toFixed(2)} €
                </td>
                <td style={{ ...tdS, textAlign: 'right' }}>
                  <input
                    type="number"
                    value={line.qty}
                    min={0}
                    step={1}
                    onChange={(e) => onQtyChange(line.id, parseFloat(e.target.value) || 0)}
                    style={{ width: 80, background: 'rgba(12,18,36,0.9)', border: '1px solid #164e63', borderRadius: 8, padding: '4px 8px', color: '#22d3ee', fontSize: 13, textAlign: 'right', outline: 'none', fontVariantNumeric: 'tabular-nums' }}
                  />
                </td>
                <td style={{ ...tdS, textAlign: 'right', fontWeight: 700, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                  {(line.prixPose * line.qty).toFixed(2)} €
                </td>
                <td style={{ ...tdS, textAlign: 'center' }}>
                  <button type="button" onClick={() => onRemove(line.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 16, padding: '2px 6px', borderRadius: 4 }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #1d2642' }}>
              <td colSpan={3} style={{ padding: '10px 12px', textAlign: 'right', color: '#9aa5c1', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Total général
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', color: '#22d3ee', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {lines.reduce((s, l) => s + l.qty, 0)} ml
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#34d399', fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>
                {lines.reduce((s, l) => s + l.prixPose * l.qty, 0).toFixed(2)} €
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
