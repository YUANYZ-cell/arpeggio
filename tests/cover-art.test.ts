import { describe, expect, it, vi } from 'vitest'
import { downloadCoverArt, lookupAppleCoverArt, lookupCoverArt, prefersAppleCoverArt } from '../src/main/cover-art'

describe('cover art lookup', () => {
  it('uses only a high-confidence MusicBrainz result with a release group', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ recordings: [{
      score: 100,
      title: '紅色高跟鞋',
      releases: [{ title: '若你碰到他', 'release-group': { id: '38ef3707-0216-475d-abf2-49538e82011d' } }]
    }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    await expect(lookupCoverArt('红色高跟鞋', '蔡健雅', fetcher)).resolves.toEqual({
      albumTitle: '若你碰到他',
      imageUrl: 'https://coverartarchive.org/release-group/38ef3707-0216-475d-abf2-49538e82011d/front-500',
      sourceUrl: 'https://musicbrainz.org/release-group/38ef3707-0216-475d-abf2-49538e82011d'
    })
  })

  it('rejects uncertain matches instead of attaching the wrong artwork', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ recordings: [{ score: 72, releases: [{ title: '同名歌曲', 'release-group': { id: 'wrong' } }] }] }))) as unknown as typeof fetch
    await expect(lookupCoverArt('同名歌曲', '某位歌手', fetcher)).resolves.toBeNull()
  })

  it('accepts image payloads from the Cover Art Archive', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch
    await expect(downloadCoverArt('https://coverartarchive.org/example', fetcher)).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('uses an exact Apple Music track and artist, excluding a same-title live recording', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [
      { trackName: '一万次悲伤 (Live)', artistName: 'Escape Plan', collectionName: 'Live', artworkUrl100: 'https://is1-ssl.mzstatic.com/live/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/us/song/live' },
      { trackName: '一萬次悲傷', artistName: 'Escape Plan', collectionName: '世界', artworkUrl100: 'https://is1-ssl.mzstatic.com/original/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/us/song/original' }
    ] }))) as unknown as typeof fetch
    await expect(lookupAppleCoverArt('一万次悲伤', '逃跑计划', fetcher)).resolves.toEqual({
      albumTitle: '世界', imageUrl: 'https://is1-ssl.mzstatic.com/original/600x600bb.jpg', sourceUrl: 'https://music.apple.com/us/song/original'
    })
  })

  it('selects the original single for 等你下课 instead of a later album edition', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [
      { trackName: '等你下課 (with 楊瑞代)', artistName: '周杰倫', collectionName: '最偉大的作品', artworkUrl100: 'https://is1-ssl.mzstatic.com/later/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/tw/song/later' },
      { trackName: '等你下課 (with 楊瑞代)', artistName: '周杰倫', collectionName: '等你下課 (with 楊瑞代) - Single', artworkUrl100: 'https://is1-ssl.mzstatic.com/single/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/tw/song/single' }
    ] }))) as unknown as typeof fetch
    await expect(lookupAppleCoverArt('等你下课', '周杰伦', fetcher)).resolves.toMatchObject({
      albumTitle: '等你下課 (with 楊瑞代) - Single', imageUrl: 'https://is1-ssl.mzstatic.com/single/600x600bb.jpg'
    })
  })

  it.each([
    ['多远都要在一起', '邓紫棋', '多遠都要在一起', '鄧紫棋', '多遠都要在一起 - Single'],
    ['海阔天空', 'Beyond', '海闊天空', 'Beyond', "Rock'n'Roll"],
    ['爱人错过', '潘云安', '愛人錯過', '告五人', '我肯定在幾百年前就說過愛你']
  ])('uses the verified original artwork for %s', async (title, artist, track, performer, album) => {
    expect(prefersAppleCoverArt(title, artist)).toBe(true)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [
      { trackName: track, artistName: performer, collectionName: '现场版', artworkUrl100: 'https://is1-ssl.mzstatic.com/live/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/tw/song/live' },
      { trackName: track, artistName: performer, collectionName: album, artworkUrl100: 'https://is1-ssl.mzstatic.com/original/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/tw/song/original' }
    ] }))) as unknown as typeof fetch
    await expect(lookupAppleCoverArt(title, artist, fetcher)).resolves.toMatchObject({
      albumTitle: album, imageUrl: 'https://is1-ssl.mzstatic.com/original/600x600bb.jpg'
    })
  })
})
