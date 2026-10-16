export interface CoverArtMatch {
  albumTitle: string
  imageUrl: string
  sourceUrl: string
}

interface MusicBrainzRecording {
  score?: number
  title?: string
  releases?: Array<{ title?: string; 'release-group'?: { id?: string } }>
}

const requestHeaders = {
  Accept: 'application/json',
  'User-Agent': 'ArpeggioArchive/0.1 (private local music library)'
}

export async function lookupCoverArt(title: string, artist: string, fetcher: typeof fetch = fetch): Promise<CoverArtMatch | null> {
  if (!title.trim() || !artist.trim()) return null
  const query = `recording:"${title.replaceAll('"', '')}" AND artist:"${artist.replaceAll('"', '')}"`
  const url = new URL('https://musicbrainz.org/ws/2/recording/')
  url.searchParams.set('query', query)
  url.searchParams.set('fmt', 'json')
  url.searchParams.set('limit', '5')
  const response = await fetcher(url, { headers: requestHeaders, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`MusicBrainz lookup failed: ${response.status}`)
  const payload = await response.json() as { recordings?: MusicBrainzRecording[] }
  const recording = payload.recordings?.find((item) => (item.score ?? 0) >= 90 && item.releases?.some((release) => release['release-group']?.id))
  const release = recording?.releases?.find((item) => item['release-group']?.id)
  const releaseGroupId = release?.['release-group']?.id
  if (!releaseGroupId) return null
  return {
    albumTitle: release?.title?.trim() || recording?.title?.trim() || title.trim(),
    imageUrl: `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`,
    sourceUrl: `https://musicbrainz.org/release-group/${releaseGroupId}`
  }
}

const appleNameAliases: Record<string, { title: string; artist: string; country?: string; album?: string }> = {
  '生如夏花|朴树': { title: 'Life Like Summer Flowers', artist: 'Pu Shu' },
  '一万次悲伤|逃跑计划': { title: '一萬次悲傷', artist: 'Escape Plan' },
  '等你下课|周杰伦': { title: '等你下課 (with 楊瑞代)', artist: '周杰倫', country: 'TW', album: '等你下課 (with 楊瑞代) - Single' },
  '多远都要在一起|邓紫棋': { title: '多遠都要在一起', artist: '鄧紫棋', country: 'TW', album: '多遠都要在一起 - Single' },
  '海阔天空|Beyond': { title: '海闊天空', artist: 'Beyond', country: 'TW', album: "Rock'n'Roll" },
  '爱人错过|潘云安': { title: '愛人錯過', artist: '告五人', country: 'TW', album: '我肯定在幾百年前就說過愛你' }
}

export function prefersAppleCoverArt(title: string, artist: string): boolean {
  return `${title.trim()}|${artist.trim()}` in appleNameAliases
}

export async function lookupAppleCoverArt(title: string, artist: string, fetcher: typeof fetch = fetch): Promise<CoverArtMatch | null> {
  if (!title.trim() || !artist.trim()) return null
  const expected = appleNameAliases[`${title.trim()}|${artist.trim()}`] ?? { title: title.trim(), artist: artist.trim() }
  const url = new URL('https://itunes.apple.com/search')
  url.searchParams.set('term', `${expected.title} ${expected.artist}`)
  url.searchParams.set('media', 'music')
  url.searchParams.set('entity', 'song')
  url.searchParams.set('country', expected.country || 'US')
  url.searchParams.set('limit', '50')
  const response = await fetcher(url, { headers: requestHeaders, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`Apple Music lookup failed: ${response.status}`)
  const payload = await response.json() as { results?: Array<{ trackName?: string; artistName?: string; collectionName?: string; artworkUrl100?: string; trackViewUrl?: string }> }
  const match = payload.results?.find((item) => item.trackName?.trim().toLocaleLowerCase() === expected.title.toLocaleLowerCase() && item.artistName?.trim().toLocaleLowerCase() === expected.artist.toLocaleLowerCase() && (!expected.album || item.collectionName === expected.album))
  if (!match?.artworkUrl100 || !match.trackViewUrl) return null
  const artwork = new URL(match.artworkUrl100)
  const source = new URL(match.trackViewUrl)
  if (artwork.protocol !== 'https:' || !artwork.hostname.endsWith('.mzstatic.com') || source.protocol !== 'https:' || source.hostname !== 'music.apple.com') return null
  return {
    albumTitle: match.collectionName?.trim() || title.trim(),
    imageUrl: artwork.toString().replace(/\/100x100bb\.jpg$/, '/600x600bb.jpg'),
    sourceUrl: source.toString()
  }
}

export async function downloadCoverArt(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(url, { headers: requestHeaders, redirect: 'follow', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Cover Art Archive download failed: ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) throw new Error('Cover Art Archive returned a non-image response')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('Cover artwork exceeds the 12 MB safety limit')
  return bytes
}
