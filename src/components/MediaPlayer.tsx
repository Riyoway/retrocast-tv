import Hls from 'hls.js'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Channel, PresetId } from '../types'
import { youtubeIdFromUrl } from '../lib/parsers'
import { createRetroAudio, type RetroAudio } from '../lib/retroAudio'

export interface MediaHandle {
  play: () => void
  pause: () => void
  toggle: () => void
  setVolume: (value: number) => void
  setMuted: (value: boolean) => void
  seek: (deltaSeconds: number) => void
  seekToFraction: (fraction: number) => void
}

interface Props {
  channel?: Channel
  autoplay: boolean
  volume: number
  muted: boolean
  preset: PresetId
  intensity: number
  playbackRate: number
  onPlayingChange: (playing: boolean) => void
  onStatus: (status: string) => void
  onTime?: (current: number, duration: number) => void
}

export const MediaPlayer = forwardRef<MediaHandle, Props>(function MediaPlayer(
  { channel, autoplay, volume, muted, preset, intensity, playbackRate, onPlayingChange, onStatus, onTime },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const retroAudioRef = useRef<RetroAudio | null>(null)
  const boundElementRef = useRef<HTMLVideoElement | null>(null)
  // A television always plays when you change channel: the autoplay setting only
  // governs the very first load; every later tune plays regardless.
  const hasLoadedRef = useRef(false)
  const ytStateRef = useRef({ current: 0, duration: 0 })
  const [playing, setPlaying] = useState(false)

  const sendYouTube = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')
  }, [])

  const setPlaybackState = useCallback((next: boolean) => {
    setPlaying(next)
    onPlayingChange(next)
  }, [onPlayingChange])

  useImperativeHandle(ref, () => ({
    play: () => {
      if (channel?.type === 'youtube') {
        sendYouTube('playVideo')
        setPlaybackState(true)
      } else {
        void videoRef.current?.play()
      }
    },
    pause: () => {
      if (channel?.type === 'youtube') {
        sendYouTube('pauseVideo')
        setPlaybackState(false)
      } else {
        videoRef.current?.pause()
      }
    },
    toggle: () => {
      if (channel?.type === 'youtube') {
        sendYouTube(playing ? 'pauseVideo' : 'playVideo')
        setPlaybackState(!playing)
        return
      }
      const video = videoRef.current
      if (!video) return
      if (video.paused) void video.play()
      else video.pause()
    },
    setVolume: (value) => {
      if (channel?.type === 'youtube') sendYouTube('setVolume', [Math.round(value * 100)])
      if (videoRef.current) videoRef.current.volume = value
    },
    setMuted: (value) => {
      if (channel?.type === 'youtube') sendYouTube(value ? 'mute' : 'unMute')
      if (videoRef.current) videoRef.current.muted = value
    },
    seek: (delta) => {
      if (channel?.type === 'youtube') {
        const target = Math.max(0, ytStateRef.current.current + delta)
        sendYouTube('seekTo', [target, true])
        ytStateRef.current.current = target
      } else {
        const video = videoRef.current
        if (!video) return
        const max = Number.isFinite(video.duration) ? video.duration : video.currentTime + delta
        video.currentTime = Math.max(0, Math.min(max, video.currentTime + delta))
      }
    },
    seekToFraction: (fraction) => {
      const f = Math.max(0, Math.min(1, fraction))
      if (channel?.type === 'youtube') {
        if (ytStateRef.current.duration) sendYouTube('seekTo', [f * ytStateRef.current.duration, true])
      } else {
        const video = videoRef.current
        if (video && Number.isFinite(video.duration)) video.currentTime = f * video.duration
      }
    },
  }), [channel?.type, playing, sendYouTube, setPlaybackState])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
    if (channel?.type === 'youtube') sendYouTube('setPlaybackRate', [playbackRate])
  }, [playbackRate, channel?.type, sendYouTube])

  // Track the YouTube iframe's clock so relative skip and the scrubber work there too.
  useEffect(() => {
    if (channel?.type !== 'youtube') return
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      try {
        const info = (JSON.parse(event.data) as { info?: { currentTime?: number; duration?: number } }).info
        if (info && typeof info.currentTime === 'number') {
          ytStateRef.current = { current: info.currentTime, duration: info.duration ?? ytStateRef.current.duration }
          onTime?.(info.currentTime, info.duration ?? 0)
        }
      } catch { /* not a player message */ }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [channel?.type, onTime])

  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.volume = volume
      video.muted = muted
    }
    if (channel?.type === 'youtube') {
      sendYouTube('setVolume', [Math.round(volume * 100)])
      sendYouTube(muted ? 'mute' : 'unMute')
    }
  }, [volume, muted, channel?.type, sendYouTube])

  // Period-accurate audio: shape the <video> sound to match the picture preset.
  // YouTube plays in a cross-origin iframe whose audio can't be tapped, so it stays
  // clean — same boundary as the video chroma filters.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (boundElementRef.current !== video) {
      retroAudioRef.current?.destroy()
      retroAudioRef.current = createRetroAudio(video)
      boundElementRef.current = video
    }
    retroAudioRef.current?.setProfile(preset, intensity)
  }, [preset, intensity, channel?.type])

  useEffect(() => () => {
    retroAudioRef.current?.destroy()
    retroAudioRef.current = null
    boundElementRef.current = null
  }, [])

  useEffect(() => {
    const video = videoRef.current
    hlsRef.current?.destroy()
    hlsRef.current = null
    setPlaybackState(false)
    const shouldPlay = autoplay || hasLoadedRef.current
    if (!video || !channel || channel.type === 'youtube') {
      if (channel?.type === 'youtube') onStatus('Ready')
      hasLoadedRef.current = true
      return
    }

    let objectUrl = ''
    const attach = (src: string) => {
      video.src = src
      video.load()
      video.playbackRate = playbackRate
      onStatus('Ready')
      if (shouldPlay) void video.play().catch(() => onStatus('Press play'))
    }

    onStatus('Connecting')
    if (channel.type === 'file') {
      // Local media: resolve the stored File System Access handle to a fresh object
      // URL. After a reload the first tune re-confirms read permission (the tune
      // click's transient activation covers the prompt).
      onStatus('Opening file')
      void (async () => {
        try {
          let src = channel.url
          const handle = channel.handle
          if (handle?.getFile) {
            if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') {
              if ((await handle.requestPermission?.({ mode: 'read' })) !== 'granted') throw new Error('denied')
            }
            objectUrl = URL.createObjectURL(await handle.getFile())
            src = objectUrl
          }
          if (!src) throw new Error('missing')
          attach(src)
        } catch {
          onStatus('Retune to allow file access')
        }
      })()
    } else if (channel.type === 'hls' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
      })
      hls.loadSource(channel.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        onStatus('Ready')
        if (shouldPlay) void video.play().catch(() => onStatus('Press play'))
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          onStatus('Reconnecting')
          hls.startLoad()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          onStatus('Recovering')
          hls.recoverMediaError()
        } else {
          onStatus('Stream error')
          hls.destroy()
        }
      })
      hlsRef.current = hls
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || channel.type === 'video') {
      attach(channel.url)
    } else {
      onStatus('Unsupported')
    }

    hasLoadedRef.current = true
    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      video.removeAttribute('src')
      video.load()
    }
  }, [channel, autoplay, playbackRate, onStatus, setPlaybackState])

  if (!channel) {
    return <div className="empty-screen"><span>NO SIGNAL</span><small>Add a channel from Settings</small></div>
  }

  if (channel.type === 'youtube') {
    const id = youtubeIdFromUrl(channel.url)
    const origin = encodeURIComponent(window.location.origin)
    return (
      <iframe
        ref={iframeRef}
        className="youtube-frame"
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=${autoplay || hasLoadedRef.current ? 1 : 0}&rel=0&modestbranding=1&enablejsapi=1&origin=${origin}`}
        title={channel.name}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        onLoad={() => {
          onStatus('Ready')
          sendYouTube('setVolume', [Math.round(volume * 100)])
          if (muted) sendYouTube('mute')
          sendYouTube('setPlaybackRate', [playbackRate])
          if (autoplay || hasLoadedRef.current) {
            sendYouTube('playVideo')
            setPlaybackState(true)
          }
        }}
      />
    )
  }

  return (
    <video
      ref={videoRef}
      className="video-element"
      playsInline
      crossOrigin="anonymous"
      onPlay={() => { setPlaybackState(true); onStatus('Live'); retroAudioRef.current?.resume() }}
      onPause={() => setPlaybackState(false)}
      onWaiting={() => onStatus('Buffering')}
      onCanPlay={() => onStatus(playing ? 'Live' : 'Ready')}
      onTimeUpdate={(event) => onTime?.(event.currentTarget.currentTime, event.currentTarget.duration)}
      onLoadedMetadata={(event) => onTime?.(event.currentTarget.currentTime, event.currentTarget.duration)}
    />
  )
})
