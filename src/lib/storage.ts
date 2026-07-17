import type { AppSettings, Channel, Program } from '../types'

const SETTINGS_KEY = 'retrocast.settings.v1'
const DB_NAME = 'retrocast-tv'
const DB_VERSION = 1

const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains('channels')) db.createObjectStore('channels', { keyPath: 'id' })
    if (!db.objectStoreNames.contains('programs')) db.createObjectStore('programs', { keyPath: 'id' })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const getAll = async <T>(storeName: 'channels' | 'programs'): Promise<T[]> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).getAll()
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
  })
}

const replaceAll = async <T>(storeName: 'channels' | 'programs', values: T[]) => {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    store.clear()
    values.forEach((value) => store.put(value))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

export const storage = {
  loadSettings(defaults: AppSettings): AppSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (!raw) return defaults
      const saved = JSON.parse(raw) as Partial<AppSettings>
      return {
        ...defaults,
        ...saved,
        effectSettings: { ...defaults.effectSettings, ...saved.effectSettings },
        remoteMacros: saved.remoteMacros?.length ? saved.remoteMacros : defaults.remoteMacros,
      }
    } catch {
      return defaults
    }
  },
  saveSettings(settings: AppSettings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Storage may be unavailable for file:// previews or strict privacy modes.
    }
  },
  getChannels: () => getAll<Channel>('channels'),
  setChannels: (channels: Channel[]) => replaceAll('channels', channels),
  getPrograms: () => getAll<Program>('programs'),
  setPrograms: (programs: Program[]) => replaceAll('programs', programs),
}
