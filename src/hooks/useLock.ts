import { useState, useEffect, useCallback, useRef } from 'react'

type ShowToast = (type: 'info' | 'error' | 'warn', message: string) => void
type SetDb = (db: PriceDatabase) => void
type NormalizeDb = (db: PriceDatabase) => PriceDatabase

export function useLock(
  currentUser: string | null,
  showToast: ShowToast,
  setDb: SetDb,
  normalizeDatabase: NormalizeDb,
) {
  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const isAdminRef = useRef(false)
  const dbVersionRef = useRef<string | null>(null)

  const refreshLockStatus = useCallback(async () => {
    const [status, version] = await Promise.all([
      window.api.getLockStatus(),
      window.api.getPricesVersion(),
    ])
    setLockInfo(status.lock ?? null)
    if (version && dbVersionRef.current !== null && version !== dbVersionRef.current && !isAdminRef.current) {
      const data = await window.api.loadPrices()
      setDb(normalizeDatabase(data))
      showToast('info', 'Base actualisee automatiquement')
    }
    dbVersionRef.current = version
  }, [showToast, setDb, normalizeDatabase])

  // Sync isAdmin state → ref (so refreshLockStatus closure doesn't go stale)
  useEffect(() => {
    isAdminRef.current = isAdmin
  }, [isAdmin])

  // Derive isAdmin from lockInfo + currentUser
  useEffect(() => {
    if (!currentUser) {
      setIsAdmin(false)
      return
    }
    setIsAdmin(Boolean(lockInfo && lockInfo.user === currentUser))
  }, [lockInfo, currentUser])

  // Poll lock status + db version every 12 s
  useEffect(() => {
    const interval = setInterval(() => { void refreshLockStatus() }, 12000)
    return () => clearInterval(interval)
  }, [refreshLockStatus])

  // Heartbeat every 30 s while admin
  useEffect(() => {
    if (!isAdmin || !currentUser) return
    const interval = setInterval(() => { void window.api.heartbeatLock(currentUser) }, 30000)
    return () => clearInterval(interval)
  }, [isAdmin, currentUser])

  const ADMIN_USERS = ['Matthieu']

  const handleToggleAdmin = useCallback(async () => {
    if (!currentUser) return
    if (!ADMIN_USERS.includes(currentUser)) {
      showToast('warn', 'Acces admin non autorise')
      return
    }
    if (isAdmin) {
      const res = await window.api.releaseLock(currentUser)
      if (res.ok) {
        showToast('info', 'Mode admin termine')
      } else {
        showToast('error', 'Impossible de liberer le verrou')
      }
      await refreshLockStatus()
      return
    }
    const res = await window.api.tryLock(currentUser)
    if (res.ok) {
      showToast('info', 'Mode admin actif')
    } else if (res.lock?.user) {
      showToast('warn', `Admin deja pris par ${res.lock.user}`)
    } else {
      showToast('error', 'Impossible de prendre le mode admin')
    }
    await refreshLockStatus()
  }, [currentUser, isAdmin, showToast, refreshLockStatus])

  return { lockInfo, isAdmin, refreshLockStatus, handleToggleAdmin }
}
