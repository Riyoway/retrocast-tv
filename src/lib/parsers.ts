import type { Channel, Program, SourceType } from '../types'

const attr = (line: string, name: string) => {
  const match = line.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match?.[1]?.trim() || undefined
}

export const sourceTypeFromUrl = (url: string): SourceType => {
  const value = url.toLowerCase()
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube'
  if (value.includes('.m3u8') || value.includes('application/vnd.apple.mpegurl')) return 'hls'
  return 'video'
}

export const youtubeIdFromUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1)
    if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2]
    if (parsed.pathname.startsWith('/live/')) return parsed.pathname.split('/')[2]
    return parsed.searchParams.get('v') || ''
  } catch {
    return url.trim()
  }
}

export const parseM3U = (text: string, existingCount = 0): Channel[] => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const channels: Channel[] = []
  let pending: { name: string; logo?: string; group?: string; epgId?: string; number?: number } | null = null

  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',')
      const name = comma >= 0 ? line.slice(comma + 1).trim() : `Channel ${existingCount + channels.length + 1}`
      const rawNumber = attr(line, 'tvg-chno')
      pending = {
        name,
        logo: attr(line, 'tvg-logo'),
        group: attr(line, 'group-title'),
        epgId: attr(line, 'tvg-id'),
        number: rawNumber ? Number.parseInt(rawNumber, 10) : undefined,
      }
      continue
    }

    if (line.startsWith('#')) continue

    const info = pending ?? { name: `Channel ${existingCount + channels.length + 1}` }
    channels.push({
      id: crypto.randomUUID(),
      number: Number.isFinite(info.number) ? info.number! : existingCount + channels.length + 1,
      name: info.name,
      url: line,
      type: sourceTypeFromUrl(line),
      group: info.group,
      logo: info.logo,
      epgId: info.epgId,
    })
    pending = null
  }

  return channels
}

const parseXMLTVDate = (raw: string | null) => {
  if (!raw) return new Date().toISOString()
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/)
  if (!match) return new Date(raw).toISOString()
  const [, y, m, d, hh, mm, ss, sign, offH, offM] = match
  let millis = Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss)
  if (sign && offH && offM) {
    const offset = (+offH * 60 + +offM) * 60_000
    millis += sign === '+' ? -offset : offset
  }
  return new Date(millis).toISOString()
}

export const parseXMLTV = (text: string, channels: Channel[]): Program[] => {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('Invalid XMLTV document')

  const aliases = new Map<string, string>()
  xml.querySelectorAll('channel').forEach((node) => {
    const id = node.getAttribute('id') || ''
    const displayName = node.querySelector('display-name')?.textContent?.trim() || ''
    const match = channels.find((channel) => channel.epgId === id || channel.name.toLowerCase() === displayName.toLowerCase())
    if (match) aliases.set(id, match.id)
  })

  const programs: Program[] = []
  xml.querySelectorAll('programme').forEach((node) => {
    const externalChannelId = node.getAttribute('channel') || ''
    const channelId = aliases.get(externalChannelId) || channels.find((channel) => channel.epgId === externalChannelId)?.id
    if (!channelId) return
    programs.push({
      id: crypto.randomUUID(),
      channelId,
      title: node.querySelector('title')?.textContent?.trim() || 'Untitled programme',
      description: node.querySelector('desc')?.textContent?.trim() || undefined,
      category: node.querySelector('category')?.textContent?.trim() || undefined,
      start: parseXMLTVDate(node.getAttribute('start')),
      end: parseXMLTVDate(node.getAttribute('stop')),
      icon: node.querySelector('icon')?.getAttribute('src') || undefined,
    })
  })

  return programs.sort((a, b) => a.start.localeCompare(b.start))
}
