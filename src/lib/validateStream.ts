import Hls from 'hls.js'
import type { Channel } from '../types'

// Client-side only. Each channel is probed exactly the way the player loads it —
// hls.js for HLS, a bare <video> for direct files — so a pass means "will actually
// play here" and a fail means blocked/dead/geo/CORS for this browser. YouTube can't
// be probed across the iframe boundary, so it's skipped.
export type StreamStatus = 'ok' | 'fail' | 'timeout' | 'skip'

function checkHls(url: string, timeoutMs: number): Promise<StreamStatus> {
  return new Promise((resolve) => {
    if (!Hls.isSupported()) { resolve('skip'); return }
    const video = document.createElement('video')
    video.muted = true
    const hls = new Hls({ enableWorker: false })
    let settled = false
    let timer = 0
    const finish = (status: StreamStatus) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try { hls.destroy() } catch { /* already gone */ }
      resolve(status)
    }
    timer = window.setTimeout(() => finish('timeout'), timeoutMs)
    hls.on(Hls.Events.MANIFEST_PARSED, () => finish('ok'))
    hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) finish('fail') })
    hls.loadSource(url)
    hls.attachMedia(video)
  })
}

function checkVideo(url: string, timeoutMs: number): Promise<StreamStatus> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.crossOrigin = 'anonymous'
    let settled = false
    let timer = 0
    const finish = (status: StreamStatus) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(status)
    }
    timer = window.setTimeout(() => finish('timeout'), timeoutMs)
    video.addEventListener('loadedmetadata', () => finish('ok'))
    video.addEventListener('error', () => finish('fail'))
    video.src = url
  })
}

export function checkChannel(channel: Channel, timeoutMs = 7000): Promise<StreamStatus> {
  if (channel.type === 'youtube') return Promise.resolve('skip')
  if (channel.type === 'file') return Promise.resolve(channel.handle || channel.url ? 'ok' : 'fail')
  if (channel.type === 'hls') return checkHls(channel.url, timeoutMs)
  return checkVideo(channel.url, timeoutMs)
}

// Sweep every channel with a bounded worker pool, reporting each result as it lands
// so the UI can fill in live. Aborts promptly when signal.cancelled flips.
export async function validateChannels(
  channels: Channel[],
  onResult: (id: string, status: StreamStatus, done: number) => void,
  concurrency = 6,
  signal?: { cancelled: boolean },
): Promise<void> {
  let index = 0
  let done = 0
  const worker = async () => {
    while (index < channels.length) {
      if (signal?.cancelled) return
      const channel = channels[index++]
      const status = await checkChannel(channel)
      if (signal?.cancelled) return
      done++
      onResult(channel.id, status, done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, channels.length) }, worker))
}
