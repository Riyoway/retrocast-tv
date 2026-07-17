// Public CORS proxies, tried in order. Most IPTV hosts (gitflic, many raw githost
// mirrors) serve playlists without Access-Control-Allow-Origin, so a browser-only
// player can't fetch them directly — these relay the request with CORS headers.
const PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
]

export interface RemoteText {
  text: string
  viaProxy: boolean
}

// Fetch text, trying the origin directly first (so nothing leaves for a third party
// when the host allows CORS) and only falling back to a public proxy when the direct
// request is blocked. `viaProxy` lets the caller disclose that a relay was used.
export async function fetchRemoteText(url: string): Promise<RemoteText> {
  try {
    const response = await fetch(url)
    if (response.ok) return { text: await response.text(), viaProxy: false }
  } catch {
    // CORS block or network error — fall through to the proxies.
  }
  for (const wrap of PROXIES) {
    try {
      const response = await fetch(wrap(url))
      if (!response.ok) continue
      const text = await response.text()
      if (text.trim()) return { text, viaProxy: true }
    } catch {
      // Proxy down or rate-limited — try the next one.
    }
  }
  throw new Error('unreachable')
}
