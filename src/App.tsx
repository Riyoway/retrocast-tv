import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CirclePower,
  Clock3,
  Download,
  Expand,
  FastForward,
  FileUp,
  FolderOpen,
  Gauge,
  Grid2X2,
  Heart,
  Info,
  ListVideo,
  Menu,
  Monitor,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  Rewind,
  RotateCcw,
  Search,
  Settings,
  SkipBack,
  SlidersHorizontal,
  Star,
  Trash2,
  Tv,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AnalogOverlay } from './components/AnalogOverlay'
import { MediaPlayer, type MediaHandle } from './components/MediaPlayer'
import { parseM3U, parseXMLTV, sourceTypeFromUrl } from './lib/parsers'
import { fetchRemoteText } from './lib/remoteText'
import { validateChannels, type StreamStatus } from './lib/validateStream'
import { storage } from './lib/storage'
import type { AppSettings, BackupFile, Channel, EffectSettings, PresetId, Program, RemoteAction } from './types'

const PRESETS: { id: PresetId; label: string; description: string }[] = [
  { id: 'modern', label: 'Modern', description: 'Clean source image' },
  { id: 'crt', label: 'CRT', description: 'Phosphor mask, bloom & scanlines' },
  { id: 'mono', label: 'B&W CRT', description: 'Monochrome tube television' },
  { id: 'vhs', label: 'VHS', description: 'Tape drift, bleed & tracking' },
  { id: 'lcd', label: 'Early LCD', description: 'Ghosting & pixel grid' },
  { id: 'portable', label: 'Portable', description: 'Compact analog set' },
  { id: 'custom', label: 'Custom', description: 'Your calibrated profile' },
]

const DEFAULT_EFFECTS: EffectSettings = {
  intensity: 0.96,
  scanlines: 0.9,
  noise: 0.48,
  curvature: 0.68,
  colorBleed: 0.58,
  flicker: 0.28,
  overscan: 0.035,
}

const DEFAULT_SETTINGS: AppSettings = {
  preset: 'crt',
  volume: 0.76,
  muted: false,
  rememberChannel: true,
  autoplay: true,
  showClock: true,
  showHardware: true,
  chromaKey: false,
  videoFit: 'cover',
  effectSettings: DEFAULT_EFFECTS,
  remoteMacros: [
    { id: 'red', label: 'CRT', action: { type: 'preset', preset: 'crt' } },
    { id: 'green', label: 'GUIDE', action: { type: 'panel', panel: 'guide' } },
    { id: 'yellow', label: 'VHS', action: { type: 'preset', preset: 'vhs' } },
    { id: 'blue', label: 'CLEAN', action: { type: 'preset', preset: 'modern' } },
  ],
}

const sampleChannels: Channel[] = [
  {
    id: 'demo-tears-of-steel',
    number: 1,
    name: 'Tears of Steel',
    url: 'https://www.youtube.com/watch?v=R6MlUcmOul8',
    type: 'youtube',
    group: 'Open Cinema',
    epgId: 'demo-tears-of-steel',
  },
  {
    id: 'demo-youtube',
    number: 2,
    name: 'Cinema Archive',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    type: 'youtube',
    group: 'Demo',
    epgId: 'demo-youtube',
  },
]

const makeSamplePrograms = (): Program[] => {
  const now = Date.now()
  const hour = 60 * 60 * 1000
  return sampleChannels.flatMap((channel, channelIndex) => [-1, 0, 1, 2].map((offset) => ({
    id: `${channel.id}-${offset}`,
    channelId: channel.id,
    title: [
      ['Signal Check', 'Tears of Steel', 'Blender Open Movie', 'Late Night Sci-Fi'],
      ['Open Cinema', 'Studio Reel', 'Director Notes', 'After Hours'],
    ][channelIndex][offset + 1],
    description: 'Demo schedule data. Import XMLTV to replace it with your own programme guide.',
    category: 'Cinema',
    start: new Date(now + offset * hour).toISOString(),
    end: new Date(now + (offset + 1) * hour).toISOString(),
  })))
}

type Panel = 'none' | 'channels' | 'guide' | 'remote' | 'settings'
type SettingsTab = 'channels' | 'display' | 'remote' | 'data'

const formatClock = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const formatRange = (start: string, end: string) => `${formatClock(new Date(start))}–${formatClock(new Date(end))}`
const mmss = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function App() {
  const mediaRef = useRef<MediaHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const xmlInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const localInputRef = useRef<HTMLInputElement>(null)
  const controlsTimer = useRef<number | undefined>(undefined)
  const remoteRef = useRef<HTMLElement>(null)

  const [channels, setChannels] = useState<Channel[]>([])
  const [programs, setPrograms] = useState<Program[]>([])
  const [settings, setSettings] = useState<AppSettings>(() => storage.loadSettings(DEFAULT_SETTINGS))
  const initialSettings = useRef(settings)
  const [activeChannelId, setActiveChannelId] = useState('')
  const [panel, setPanel] = useState<Panel>('none')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('channels')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [status, setStatus] = useState('Ready')
  const [isPlaying, setIsPlaying] = useState(false)
  const [osdVisible, setOsdVisible] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All')
  const [numberBuffer, setNumberBuffer] = useState('')
  const [toast, setToast] = useState('')
  const [m3uUrl, setM3uUrl] = useState('')
  const [epgUrl, setEpgUrl] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [loadingAction, setLoadingAction] = useState('')
  const [remotePos, setRemotePos] = useState<{ x: number; y: number } | null>(null)
  const [powered, setPowered] = useState(true)
  const [volumeOsd, setVolumeOsd] = useState(false)
  const volumeOsdTimer = useRef<number | undefined>(undefined)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [media, setMedia] = useState({ current: 0, duration: 0 })
  const [showSeek, setShowSeek] = useState(false)
  const [checks, setChecks] = useState<Record<string, StreamStatus>>({})
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null)
  const validateSignal = useRef<{ cancelled: boolean } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [openPresetMenuId, setOpenPresetMenuId] = useState<string | null>(null)

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    if (!openPresetMenuId) return
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest('.preset-select')) setOpenPresetMenuId(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPresetMenuId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openPresetMenuId])

  const activeChannel = channels.find((channel) => channel.id === activeChannelId)
  const activePreset = activeChannel?.preset ?? settings.preset
  const nowPrograms = useMemo(() => {
    const now = clock.getTime()
    return programs.filter((program) => new Date(program.start).getTime() <= now && new Date(program.end).getTime() > now)
  }, [programs, clock])
  const activeProgram = nowPrograms.find((program) => program.channelId === activeChannelId)

  const saveChannels = useCallback((next: Channel[]) => {
    setChannels(next)
    void storage.setChannels(next)
  }, [])

  const savePrograms = useCallback((next: Program[]) => {
    setPrograms(next)
    void storage.setPrograms(next)
  }, [])

  const setChannelPreset = useCallback((channelId: string, preset: PresetId | undefined) => {
    saveChannels(channels.map((item) => item.id === channelId ? { ...item, preset } : item))
    setOpenPresetMenuId(null)
  }, [channels, saveChannels])

  const updateSettings = useCallback((update: Partial<AppSettings> | ((value: AppSettings) => AppSettings)) => {
    setSettings((current) => {
      const next = typeof update === 'function' ? update(current) : { ...current, ...update }
      storage.saveSettings(next)
      return next
    })
  }, [])

  useEffect(() => {
    void Promise.all([storage.getChannels(), storage.getPrograms()]).then(([savedChannels, savedPrograms]) => {
      const nextChannels = savedChannels.length ? savedChannels : sampleChannels
      const nextPrograms = savedPrograms.length ? savedPrograms : makeSamplePrograms()
      setChannels(nextChannels.sort((a, b) => a.number - b.number))
      setPrograms(nextPrograms)
      if (!savedChannels.length) void storage.setChannels(nextChannels)
      if (!savedPrograms.length) void storage.setPrograms(nextPrograms)
      const preferred = initialSettings.current.rememberChannel && initialSettings.current.lastChannelId
        ? nextChannels.find((channel) => channel.id === initialSettings.current.lastChannelId)?.id
        : undefined
      setActiveChannelId(preferred ?? nextChannels[0]?.id ?? '')
    })
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const wakeControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(controlsTimer.current)
    // Only fade the chrome away while something is actually playing — a paused or
    // signal-less screen keeps its controls so it never looks empty or broken.
    controlsTimer.current = window.setTimeout(() => {
      if (panel === 'none' && isPlaying) setControlsVisible(false)
    }, 3600)
  }, [panel, isPlaying])

  // Tap the picture to toggle the chrome (mobile). A tap fires a synthetic mousemove
  // too, so we ignore mouse-move reveal for a moment after any touch.
  const lastTouch = useRef(0)
  const onScreenMouseMove = useCallback(() => {
    if (Date.now() - lastTouch.current > 600) wakeControls()
  }, [wakeControls])
  const toggleControls = useCallback(() => {
    if (panel !== 'none') return
    if (controlsVisible) {
      window.clearTimeout(controlsTimer.current)
      setControlsVisible(false)
    } else {
      wakeControls()
    }
  }, [panel, controlsVisible, wakeControls])

  useEffect(() => {
    wakeControls()
    return () => window.clearTimeout(controlsTimer.current)
  }, [panel, wakeControls])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }, [])

  const tune = useCallback((channel: Channel | undefined) => {
    if (!channel) return
    setActiveChannelId(channel.id)
    setStatus('Tuning')
    setOsdVisible(true)
    setNumberBuffer('')
    setPanel('none')
    updateSettings({ lastChannelId: channel.id })
  }, [updateSettings])

  // Auto-dismiss the channel banner — on channel change and on first load, which the
  // original tune()-only timer missed, leaving the banner stuck on screen at startup.
  useEffect(() => {
    if (!osdVisible) return
    const timer = window.setTimeout(() => setOsdVisible(false), 4200)
    return () => window.clearTimeout(timer)
  }, [osdVisible, activeChannelId])

  const stepChannel = useCallback((direction: 1 | -1) => {
    const visible = channels.filter((channel) => !channel.hidden).sort((a, b) => a.number - b.number)
    if (!visible.length) return
    const currentIndex = Math.max(0, visible.findIndex((channel) => channel.id === activeChannelId))
    tune(visible[(currentIndex + direction + visible.length) % visible.length])
  }, [channels, activeChannelId, tune])

  const setVolume = useCallback((value: number) => {
    const volume = Math.min(1, Math.max(0, value))
    updateSettings({ volume, muted: volume === 0 ? true : settings.muted })
    mediaRef.current?.setVolume(volume)
    setVolumeOsd(true)
    window.clearTimeout(volumeOsdTimer.current)
    volumeOsdTimer.current = window.setTimeout(() => setVolumeOsd(false), 1600)
  }, [settings.muted, updateSettings])

  const toggleMute = useCallback(() => {
    const muted = !settings.muted
    updateSettings({ muted })
    mediaRef.current?.setMuted(muted)
  }, [settings.muted, updateSettings])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  const cyclePlaybackRate = useCallback(() => {
    const rates = [1, 1.5, 2]
    setPlaybackRate((rate) => rates[(rates.indexOf(rate) + 1) % rates.length] ?? 1)
  }, [])

  const seekable = Number.isFinite(media.duration) && media.duration > 0

  const togglePower = useCallback(() => {
    setPowered((on) => {
      const next = !on
      if (!next) mediaRef.current?.pause()
      else if (settings.autoplay) window.setTimeout(() => mediaRef.current?.play(), 320)
      return next
    })
  }, [settings.autoplay])

  // Drag the floating remote by its head. Listen on window (not the handle) so the
  // drag survives the cursor leaving the handle, without the setPointerCapture
  // target pitfall. Clamped so the remote can't be thrown off-screen.
  const beginRemoteDrag = useCallback((event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) return
    const el = remoteRef.current
    if (!el) return
    event.preventDefault()
    const rect = el.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    setRemotePos({ x: rect.left, y: rect.top })
    const move = (moveEvent: PointerEvent) => {
      setRemotePos({
        x: Math.min(window.innerWidth - el.offsetWidth, Math.max(0, moveEvent.clientX - offsetX)),
        y: Math.min(window.innerHeight - el.offsetHeight, Math.max(0, moveEvent.clientY - offsetY)),
      })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [])

  const executeAction = useCallback((action: RemoteAction) => {
    if (action.type === 'channel') tune(channels.find((channel) => channel.id === action.channelId))
    if (action.type === 'preset') updateSettings({ preset: action.preset })
    if (action.type === 'panel') setPanel(action.panel)
  }, [channels, tune, updateSettings])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      wakeControls()
      if (/^[0-9]$/.test(event.key)) {
        setNumberBuffer((value) => (value + event.key).slice(-3))
        return
      }
      if (event.key === 'Enter' && numberBuffer) {
        tune(channels.find((channel) => channel.number === Number(numberBuffer)))
        return
      }
      if (event.key === 'ArrowUp') stepChannel(1)
      if (event.key === 'ArrowDown') stepChannel(-1)
      if (event.key === 'ArrowRight') setVolume(settings.volume + 0.05)
      if (event.key === 'ArrowLeft') setVolume(settings.volume - 0.05)
      if (event.key.toLowerCase() === 'm') toggleMute()
      if (event.key.toLowerCase() === 'f') toggleFullscreen()
      if (event.key.toLowerCase() === 'g') setPanel('guide')
      if (event.key.toLowerCase() === 'r') setPanel('remote')
      if (event.key.toLowerCase() === 's') setPanel('settings')
      if (event.key === 'Escape') setPanel('none')
      if (event.code === 'Space') {
        event.preventDefault()
        mediaRef.current?.toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [channels, numberBuffer, settings.volume, setVolume, stepChannel, toggleFullscreen, toggleMute, tune, wakeControls])

  useEffect(() => {
    if (!numberBuffer) return
    const timer = window.setTimeout(() => tune(channels.find((channel) => channel.number === Number(numberBuffer))), 1400)
    return () => window.clearTimeout(timer)
  }, [numberBuffer, channels, tune])

  const groups = useMemo(() => ['All', ...Array.from(new Set(channels.map((channel) => channel.group).filter(Boolean) as string[]))], [channels])
  const filteredChannels = useMemo(() => channels
    .filter((channel) => !channel.hidden)
    .filter((channel) => group === 'All' || channel.group === group)
    .filter((channel) => `${channel.number} ${channel.name}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.number - b.number), [channels, group, query])

  const addChannels = useCallback((incoming: Channel[], persist = true) => {
    const fingerprints = new Set(channels.map((channel) => `${channel.name}|${channel.url}`))
    const unique = incoming.filter((channel) => !fingerprints.has(`${channel.name}|${channel.url}`))
    const next = [...channels, ...unique].map((channel, index) => ({ ...channel, number: channel.number || index + 1 })).sort((a, b) => a.number - b.number)
    // ponytail: persist=false keeps blob-URL fallback channels session-only; a later
    // lineup edit would still persist them as dead rows. Rare path, accepted.
    if (persist) saveChannels(next)
    else setChannels(next)
    if (!activeChannelId && next[0]) tune(next[0])
    notify(`${unique.length} channel${unique.length === 1 ? '' : 's'} added`)
  }, [channels, saveChannels, activeChannelId, tune, notify])

  const localName = (fileName: string) => fileName.replace(/\.[^.]+$/, '')
  const MEDIA_RE = /\.(mp4|m4v|webm|mkv|mov|ts|ogv|mp3|m4a|flac|wav|ogg)$/i

  const channelFromHandle = (handle: FileSystemFileHandle, group: string): Channel => ({
    id: crypto.randomUUID(),
    number: 0,
    name: localName(handle.name),
    url: '',
    type: 'file',
    group,
    handle,
  })

  // Handles never survive a JSON backup, so an import leaves local channels dead
  // (name only). Picking a folder again relinks them by file name — keeping their
  // number, group and favourite — and only genuinely new files become channels.
  const integrateLocalHandles = (handles: FileSystemFileHandle[], group: string) => {
    const dead = new Map(channels.filter((channel) => channel.type === 'file' && !channel.handle && !channel.url).map((channel) => [channel.name, channel.id]))
    const relinks = new Map<string, FileSystemFileHandle>()
    const fresh: Channel[] = []
    for (const handle of handles) {
      const deadId = dead.get(localName(handle.name))
      if (deadId && !relinks.has(deadId)) relinks.set(deadId, handle)
      else fresh.push(channelFromHandle(handle, group))
    }
    const fingerprints = new Set(channels.map((channel) => `${channel.name}|${channel.url}`))
    const unique = fresh.filter((channel) => !fingerprints.has(`${channel.name}|${channel.url}`))
    const next = [...channels.map((channel) => relinks.has(channel.id) ? { ...channel, handle: relinks.get(channel.id) } : channel), ...unique]
      .map((channel, index) => ({ ...channel, number: channel.number || index + 1 }))
      .sort((a, b) => a.number - b.number)
    saveChannels(next)
    if (!activeChannelId && next[0]) tune(next[0])
    notify(relinks.size ? `${unique.length} added · ${relinks.size} relinked` : `${unique.length} channel${unique.length === 1 ? '' : 's'} added`)
  }

  const importLocalFolder = async () => {
    if (!window.showDirectoryPicker) {
      localInputRef.current?.click()
      return
    }
    try {
      const dir = await window.showDirectoryPicker({ id: 'retrocast-media', mode: 'read' })
      const handles: FileSystemFileHandle[] = []
      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && MEDIA_RE.test(entry.name)) handles.push(entry as FileSystemFileHandle)
      }
      if (!handles.length) {
        notify('No playable files in that folder')
        return
      }
      handles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      integrateLocalHandles(handles, dir.name)
    } catch {
      // picker dismissed
    }
  }

  const importLocalFiles = async () => {
    if (!window.showOpenFilePicker) {
      localInputRef.current?.click()
      return
    }
    try {
      const handles = (await window.showOpenFilePicker({ multiple: true })).filter((handle) => MEDIA_RE.test(handle.name))
      if (handles.length) integrateLocalHandles(handles, 'Local')
    } catch {
      // picker dismissed
    }
  }

  // Browsers without the File System Access API: blob URLs die on reload, so these
  // channels stay in memory only.
  const importLocalFallback = (files: FileList | null) => {
    if (!files?.length) return
    const locals = [...files]
      .filter((file) => MEDIA_RE.test(file.name) || file.type.startsWith('video/') || file.type.startsWith('audio/'))
      .map((file): Channel => ({
        id: crypto.randomUUID(),
        number: 0,
        name: localName(file.name),
        url: URL.createObjectURL(file),
        type: 'file',
        group: 'Local',
      }))
    if (locals.length) {
      addChannels(locals, false)
      notify('Local files last until this tab closes')
    }
  }

  const importM3UFile = async (file?: File) => {
    if (!file) return
    try {
      addChannels(parseM3U(await file.text(), channels.length))
    } catch {
      notify('Could not read the playlist')
    }
  }

  const importM3UUrl = async () => {
    if (!m3uUrl) return
    setLoadingAction('m3u')
    try {
      const { text, viaProxy } = await fetchRemoteText(m3uUrl)
      addChannels(parseM3U(text, channels.length))
      setM3uUrl('')
      if (viaProxy) notify('Loaded via CORS proxy')
    } catch {
      notify('Playlist unreachable — download it and use Choose M3U')
    } finally {
      setLoadingAction('')
    }
  }

  const addManualChannel = () => {
    if (!manualName.trim() || !manualUrl.trim()) return
    addChannels([{
      id: crypto.randomUUID(),
      number: channels.reduce((max, channel) => Math.max(max, channel.number), 0) + 1,
      name: manualName.trim(),
      url: manualUrl.trim(),
      type: sourceTypeFromUrl(manualUrl),
      group: 'Custom',
    }])
    setManualName('')
    setManualUrl('')
  }

  const importXMLFile = async (file?: File) => {
    if (!file) return
    try {
      const next = parseXMLTV(await file.text(), channels)
      savePrograms(next)
      notify(`${next.length} programmes imported`)
    } catch {
      notify('Could not parse XMLTV')
    }
  }

  const importXMLUrl = async () => {
    if (!epgUrl) return
    setLoadingAction('epg')
    try {
      const { text, viaProxy } = await fetchRemoteText(epgUrl)
      const next = parseXMLTV(text, channels)
      savePrograms(next)
      setEpgUrl('')
      notify(viaProxy ? `${next.length} programmes imported (via proxy)` : `${next.length} programmes imported`)
    } catch {
      notify('EPG unreachable — download it and use Choose XMLTV')
    } finally {
      setLoadingAction('')
    }
  }

  const exportBackup = () => {
    const backup: BackupFile = {
      app: 'Retrocast TV',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      // File handles can't cross a JSON boundary; local channels export without them.
      channels: channels.map(({ handle: _handle, ...rest }) => rest),
      programs,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `retrocast-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importBackup = async (file?: File) => {
    if (!file) return
    try {
      const backup = JSON.parse(await file.text()) as BackupFile
      if (backup.app !== 'Retrocast TV' || backup.version !== 1) throw new Error()
      updateSettings(backup.settings)
      saveChannels(backup.channels)
      savePrograms(backup.programs)
      setActiveChannelId(backup.settings.lastChannelId ?? backup.channels[0]?.id ?? '')
      notify('Backup restored')
    } catch {
      notify('Invalid backup file')
    }
  }

  const resetApp = () => {
    updateSettings(DEFAULT_SETTINGS)
    saveChannels(sampleChannels)
    savePrograms(makeSamplePrograms())
    setActiveChannelId(sampleChannels[0].id)
    notify('Demo data restored')
  }

  // Bulk-check every channel's URL client-side, streaming each result into the list.
  const validateAll = useCallback(async () => {
    if (checking || !channels.length) return
    setChecks({})
    setChecking({ done: 0, total: channels.length })
    const signal = { cancelled: false }
    validateSignal.current = signal
    const counts = { ok: 0, fail: 0, timeout: 0, skip: 0 }
    await validateChannels(channels, (id, status, done) => {
      counts[status]++
      setChecks((prev) => ({ ...prev, [id]: status }))
      setChecking({ done, total: channels.length })
    }, 6, signal)
    validateSignal.current = null
    if (!signal.cancelled) {
      setChecking(null)
      notify(`${counts.ok} playable · ${counts.fail + counts.timeout} unreachable${counts.skip ? ` · ${counts.skip} skipped` : ''}`)
    }
  }, [channels, checking, notify])

  const stopValidate = useCallback(() => {
    if (validateSignal.current) validateSignal.current.cancelled = true
    setChecking(null)
  }, [])

  const removeUnreachable = useCallback(() => {
    const bad = new Set(Object.entries(checks).filter(([, status]) => status === 'fail' || status === 'timeout').map(([id]) => id))
    if (!bad.size) return
    saveChannels(channels.filter((channel) => !bad.has(channel.id)))
    setChecks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !bad.has(id))))
    notify(`Removed ${bad.size} unreachable`)
  }, [checks, channels, saveChannels, notify])

  const updateEffect = (key: keyof EffectSettings, value: number) => {
    updateSettings((current) => ({ ...current, effectSettings: { ...current.effectSettings, [key]: value } }))
  }

  const programsForChannel = (channelId: string) => programs
    .filter((program) => program.channelId === channelId && new Date(program.end).getTime() > Date.now() - 3_600_000)
    .slice(0, 4)

  return (
    <main
      className={`app preset-${activePreset} ${settings.showHardware ? 'display-cabinet' : 'display-screen'} fit-${settings.videoFit} ${controlsVisible ? 'controls-awake' : 'controls-asleep'} ${powered ? 'tv-on' : 'tv-off'} ${settings.chromaKey ? 'chroma-key' : ''}`}
      style={{
        '--effect-intensity': settings.effectSettings.intensity,
        '--curve': settings.effectSettings.curvature,
        '--bleed': settings.effectSettings.colorBleed,
        '--overscan': settings.effectSettings.overscan,
      } as React.CSSProperties}
      onMouseMove={onScreenMouseMove}
      onTouchStart={() => { lastTouch.current = Date.now() }}
    >
      <div className="ambient" />
      <section className="watch-stage" onClick={() => { if (powered) toggleControls() }}>
        <div className={`television television-${activePreset}`}>
          <div className="screen-shell">
            <div className="screen-content">
              <MediaPlayer
                ref={mediaRef}
                channel={activeChannel}
                autoplay={settings.autoplay}
                volume={settings.volume}
                muted={settings.muted}
                preset={activePreset}
                intensity={settings.effectSettings.intensity}
                playbackRate={playbackRate}
                onPlayingChange={setIsPlaying}
                onStatus={setStatus}
                onTime={(current, duration) => setMedia({ current, duration })}
              />
              <AnalogOverlay preset={activePreset} settings={settings.effectSettings} />
              <div className="phosphor-mask" />
              <div className="scanline-layer" />
              <div className="vhs-tracking-band" />
              <div className="glass-reflection" />
              <div className="screen-vignette" />

              {powered && (osdVisible || numberBuffer) && (
                <div className="channel-osd">
                  <div className="osd-number">{numberBuffer || String(activeChannel?.number ?? '--').padStart(2, '0')}</div>
                  {!numberBuffer && (
                    <div className="osd-copy">
                      <strong>{activeChannel?.name ?? 'NO SIGNAL'}</strong>
                      <span>{activeProgram?.title ?? status}</span>
                      {activeProgram && <small>{formatRange(activeProgram.start, activeProgram.end)}</small>}
                    </div>
                  )}
                </div>
              )}

              {powered && volumeOsd && (
                <div className="volume-osd">
                  VOLUME
                  <div>{Array.from({ length: 12 }, (_, index) => <i key={index} className={index < Math.round((settings.muted ? 0 : settings.volume) * 12) ? 'on' : ''} />)}</div>
                </div>
              )}
              {powered && settings.showClock && <time className="screen-clock">{formatClock(clock)}</time>}
              {powered && <div className="signal-badge"><i className={status === 'Live' ? 'live' : ''} />{status}</div>}
            </div>
            <button
              className={`standby-screen ${powered ? '' : 'standby-on'}`}
              aria-label="Turn television on"
              tabIndex={powered ? -1 : 0}
              onClick={powered ? undefined : togglePower}
            >
              <span className="standby-led" />
              <small>STANDBY</small>
            </button>
          </div>
          {settings.showHardware && (
            <img
              className="cabinet-frame"
              src={`/frames/${activePreset}.webp`}
              alt=""
              aria-hidden="true"
              draggable="false"
            />
          )}
        </div>
      </section>

      <header className="top-bar chrome-ui">
        <button className="brand" onClick={() => setPanel('channels')} aria-label="Open channels">
          <span className="brand-glyph"><Radio size={16} /></span>
          <span>RETROCAST <small>TV</small></span>
        </button>
        <div className="top-actions">
          <button onClick={() => setPanel('guide')}><Clock3 size={17} /><span>Guide</span></button>
          <button onClick={() => setPanel('remote')}><Grid2X2 size={17} /><span>Remote</span></button>
          <button onClick={() => setPanel('settings')}><Settings size={17} /><span>Settings</span></button>
        </div>
      </header>

      <div className="transport chrome-ui">
        <button className="transport-channel" onClick={() => setPanel('channels')}>
          <span>{String(activeChannel?.number ?? 0).padStart(2, '0')}</span>
          <div><strong>{activeChannel?.name ?? 'No channel'}</strong><small>{activeProgram?.title ?? activeChannel?.group ?? 'Select a source'}</small></div>
          <ChevronUp size={15} />
        </button>
        <div className="transport-center">
          <button onClick={() => stepChannel(-1)} aria-label="Previous channel"><SkipBack size={19} /></button>
          <button className="play-key" onClick={() => mediaRef.current?.toggle()} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
          </button>
          <button onClick={() => stepChannel(1)} aria-label="Next channel"><ChevronRight size={21} /></button>
        </div>
        <div className="transport-right">
          <button onClick={toggleMute} aria-label="Mute">{settings.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.muted ? 0 : settings.volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
          {seekable && <button className={`seek-toggle ${showSeek ? 'active' : ''}`} onClick={() => setShowSeek((value) => !value)} aria-label="Show timeline">{mmss(media.current)}</button>}
          <button className="preset-pill" onClick={() => { setPanel('settings'); setSettingsTab('display') }}><Monitor size={16} />{PRESETS.find((preset) => preset.id === activePreset)?.label}</button>
          <button onClick={toggleFullscreen} aria-label="Fullscreen"><Expand size={19} /></button>
        </div>
      </div>

      {/* Hidden by default — a TV shouldn't wear a progress bar. Revealed by the
          timeline toggle, and only for seekable (finite-duration) sources. */}
      {showSeek && seekable && (
        <div className="seek-bar chrome-ui">
          <span>{mmss(media.current)}</span>
          <input
            aria-label="Seek"
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={media.current / media.duration}
            onChange={(event) => mediaRef.current?.seekToFraction(Number(event.target.value))}
          />
          <span>{mmss(media.duration)}</span>
        </div>
      )}

      {panel !== 'none' && panel !== 'remote' && <button className="scrim" aria-label="Close panel" onClick={() => setPanel('none')} />}

      <aside className={`drawer drawer-left ${panel === 'channels' ? 'drawer-open' : ''}`}>
        <DrawerHeader icon={<ListVideo size={18} />} title="Channels" onClose={() => setPanel('none')} />
        <div className="drawer-tools">
          <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels" /></label>
          <div className="group-tabs">
            {groups.map((item) => <button key={item} className={group === item ? 'active' : ''} onClick={() => setGroup(item)}>{item}</button>)}
          </div>
        </div>
        <div className="channel-list">
          {filteredChannels.map((channel) => {
            const current = nowPrograms.find((program) => program.channelId === channel.id)
            return (
              <button key={channel.id} className={`channel-row ${channel.id === activeChannelId ? 'active' : ''}`} onClick={() => tune(channel)}>
                <span className="channel-number">{String(channel.number).padStart(2, '0')}</span>
                <span className="channel-logo">{channel.logo ? <img src={channel.logo} alt="" /> : <Tv size={18} />}</span>
                <span className="channel-copy"><strong>{channel.name}</strong><small>{current?.title ?? channel.group ?? channel.type.toUpperCase()}</small></span>
                {channel.favorite && <Star size={14} fill="currentColor" />}
              </button>
            )
          })}
          {!filteredChannels.length && <EmptyState title="No matching channels" detail="Try another group or import a playlist." />}
        </div>
        <div className="drawer-footer"><button className="primary-button" onClick={() => { setPanel('settings'); setSettingsTab('channels') }}><Plus size={16} />Add sources</button></div>
      </aside>

      <aside className={`drawer drawer-guide ${panel === 'guide' ? 'drawer-open' : ''}`}>
        <DrawerHeader icon={<Clock3 size={18} />} title="Programme guide" onClose={() => setPanel('none')} />
        <div className="guide-date"><div><small>NOW</small><strong>{clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</strong></div><time>{formatClock(clock)}</time></div>
        <div className="guide-list">
          {channels.filter((channel) => !channel.hidden).sort((a, b) => a.number - b.number).map((channel) => {
            const items = programsForChannel(channel.id)
            return (
              <article className="guide-row" key={channel.id}>
                <button className="guide-channel" onClick={() => tune(channel)}><span>{String(channel.number).padStart(2, '0')}</span><strong>{channel.name}</strong></button>
                <div className="guide-programs">
                  {items.length ? items.map((program) => {
                    const live = new Date(program.start).getTime() <= Date.now() && new Date(program.end).getTime() > Date.now()
                    const progress = live ? Math.max(0, Math.min(100, (Date.now() - new Date(program.start).getTime()) / (new Date(program.end).getTime() - new Date(program.start).getTime()) * 100)) : 0
                    return (
                      <button key={program.id} className={`guide-program ${live ? 'live' : ''}`} onClick={() => tune(channel)}>
                        <small>{formatRange(program.start, program.end)}</small><strong>{program.title}</strong><span>{program.category}</span>
                        {live && <i style={{ width: `${progress}%` }} />}
                      </button>
                    )
                  }) : <div className="guide-empty">No programme data</div>}
                </div>
              </article>
            )
          })}
        </div>
      </aside>

      <aside
        ref={remoteRef}
        className={`remote-overlay ${panel === 'remote' ? 'remote-open' : ''} ${remotePos ? 'remote-moved' : ''}`}
        style={remotePos ? { left: remotePos.x, top: remotePos.y } : undefined}
      >
        <button className="remote-close" aria-label="Close remote" onClick={() => setPanel('none')}><X size={18} /></button>
        <div className="remote-body">
          <div className="remote-head" onPointerDown={beginRemoteDrag}>
            <span>RETROCAST</span>
            <button className={`remote-power ${powered ? '' : 'off'}`} aria-label={powered ? 'Turn television off' : 'Turn television on'} onClick={togglePower}><CirclePower size={19} /></button>
          </div>
          <div className="remote-meta"><small>CH</small><strong>{String(activeChannel?.number ?? 0).padStart(2, '0')}</strong><span>{activeChannel?.name ?? 'NO SIGNAL'}</span></div>
          <div className="remote-pair">
            <div><button onClick={() => setVolume(settings.volume + 0.05)}>+</button><span>VOL</span><button onClick={() => setVolume(settings.volume - 0.05)}>−</button></div>
            <div><button onClick={() => stepChannel(1)}>+</button><span>CH</span><button onClick={() => stepChannel(-1)}>−</button></div>
          </div>
          <button className="remote-wide" onClick={toggleMute}>{settings.muted ? <VolumeX size={17} /> : <Volume2 size={17} />} MUTE</button>
          <div className="remote-dpad">
            <button className="up" onClick={() => stepChannel(1)}><ChevronUp /></button>
            <button className="left" onClick={() => setVolume(settings.volume - 0.05)}><ChevronLeft /></button>
            <button className="ok" onClick={() => mediaRef.current?.toggle()}>OK</button>
            <button className="right" onClick={() => setVolume(settings.volume + 0.05)}><ChevronRight /></button>
            <button className="down" onClick={() => stepChannel(-1)}><ChevronDown /></button>
          </div>
          <div className="number-pad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => <button key={number} onClick={() => setNumberBuffer((value) => `${value}${number}`.slice(-3))}>{number}</button>)}
            <button onClick={() => setPanel('guide')}><ListVideo size={16} /></button>
            <button onClick={() => setNumberBuffer((value) => `${value}0`.slice(-3))}>0</button>
            <button onClick={() => { setPanel('settings'); setSettingsTab('display') }}><Menu size={16} /></button>
          </div>
          <div className="macro-row">
            {settings.remoteMacros.map((macro) => <button key={macro.id} className={`macro-${macro.id}`} onClick={() => executeAction(macro.action)}><span />{macro.label}</button>)}
          </div>
          <div className="remote-jog">
            <button onClick={() => mediaRef.current?.seek(-30)} aria-label="Back 30 seconds"><Rewind size={13} />30</button>
            <button className={playbackRate !== 1 ? 'active' : ''} onClick={cyclePlaybackRate} aria-label="Playback speed"><Gauge size={13} />{playbackRate}×</button>
            <button onClick={() => mediaRef.current?.seek(30)} aria-label="Forward 30 seconds">30<FastForward size={13} /></button>
          </div>
          <div className="remote-transport">
            <button onClick={() => mediaRef.current?.pause()} aria-label="Pause"><Pause size={16} /></button>
            <button onClick={() => mediaRef.current?.play()} aria-label="Play"><Play size={16} /></button>
            <button onClick={toggleFullscreen} aria-label="Fullscreen"><Expand size={16} /></button>
          </div>
        </div>
      </aside>

      <aside className={`drawer drawer-settings ${panel === 'settings' ? 'drawer-open' : ''}`}>
        <DrawerHeader icon={<Settings size={18} />} title="Television setup" onClose={() => setPanel('none')} />
        <nav className="settings-tabs">
          {([
            ['channels', <Radio key="channels" size={16} />, 'Sources'],
            ['display', <SlidersHorizontal key="display" size={16} />, 'Display'],
            ['remote', <Grid2X2 key="remote" size={16} />, 'Remote'],
            ['data', <Archive key="data" size={16} />, 'Data'],
          ] as [SettingsTab, React.ReactNode, string][]).map(([id, icon, label]) => <button key={id} className={settingsTab === id ? 'active' : ''} onClick={() => setSettingsTab(id)}>{icon}{label}</button>)}
        </nav>
        <div className="settings-content">
          {settingsTab === 'channels' && (
            <>
              <SettingsSection title="Playlist" detail="Import an M3U file, or load one by URL. If the host blocks browser access, it's retried through a public CORS proxy automatically.">
                <div className="button-row">
                  <button className="primary-button" onClick={() => fileInputRef.current?.click()}><FileUp size={16} />Choose M3U</button>
                  <input ref={fileInputRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(event) => void importM3UFile(event.target.files?.[0])} />
                </div>
                <div className="inline-field"><input value={m3uUrl} onChange={(event) => setM3uUrl(event.target.value)} placeholder="https://example.com/playlist.m3u" /><button onClick={() => void importM3UUrl()} disabled={!m3uUrl || loadingAction === 'm3u'}>{loadingAction === 'm3u' ? 'Loading…' : 'Load'}</button></div>
              </SettingsSection>
              <SettingsSection title="Local media" detail="Play videos from this computer. Each file becomes a channel; folder picks are remembered by this browser and access is reconfirmed after a reload.">
                <div className="button-row">
                  <button className="primary-button" onClick={() => void importLocalFolder()}><FolderOpen size={16} />Choose folder</button>
                  <button className="secondary-button" onClick={() => void importLocalFiles()}><FileUp size={16} />Choose files</button>
                </div>
                <input ref={localInputRef} type="file" accept="video/*,audio/*" multiple hidden onChange={(event) => { importLocalFallback(event.target.files); event.target.value = '' }} />
              </SettingsSection>
              <SettingsSection title="Single channel" detail="HLS, regular video URLs and YouTube links are detected automatically.">
                <label className="stack-field"><span>Name</span><input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Channel name" /></label>
                <label className="stack-field"><span>Source URL</span><input value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://…" /></label>
                <button className="primary-button" onClick={addManualChannel} disabled={!manualName || !manualUrl}><Plus size={16} />Add channel</button>
              </SettingsSection>
              <SettingsSection title="XMLTV programme guide" detail="Channels are matched by tvg-id first, then by display name.">
                <button className="secondary-button" onClick={() => xmlInputRef.current?.click()}><Upload size={16} />Choose XMLTV</button>
                <input ref={xmlInputRef} type="file" accept=".xml,.xmltv,application/xml,text/xml" hidden onChange={(event) => void importXMLFile(event.target.files?.[0])} />
                <div className="inline-field"><input value={epgUrl} onChange={(event) => setEpgUrl(event.target.value)} placeholder="https://example.com/guide.xml" /><button onClick={() => void importXMLUrl()} disabled={!epgUrl || loadingAction === 'epg'}>{loadingAction === 'epg' ? 'Loading…' : 'Load'}</button></div>
              </SettingsSection>
              <SettingsSection title={`Channel lineup · ${channels.length}`} detail="Reorder follows channel numbers. Validate checks every URL right here in the browser — a pass means it will actually play in this app.">
                <div className="button-row">
                  {checking
                    ? <button className="secondary-button" onClick={stopValidate}>Stop · {checking.done}/{checking.total}</button>
                    : <button className="secondary-button" onClick={() => void validateAll()}><Radio size={16} />Validate all URLs</button>}
                  {!checking && Object.values(checks).some((status) => status === 'fail' || status === 'timeout') && (
                    <button className="danger-button" onClick={removeUnreachable}><Trash2 size={16} />Remove unreachable</button>
                  )}
                </div>
                <div className="manage-list">
                  {channels.map((channel) => (
                    <div className="manage-row" key={channel.id}>
                      <input className="number-input" type="number" value={channel.number} onChange={(event) => saveChannels(channels.map((item) => item.id === channel.id ? { ...item, number: Number(event.target.value) } : item))} />
                      <div><strong>{checks[channel.id] && <span className={`check-dot check-${checks[channel.id]}`} title={checks[channel.id]} />}{channel.name}</strong><small>{channel.type.toUpperCase()} · {channel.group ?? 'Ungrouped'}</small></div>
                      <div className="preset-select">
                        <button
                          className="preset-select-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={openPresetMenuId === channel.id}
                          onClick={() => setOpenPresetMenuId((value) => value === channel.id ? null : channel.id)}
                        >
                          <span>{channel.preset ? PRESETS.find((preset) => preset.id === channel.preset)?.label : 'Global'}</span>
                          <ChevronDown size={14} />
                        </button>
                        {openPresetMenuId === channel.id && (
                          <div className="preset-select-menu" role="listbox" aria-label={`${channel.name} preset`}>
                            <button className={!channel.preset ? 'active' : ''} role="option" aria-selected={!channel.preset} onClick={() => setChannelPreset(channel.id, undefined)}>
                              <span className="preset-swatch preview-global"><i /></span>
                              <span>Global</span>
                            </button>
                            {PRESETS.map((preset) => (
                              <button key={preset.id} className={channel.preset === preset.id ? 'active' : ''} role="option" aria-selected={channel.preset === preset.id} onClick={() => setChannelPreset(channel.id, preset.id)}>
                                <span className={`preset-swatch preview-${preset.id}`}><i /></span>
                                <span>{preset.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button className={channel.favorite ? 'favorite active' : 'favorite'} onClick={() => saveChannels(channels.map((item) => item.id === channel.id ? { ...item, favorite: !item.favorite } : item))}><Heart size={15} fill={channel.favorite ? 'currentColor' : 'none'} /></button>
                      <button className="danger-icon" onClick={() => saveChannels(channels.filter((item) => item.id !== channel.id))}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              </SettingsSection>
            </>
          )}

          {settingsTab === 'display' && (
            <>
              <SettingsSection title="Display system" detail="Presets change the physical character of the screen, not the surrounding application chrome.">
                <div className="preset-grid">
                  {PRESETS.map((preset) => <button key={preset.id} className={settings.preset === preset.id ? 'active' : ''} onClick={() => updateSettings({ preset: preset.id })}><span className={`preset-preview preview-${preset.id}`}><i /></span><strong>{preset.label}</strong><small>{preset.description}</small></button>)}
                </div>
              </SettingsSection>
              <SettingsSection title="Calibration" detail="The custom values also scale the built-in analog profiles.">
                <RangeSetting label="Effect strength" value={settings.effectSettings.intensity} onChange={(value) => updateEffect('intensity', value)} />
                <RangeSetting label="Scanline density" value={settings.effectSettings.scanlines} onChange={(value) => updateEffect('scanlines', value)} />
                <RangeSetting label="Signal noise" value={settings.effectSettings.noise} onChange={(value) => updateEffect('noise', value)} />
                <RangeSetting label="Glass curvature" value={settings.effectSettings.curvature} onChange={(value) => updateEffect('curvature', value)} />
                <RangeSetting label="Colour bleed" value={settings.effectSettings.colorBleed} onChange={(value) => updateEffect('colorBleed', value)} />
                <RangeSetting label="Flicker" value={settings.effectSettings.flicker} onChange={(value) => updateEffect('flicker', value)} />
              </SettingsSection>
              <SettingsSection title="Screen usage" detail="Screen mode uses the browser window as the television panel. Cabinet mode is only a visual showcase.">
                <div className="display-mode-toggle">
                  <button className={!settings.showHardware ? 'active' : ''} onClick={() => updateSettings({ showHardware: false })}><Monitor size={16} /><span><strong>Screen</strong><small>Maximum viewing area</small></span></button>
                  <button className={settings.showHardware ? 'active' : ''} onClick={() => updateSettings({ showHardware: true })}><Tv size={16} /><span><strong>Cabinet</strong><small>Show television body</small></span></button>
                </div>
                <div className="display-mode-toggle compact">
                  <button className={settings.videoFit === 'contain' ? 'active' : ''} onClick={() => updateSettings({ videoFit: 'contain' })}><span><strong>Fit</strong><small>Keep the whole image</small></span></button>
                  <button className={settings.videoFit === 'cover' ? 'active' : ''} onClick={() => updateSettings({ videoFit: 'cover' })}><span><strong>Fill</strong><small>Crop to the panel</small></span></button>
                </div>
                <ToggleSetting label="Use the whole monitor (fullscreen)" checked={isFullscreen} onChange={toggleFullscreen} />
                <ToggleSetting label="Green-screen backdrop (for mockups)" checked={settings.chromaKey} onChange={(chromaKey) => updateSettings({ chromaKey })} />
              </SettingsSection>
              <SettingsSection title="Viewing behaviour">
                <ToggleSetting label="Autoplay channels" checked={settings.autoplay} onChange={(autoplay) => updateSettings({ autoplay })} />
                <ToggleSetting label="Remember last channel" checked={settings.rememberChannel} onChange={(rememberChannel) => updateSettings({ rememberChannel })} />
                <ToggleSetting label="Show clock on screen" checked={settings.showClock} onChange={(showClock) => updateSettings({ showClock })} />
              </SettingsSection>
            </>
          )}

          {settingsTab === 'remote' && (
            <>
              <SettingsSection title="Colour keys" detail="Assign the four shortcut buttons on the virtual remote.">
                {settings.remoteMacros.map((macro, index) => (
                  <div className="macro-editor" key={macro.id}>
                    <span className={`macro-dot macro-${macro.id}`} />
                    <input value={macro.label} maxLength={10} onChange={(event) => updateSettings((current) => ({ ...current, remoteMacros: current.remoteMacros.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value.toUpperCase() } : item) }))} />
                    <select value={macro.action.type === 'preset' ? `preset:${macro.action.preset}` : macro.action.type === 'panel' ? `panel:${macro.action.panel}` : macro.action.type === 'channel' ? `channel:${macro.action.channelId}` : 'none'} onChange={(event) => {
                      const [type, value] = event.target.value.split(':')
                      const action: RemoteAction = type === 'preset' ? { type: 'preset', preset: value as PresetId } : type === 'panel' ? { type: 'panel', panel: value as 'guide' | 'channels' | 'settings' } : type === 'channel' ? { type: 'channel', channelId: value } : { type: 'none' }
                      updateSettings((current) => ({ ...current, remoteMacros: current.remoteMacros.map((item, itemIndex) => itemIndex === index ? { ...item, action } : item) }))
                    }}>
                      <option value="none">No action</option>
                      <optgroup label="Panels"><option value="panel:guide">Programme guide</option><option value="panel:channels">Channel browser</option><option value="panel:settings">Settings</option></optgroup>
                      <optgroup label="Presets">{PRESETS.map((preset) => <option key={preset.id} value={`preset:${preset.id}`}>{preset.label}</option>)}</optgroup>
                      <optgroup label="Channels">{channels.map((channel) => <option key={channel.id} value={`channel:${channel.id}`}>{channel.number} · {channel.name}</option>)}</optgroup>
                    </select>
                  </div>
                ))}
              </SettingsSection>
              <SettingsSection title="Keyboard shortcuts">
                <div className="shortcut-grid"><span><kbd>↑</kbd><kbd>↓</kbd> Channel</span><span><kbd>←</kbd><kbd>→</kbd> Volume</span><span><kbd>Space</kbd> Play</span><span><kbd>M</kbd> Mute</span><span><kbd>G</kbd> Guide</span><span><kbd>R</kbd> Remote</span><span><kbd>S</kbd> Settings</span><span><kbd>F</kbd> Fullscreen</span></div>
              </SettingsSection>
            </>
          )}

          {settingsTab === 'data' && (
            <>
              <SettingsSection title="Local-first storage" detail="Settings stay in LocalStorage. Channel, playlist and programme data stay in IndexedDB in this browser.">
                <div className="storage-stats"><div><strong>{channels.length}</strong><span>Channels</span></div><div><strong>{programs.length}</strong><span>Programmes</span></div><div><strong>0</strong><span>Sync servers</span></div></div>
              </SettingsSection>
              <SettingsSection title="Backup" detail="Export all local data as one versioned JSON file.">
                <div className="button-row"><button className="primary-button" onClick={exportBackup}><Download size={16} />Export JSON</button><button className="secondary-button" onClick={() => importInputRef.current?.click()}><Upload size={16} />Import JSON</button></div>
                <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importBackup(event.target.files?.[0])} />
              </SettingsSection>
              <SettingsSection title="Reset demo data" detail="Removes your current lineup, guide and custom settings from this browser.">
                <button className="danger-button" onClick={resetApp}><RotateCcw size={16} />Reset application</button>
              </SettingsSection>
              <div className="compatibility-note"><Info size={17} /><p>Remote IPTV URLs must allow CORS. HTTP streams are normally blocked when this app is served over HTTPS. DRM, cookie-gated and header-dependent streams are outside a browser-only player’s reach.</p></div>
            </>
          )}
        </div>
      </aside>

      {toast && <div className="toast"><Info size={16} />{toast}</div>}
    </main>
  )
}

function DrawerHeader({ icon, title, onClose }: { icon: React.ReactNode; title: string; onClose: () => void }) {
  return <header className="drawer-header"><div>{icon}<strong>{title}</strong></div><button onClick={onClose}><X size={18} /></button></header>
}

function SettingsSection({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return <section className="settings-section"><header><h3>{title}</h3>{detail && <p>{detail}</p>}</header><div className="settings-section-body">{children}</div></section>
}

function RangeSetting({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="range-setting"><span>{label}<output>{Math.round(value * 100)}</output></span><input type="range" min="0" max="1" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function ToggleSetting({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-setting"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><MoreHorizontal size={24} /><strong>{title}</strong><span>{detail}</span></div>
}

export default App
