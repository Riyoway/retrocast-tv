# Retrocast TV

A web app that turns online video into the feeling of watching it on a nostalgic retro television.

https://tv.riyo.me/

## Features

- Play YouTube URLs
- Play HLS streams (`.m3u8`)
- Play direct video file URLs such as MP4 and WebM
- Import M3U / M3U8 playlists
- Import XMLTV programme guides
- Add local video files and folders
- Browse channels, search, filter by group, and view a programme guide
- Validate whether channel URLs can actually play in the browser
- Store settings, channels, and guide data locally
- Export and import JSON backups
- Install as a PWA

## Display Systems

Retrocast TV can wrap video in several display presets and generated television frames.

- Modern
- CRT
- B&W CRT
- VHS
- Early LCD
- Portable
- Custom

Older presets such as CRT, VHS, and Portable include scanlines, chroma bleed, noise, rounded glass, and subtle convex tube-lens distortion.

## Remote Control

The app includes an on-screen virtual remote with a photorealistic generated body and clickable controls.

- Power
- Volume
- Mute
- Channel up / down
- Number keys
- Play / pause
- Seek backward / forward
- Fullscreen
- Assignable color shortcut buttons

## Offline / PWA

Retrocast TV can be installed as a PWA.

After installation, the app shell, icons, generated television frames, remote image, and production JS/CSS assets are cached by the Service Worker so the interface can load offline.

Some features still require a network connection:

- YouTube playback
- External IPTV / HLS streams
- Fetching external M3U / XMLTV URLs
- CORS proxy requests
- External media that has not already been cached by the browser

Local video files and saved settings/channel data can be used offline within the limits of the browser's file access permissions.

## Supported Sources

### YouTube

```text
https://www.youtube.com/watch?v=...
https://youtu.be/...
```

### HLS

```text
https://example.com/live/playlist.m3u8
```

### Direct Video URLs

```text
https://example.com/movie.mp4
https://example.com/video.webm
```

The file must be playable by the browser, and the host must allow browser access through CORS when required.

### Playlists / EPG

```text
playlist.m3u
playlist.m3u8
guide.xml
```

M3U metadata such as `tvg-id`, `tvg-logo`, `tvg-chno`, and `group-title` is parsed and can be matched with XMLTV programme data.

## Local-First Storage

Retrocast TV is local-first and does not require accounts or server sync.

- Settings: LocalStorage
- Channels and programme data: IndexedDB
- Local files: File System Access API or standard file picker

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Lint:

```bash
npm run lint
```

## Tech Stack

- React
- TypeScript
- Vite
- hls.js
- Service Worker / PWA
