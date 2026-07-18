import { useEffect, useRef } from 'react'
import type { EffectSettings, PresetId } from '../types'

interface Props {
  preset: PresetId
  settings: EffectSettings
}

// Additive overlay, blended over the video with `mix-blend-mode: overlay`, so 0.5
// is the neutral (pass-through) value and deviations from it darken/lighten the
// picture. Everything here is analog *signal* damage that sits on top of the image;
// the chroma bleed / colour-shift that has to act on the picture itself lives in the
// SVG filters below (composited, so it works on cross-origin video and iframes too).
const fragmentSource = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_noise;      // tape grain
uniform float u_scanlines;  // scanline depth
uniform float u_flicker;    // AGC + interlace flicker
uniform float u_vhs;        // VHS artefact master (0 unless a tape preset)
uniform float u_bleed;      // chroma noise / dot-crawl

float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453123); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;   // y: 0 = bottom of picture
  float px = gl_FragCoord.x;
  float py = gl_FragCoord.y;
  float y = uv.y;
  float t = u_time;

  // Tape grain, refreshed ~30/s for a period-correct shimmer, weighted to shadows.
  float grain = (rand(vec2(px, py) + floor(t * 30.0)) - 0.5) * u_noise * 0.5;

  // Scanlines + interlace field shimmer — the alternating fields are the "fps" cue.
  float field = mod(floor(t * 50.0), 2.0);
  float lines = sin((py + field * 0.5) * 3.14159) * 0.5 + 0.5;
  float scan = lines * u_scanlines * 0.2;

  // Chroma dot-crawl: coloured high-frequency noise along the line.
  vec3 chroma = vec3(
    rand(vec2(px * 0.5, py) + t * 7.0),
    rand(vec2(px * 0.5 + 31.0, py) + t * 7.0),
    rand(vec2(px * 0.5 + 57.0, py) + t * 7.0)
  );
  chroma = (chroma - 0.5) * (u_bleed * 0.22 + u_vhs * 0.12);

  // Tracking band: a noisy desync line drifting slowly up the frame.
  float trkY = fract(t * 0.02);
  float track = smoothstep(0.03, 0.0, abs(y - trkY)) * u_vhs;
  float trackNoise = track * (rand(vec2(px, floor(py * 0.5) + floor(t * 40.0))) * 0.9);

  // Head-switching tear across the bottom ~7% of the picture, plus its bright wash.
  float hs = smoothstep(0.07, 0.0, y);
  float hsNoise = hs * u_vhs * (rand(vec2(px * 0.7, floor(py) + floor(t * 24.0))) * 1.1);
  float hsWash = hs * u_vhs * 0.22;

  // Occasional dropout: a short bright horizontal dash.
  float dropRow = step(0.997, rand(vec2(floor(py * 0.5), floor(t * 12.0))));
  float dropX = step(0.6, rand(vec2(floor(px * 0.15), floor(py * 0.5) + floor(t * 12.0))));
  float dropout = dropRow * dropX * u_vhs * 0.5;

  // Slow AGC breathing + mains-hum flicker + per-field brightness bump.
  float agc = (sin(t * 1.7) * 0.02 + sin(t * 0.6) * 0.015) * u_vhs;
  float flick = sin(t * 54.0) * u_flicker * 0.03 + (field - 0.5) * u_flicker * 0.045;

  float luma = grain - scan + hsNoise * 0.5 + trackNoise * 0.4 + hsWash + dropout + agc + flick;
  vec3 col = vec3(0.5 + luma) + chroma;
  col += vec3(track * 0.5, track * 0.62, track * 0.7);   // tracking reads slightly blue

  float alpha = clamp(
    abs(grain) + scan + hsNoise + trackNoise + track + dropout
      + abs(chroma.r) + abs(chroma.b) + abs(flick),
    0.0, 0.72
  );
  gl_FragColor = vec4(col, alpha);
}`

const vertexSource = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

export function AnalogOverlay({ preset, settings }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false })
    if (!gl) return

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }

    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource))
    gl.linkProgram(program)
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const uniforms = {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      noise: gl.getUniformLocation(program, 'u_noise'),
      scanlines: gl.getUniformLocation(program, 'u_scanlines'),
      flicker: gl.getUniformLocation(program, 'u_flicker'),
      vhs: gl.getUniformLocation(program, 'u_vhs'),
      bleed: gl.getUniformLocation(program, 'u_bleed'),
    }

    let frame = 0
    const started = performance.now()
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio))
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
    }

    const scanlinePresets = ['crt', 'mono', 'portable', 'custom']
    const render = () => {
      resize()
      const t = (performance.now() - started) / 1000
      const active = preset !== 'modern'
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
      gl.uniform1f(uniforms.time, t)
      gl.uniform1f(uniforms.noise, active ? settings.noise * settings.intensity : 0)
      gl.uniform1f(uniforms.scanlines, scanlinePresets.includes(preset) ? settings.scanlines * settings.intensity : preset === 'vhs' ? settings.scanlines * 0.5 : 0.15)
      gl.uniform1f(uniforms.flicker, active ? settings.flicker * settings.intensity : 0)
      gl.uniform1f(uniforms.vhs, preset === 'vhs' ? settings.intensity : preset === 'custom' ? settings.noise * 0.3 : 0)
      gl.uniform1f(uniforms.bleed, active ? settings.colorBleed * settings.intensity : 0)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      frame = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(frame)
      gl.deleteProgram(program)
      gl.deleteBuffer(buffer)
    }
  }, [preset, settings])

  return (
    <>
      <canvas ref={ref} className="analog-overlay" aria-hidden="true" />
      <AnalogFilters />
    </>
  )
}

// Compositor-level SVG filters referenced from CSS (`filter: url(#id)`). Unlike a
// WebGL pass these need no pixel read-back, so they act on the real picture even for
// cross-origin <video> and the YouTube <iframe> — that's how the chroma bleed and
// RGB convergence reach every source. Resolved globally by id, so placement is moot.
function AnalogFilters() {
  return (
    <svg className="analog-filters" width="0" height="0" aria-hidden="true">
      <defs>
        {/* VHS: low-bandwidth luma smear + chroma carried right (red) / left (blue),
            with the offsets wobbling to fake time-base error. */}
        <filter id="vhs-bleed" x="-3%" y="-1%" width="106%" height="102%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.9 0" result="smear" />
          <feColorMatrix in="smear" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="rCh" />
          <feOffset in="rCh" dx="2.6" dy="0" result="rMove">
            <animate attributeName="dx" values="2.6;3.5;2.1;3;2.6" dur="2.7s" repeatCount="indefinite" />
          </feOffset>
          <feColorMatrix in="smear" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="gCh" />
          <feColorMatrix in="smear" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="bCh" />
          <feOffset in="bCh" dx="-1.9" dy="0" result="bMove">
            <animate attributeName="dx" values="-1.9;-2.7;-1.4;-2.2;-1.9" dur="3.3s" repeatCount="indefinite" />
          </feOffset>
          <feBlend in="rMove" in2="gCh" mode="screen" result="rg" />
          <feBlend in="rg" in2="bMove" mode="screen" />
        </filter>

        {/* CRT: subtle static RGB convergence error at the shadow mask. */}
        <filter id="crt-fringe" x="-1%" y="-1%" width="102%" height="102%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx="0.6" dy="0" result="ro" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feOffset in="b" dx="-0.6" dy="0" result="bo" />
          <feBlend in="ro" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="bo" mode="screen" />
        </filter>

        {/* Convex tube glass: a compositor displacement that bends the full picture
            before the reflective glass/vignette layers are drawn over it. */}
        <filter id="tube-lens-strong" x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="13" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="tube-lens-soft" x="-3%" y="-3%" width="106%" height="106%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.01" numOctaves="2" seed="11" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="7" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}
