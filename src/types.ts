export type SourceType = 'hls' | 'youtube' | 'video' | 'file'
export type PresetId = 'modern' | 'crt' | 'mono' | 'vhs' | 'lcd' | 'portable' | 'custom'

export interface Channel {
  id: string
  number: number
  name: string
  url: string
  type: SourceType
  group?: string
  logo?: string
  epgId?: string
  favorite?: boolean
  hidden?: boolean
  preset?: PresetId
  /* Local media: a File System Access handle. Survives IndexedDB (structured
     clone) but not JSON backups — such channels re-import without their file. */
  handle?: FileSystemFileHandle
}

/* File System Access API surface not yet in lib.dom (Chromium-only). */
declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' }) => Promise<FileSystemDirectoryHandle>
    showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>
  }
  interface FileSystemHandle {
    queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
    requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
}

export interface Program {
  id: string
  channelId: string
  title: string
  description?: string
  category?: string
  start: string
  end: string
  icon?: string
}

export interface EffectSettings {
  intensity: number
  scanlines: number
  noise: number
  curvature: number
  colorBleed: number
  flicker: number
  overscan: number
}

export type RemoteAction =
  | { type: 'channel'; channelId: string }
  | { type: 'preset'; preset: PresetId }
  | { type: 'panel'; panel: 'guide' | 'channels' | 'settings' }
  | { type: 'none' }

export interface RemoteMacro {
  id: string
  label: string
  action: RemoteAction
}

export interface AppSettings {
  preset: PresetId
  volume: number
  muted: boolean
  lastChannelId?: string
  rememberChannel: boolean
  autoplay: boolean
  showClock: boolean
  showHardware: boolean
  chromaKey: boolean
  videoFit: 'contain' | 'cover'
  effectSettings: EffectSettings
  remoteMacros: RemoteMacro[]
}

export interface BackupFile {
  app: 'Retrocast TV'
  version: 1
  exportedAt: string
  settings: AppSettings
  channels: Channel[]
  programs: Program[]
}
