import { Trash2, UserPlus } from 'lucide-react'

interface Props {
  users: string[]
  isAdmin: boolean
  newUserName: string
  onNewUserNameChange: (v: string) => void
  onAddUser: () => void
  onDeleteUser: (user: string) => void
  onSelectUser: (user: string) => void
  onClose: () => void
  canClose: boolean
}

export default function UserModal({
  users, isAdmin, newUserName, onNewUserNameChange, onAddUser,
  onDeleteUser, onSelectUser, onClose, canClose,
}: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="eyebrow">Utilisateur</div>
            <h3>Selectionnez votre profil</h3>
          </div>
          {canClose && (
            <button type="button" className="btn ghost" onClick={onClose}>
              Fermer
            </button>
          )}
        </div>
        <div className="modal-body">
          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="search-input"
                placeholder="Nom du nouvel utilisateur..."
                value={newUserName}
                onChange={(e) => onNewUserNameChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAddUser()}
                style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
              />
              <button type="button" className="btn primary" onClick={onAddUser} style={{ padding: '8px 14px', fontSize: 12 }}>
                <UserPlus size={14} />
                Ajouter
              </button>
            </div>
          )}
          {users.length === 0 && <p className="hint">Aucun utilisateur defini.</p>}
          <div className="user-grid">
            {users.map((user) => (
              <div key={user} style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="user-btn"
                  style={{ flex: 1 }}
                  onClick={() => onSelectUser(user)}
                >
                  {user}
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => onDeleteUser(user)}
                    style={{ padding: '8px 10px' }}
                    title={`Supprimer ${user}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
