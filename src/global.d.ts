export {}

declare global {
  interface Window {
    api: {
      loadPrices: () => Promise<PriceDatabase>
      savePrices: (payload: { db: PriceDatabase; user: string | null }) => Promise<void>
      loadUsers: () => Promise<string[]>
      saveUsers: (users: string[]) => Promise<string[]>
      getConfig: () => Promise<AppConfig>
      updateConfig: (nextConfig: Partial<AppConfig>) => Promise<AppConfig>
      tryLock: (user: string) => Promise<LockResult>
      heartbeatLock: (user: string) => Promise<LockResult>
      releaseLock: (user: string) => Promise<LockResult>
      getLockStatus: () => Promise<{ lock: LockInfo | null; stale: boolean }>
      pickExcelFile: () => Promise<string | null>
      importExcel: (filePath: string, sheetName?: string) => Promise<ExcelData>
      exportExcel: (items: PriceItem[]) => Promise<string | null>
      getExcelSheets: (filePath: string) => Promise<string[]>
      exportSheet: (payload: { rows: (string | number)[][]; filename?: string }) => Promise<string | null>
      getPricesVersion: () => Promise<string | null>
      backupPrices: () => Promise<string | null>
      windowClose: () => Promise<void>
      windowMinimize: () => Promise<void>
      windowToggleMaximize: () => Promise<void>
      checkUpdates: () => Promise<{ status: string; version?: string; message?: string }>
      downloadUpdate: () => Promise<void>
      installUpdate: () => Promise<void>
      onUpdateEvent: (callback: (data: UpdateEventPayload) => void) => () => void
    }
  }

  interface AppConfig {
    dataDir: string
    lockTimeoutMin: number
  }

  interface LockInfo {
    user: string
    machine?: string
    pid?: number
    since?: string
    heartbeat?: string
  }

  interface LockResult {
    ok: boolean
    reason?: string
    lock?: LockInfo | null
    released?: boolean
  }

  interface PriceHistoryEntry {
    price: number
    updatedAt: string
    updatedBy: string
  }

  interface PriceItem {
    ref: string
    name: string
    unit: string
    price: number
    category?: string
    supplier?: string
    keywords?: string[]
    updatedAt?: string
    updatedBy?: string
    history?: PriceHistoryEntry[]
  }

  interface PriceDatabase {
    meta: {
      version: number
      currency: string
      priceType: string
      updatedAt?: string
      updatedBy?: string
    }
    items: PriceItem[]
  }

  interface UpdateEventPayload {
    type: 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'
    info?: { version: string }
    progress?: { percent: number }
    message?: string
  }

  interface ExcelData {
    sheetName: string
    sheetNames: string[]
    rows: Array<Array<string | number | boolean | Date>>
    columns: string[]
  }
}
