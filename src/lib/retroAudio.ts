import type { PresetId } from '../types'

// Per-preset "period" audio. Each profile shapes the <video> element's sound into the
// speaker/tape character of its era: band-limiting, a resonant peak for the small
// enclosure, optional tape wow/flutter (pitch wobble via a modulated delay), soft
// saturation and a bed of hiss. `null` = clean (Modern), matching how the picture
// presets treat Modern as pass-through.
export interface AudioProfile {
  hp: number            // highpass corner (Hz) — rolls off the lows a small speaker can't make
  lp: number            // lowpass corner (Hz) — the treble ceiling of the medium
  peakFreq?: number     // resonant "honk" of the cabinet/cone
  peakGain?: number
  peakQ?: number
  drive?: number        // soft-clip saturation amount (0..~1)
  wowRate?: number      // slow tape wow (Hz)
  wowDepth?: number     // pitch-wobble depth (seconds of delay modulation)
  flutterRate?: number  // faster tape flutter (Hz)
  flutterDepth?: number
  hiss?: number         // tape/valve hiss level (0..1)
  hissFreq?: number     // where the hiss sits
  makeup?: number       // gain make-up, since narrow chains lose loudness
}

// Makeup gains are kept roughly matched across presets (~1.3) so switching presets
// doesn't jump the loudness. Modern is a near-transparent full-range chain rather
// than a bypass — it carries the same makeup, and the output limiter keeps that
// gain from clipping the full-range signal. Without this Modern played 1.3x quieter
// than every tape preset.
export const AUDIO_PROFILES: Record<PresetId, AudioProfile | null> = {
  modern: { hp: 20, lp: 20000, makeup: 1.3 },
  crt: { hp: 150, lp: 8000, peakFreq: 2500, peakGain: 3, peakQ: 1, hiss: 0.5, hissFreq: 5000, makeup: 1.25 },
  mono: { hp: 280, lp: 4800, peakFreq: 1600, peakGain: 5, peakQ: 1.2, drive: 0.15, hiss: 0.9, hissFreq: 3500, makeup: 1.3 },
  vhs: { hp: 90, lp: 7000, peakFreq: 3000, peakGain: -2, peakQ: 0.8, drive: 0.1, wowRate: 0.6, wowDepth: 0.0018, flutterRate: 6.5, flutterDepth: 0.0006, hiss: 0.7, hissFreq: 6000, makeup: 1.3 },
  lcd: { hp: 420, lp: 6000, peakFreq: 2200, peakGain: 4, peakQ: 1.4, drive: 0.12, hiss: 0.4, hissFreq: 5000, makeup: 1.3 },
  portable: { hp: 520, lp: 4200, peakFreq: 1500, peakGain: 6, peakQ: 1.5, drive: 0.18, hiss: 0.8, hissFreq: 3500, makeup: 1.35 },
  custom: { hp: 160, lp: 7500, peakFreq: 2500, peakGain: 2, peakQ: 1, drive: 0.08, hiss: 0.4, hissFreq: 5000, makeup: 1.25 },
}

// Soft-clip saturation curve (tanh-ish). amount 0 → near-linear.
function makeCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 60
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = (1 + k) * x / (1 + k * Math.abs(x))
  }
  return curve
}

function makeNoise(ctx: AudioContext): AudioBufferSourceNode {
  const length = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  return src
}

function buildChain(ctx: AudioContext, source: AudioNode, p: AudioProfile, intensity: number): () => void {
  const disposables: AudioNode[] = []
  const stops: (() => void)[] = []

  const master = ctx.createGain()
  master.gain.value = p.makeup ?? 1
  // Brick-wall-ish limiter: lets the make-up gain lift loudness (and hold every
  // preset at the same level) without ever hard-clipping the destination.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.12
  master.connect(limiter)
  limiter.connect(ctx.destination)
  disposables.push(master, limiter)

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = p.hp
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = p.lp
  hp.connect(lp)
  disposables.push(hp, lp)
  let tail: AudioNode = lp

  if (p.peakGain) {
    const peak = ctx.createBiquadFilter()
    peak.type = 'peaking'
    peak.frequency.value = p.peakFreq ?? 2000
    peak.Q.value = p.peakQ ?? 1
    peak.gain.value = p.peakGain
    tail.connect(peak)
    tail = peak
    disposables.push(peak)
  }

  if (p.drive) {
    const shaper = ctx.createWaveShaper()
    shaper.curve = makeCurve(p.drive * intensity)
    shaper.oversample = '2x'
    tail.connect(shaper)
    tail = shaper
    disposables.push(shaper)
  }

  // Tape wow/flutter: modulate a short delay's time to warble the pitch.
  if (p.wowDepth || p.flutterDepth) {
    const delay = ctx.createDelay(0.05)
    delay.delayTime.value = 0.006
    disposables.push(delay)
    const addLfo = (rate: number, depth: number) => {
      if (!depth) return
      const lfo = ctx.createOscillator()
      lfo.frequency.value = rate
      const gain = ctx.createGain()
      gain.gain.value = depth * intensity
      lfo.connect(gain)
      gain.connect(delay.delayTime)
      lfo.start()
      stops.push(() => { try { lfo.stop() } catch { /* already stopped */ } })
      disposables.push(gain)
    }
    addLfo(p.wowRate ?? 0.6, p.wowDepth ?? 0)
    addLfo(p.flutterRate ?? 7, p.flutterDepth ?? 0)
    tail.connect(delay)
    tail = delay
  }

  source.connect(hp)
  tail.connect(master)

  if (p.hiss) {
    const noise = makeNoise(ctx)
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = p.hissFreq ?? 4000
    band.Q.value = 0.7
    const gain = ctx.createGain()
    gain.gain.value = p.hiss * intensity * 0.02
    noise.connect(band)
    band.connect(gain)
    gain.connect(master)
    noise.start()
    stops.push(() => { try { noise.stop() } catch { /* already stopped */ } })
    disposables.push(noise, band, gain)
  }

  return () => {
    stops.forEach((stop) => stop())
    disposables.forEach((node) => { try { node.disconnect() } catch { /* not connected */ } })
  }
}

export interface RetroAudio {
  setProfile: (preset: PresetId, intensity: number) => void
  resume: () => void
  destroy: () => void
}

// Taps a media element once (createMediaElementSource is one-shot per element) and
// rebuilds the filter graph whenever the preset changes. Returns null when Web Audio
// is unavailable or the element can't be tapped — callers then keep native audio.
export function createRetroAudio(media: HTMLMediaElement): RetroAudio | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  let ctx: AudioContext
  let source: MediaElementAudioSourceNode
  try {
    ctx = new Ctor()
    source = ctx.createMediaElementSource(media)
  } catch {
    return null
  }

  let teardown = () => {}
  return {
    setProfile(preset, intensity) {
      teardown()
      teardown = () => {}
      try { source.disconnect() } catch { /* not connected */ }
      const profile = AUDIO_PROFILES[preset]
      if (!profile) {
        source.connect(ctx.destination)
        teardown = () => { try { source.disconnect() } catch { /* not connected */ } }
        return
      }
      teardown = buildChain(ctx, source, profile, Math.max(0, Math.min(1, intensity)))
      void ctx.resume()
    },
    resume() { void ctx.resume() },
    destroy() {
      teardown()
      try { source.disconnect() } catch { /* not connected */ }
      void ctx.close()
    },
  }
}
