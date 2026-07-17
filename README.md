# Retrocast TV

A local-first, browser-based IPTV player that treats the screen as a television set rather than a generic video window.

The project is a pure client-side React application. It supports M3U/M3U8 sources, HLS playback, YouTube embeds, XMLTV programme data, configurable remote shortcuts, local backups and several display-system presets.

## Included features

- M3U file import and remote M3U URL loading
- Individual HLS, regular video and YouTube source creation
- HLS.js playback with native-HLS fallback
- YouTube Privacy-Enhanced Mode embeds with JavaScript controls
- Modern, colour CRT, black-and-white CRT, VHS, early LCD, portable TV and custom display profiles
- Stronger WebGL-generated scanline, grain, flicker and VHS tracking overlays
- CSS-based phosphor masks, pixel grids, screen curvature, overscan, glass and display-character simulation
- Screen-first viewing mode that fills the browser window, with an optional presentation cabinet mode
- Fit and fill video scaling options
- Auto-hiding viewing controls and channel OSD
- Virtual remote with numeric tuning, channel/volume controls and four assignable macro keys
- XMLTV file or URL import and programme-guide matching by `tvg-id` or display name
- Channel favourites, numbering, deletion and per-channel display presets
- Keyboard shortcuts and fullscreen mode
- LocalStorage for lightweight settings
- IndexedDB for channels and programme data
- Versioned JSON backup and restore
- Installable PWA shell
- Responsive desktop and mobile layouts

## Framework choice

This application intentionally uses **Vite + React + TypeScript**, rather than Next.js. There is no server-rendered or server-owned application state, so a static CSR build keeps deployment, privacy boundaries and local data ownership straightforward.

## Development

Requirements:

- Node.js 20 or newer
- npm

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

The generated static application is written to `dist/` and can be hosted on any static web host.

## Keyboard controls

| Key | Action |
| --- | --- |
| `↑` / `↓` | Next / previous channel |
| `←` / `→` | Volume down / up |
| `0`–`9` | Enter a channel number |
| `Enter` | Tune entered channel number |
| `Space` | Play / pause |
| `M` | Mute |
| `G` | Programme guide |
| `R` | Virtual remote |
| `S` | Settings |
| `F` | Fullscreen |
| `Esc` | Close panel |

## Browser constraints

A browser-only IPTV player cannot bypass source-server restrictions.

- Remote M3U, XMLTV and HLS endpoints must permit CORS.
- HTTPS deployments normally cannot load plain HTTP media.
- DRM streams are not supported by the standard HLS.js path.
- Streams that require custom `User-Agent`, `Referer`, cookies or other protected headers may fail in the browser.
- YouTube sources use an official embedded player rather than extracting media URLs.
- Autoplay with sound may be blocked until the user interacts with the page.

## Storage model

No application account or sync backend is included.

- LocalStorage: display settings, volume, last channel and remote configuration
- IndexedDB: channels and programme-guide entries
- Export: a single versioned JSON file containing settings, channels and programmes

Removing browser site data also removes the locally stored configuration unless it has been exported.

## Project structure

```text
src/
  components/
    AnalogOverlay.tsx   WebGL analog-signal overlay
    MediaPlayer.tsx     HLS, video and YouTube playback
  lib/
    parsers.ts          M3U and XMLTV parsing
    storage.ts          LocalStorage and IndexedDB persistence
  App.tsx               Application UI and interaction model
  App.css               Television, remote and panel design system
  types.ts              Shared data contracts
public/
  icon.svg
  manifest.webmanifest
  sw.js
```

## Validation performed

- TypeScript production build
- Oxlint React and hooks checks
- M3U metadata parser smoke test
- HLS and YouTube source-type detection smoke test
- Static preview server and production asset response check
