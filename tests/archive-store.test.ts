import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArchiveStore } from '../src/main/archive-store'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixturePages(root: string): Promise<string[]> {
  const files = ['第1页.jpg', '第2页.jpg', '第3页.jpg', '第4页.jpg'].map((name) => join(root, name))
  await Promise.all(files.map((path, index) => writeFile(path, Buffer.from([0xff, 0xd8, 0xff, index, 1, 2, 3]))))
  return files
}

describe('archive store', () => {
  it('imports a score transactionally and can reopen it from sqlite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arpeggio-test-'))
    temporaryRoots.push(root)
    const pages = await fixturePages(root)
    const store = await ArchiveStore.open(join(root, 'library'), async () => null)

    const result = await store.importScore(pages, {
      title: '红色高跟鞋',
      artist: '蔡健雅',
      guitarType: 'acoustic',
      scoreType: '弹唱谱',
      originalKey: 'D',
      key: 'C',
      capo: 2,
      tags: ['弹唱', '流行']
    })

    expect(result.status).toBe('imported')
    expect(result.score.archiveNumber).toBe('AC-0001')
    await stat(join(root, 'library', 'archive.db'))
    const sidecar = JSON.parse(await readFile(join(root, 'library', 'Metadata', 'AC-0001.json'), 'utf8'))
    expect(sidecar.pageCount).toBe(4)

    const reopened = await ArchiveStore.open(join(root, 'library'), async () => null)
    expect((await reopened.listScores())[0]).toMatchObject({ title: '红色高跟鞋', pageCount: 4, capo: 2 })
  })

  it('reports an exact ordered-page duplicate without consuming a number', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arpeggio-test-'))
    temporaryRoots.push(root)
    const pages = await fixturePages(root)
    const store = await ArchiveStore.open(join(root, 'library'), async () => null)
    const metadata = { title: '红色高跟鞋', artist: '蔡健雅', guitarType: 'acoustic' as const, scoreType: '弹唱谱' }

    await store.importScore(pages, metadata)
    const duplicate = await store.importScore(pages, metadata)

    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.score.archiveNumber).toBe('AC-0001')
    expect(await store.allocateNumber('acoustic')).toBe('AC-0002')
  })

  it('reloads scores imported by another archive process before listing or saving state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arpeggio-test-'))
    temporaryRoots.push(root)
    const archiveRoot = join(root, 'library')
    const first = await ArchiveStore.open(archiveRoot, async () => null)
    const second = await ArchiveStore.open(archiveRoot, async () => null)
    const pages = await fixturePages(root)

    await second.importScore(pages, { title: '外部入库曲目', artist: '测试', guitarType: 'acoustic', scoreType: '弹唱谱' })
    expect((await first.listScores()).map((score) => score.title)).toContain('外部入库曲目')

    const state = await first.getLibraryState()
    await first.saveLibraryState(state)
    const reopened = await ArchiveStore.open(archiveRoot, async () => null)
    expect((await reopened.listScores()).map((score) => score.title)).toContain('外部入库曲目')
  })

  it('recovers an already downloaded cover when its index was left unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arpeggio-test-'))
    temporaryRoots.push(root)
    const store = await ArchiveStore.open(join(root, 'library'), async () => { throw new Error('offline') })
    const pages = await fixturePages(root)
    const result = await store.importScore(pages, { title: '测试歌曲', artist: '测试歌手', guitarType: 'acoustic', scoreType: '弹唱谱' })
    const cover = join(root, 'library', 'Library', 'Acoustic', result.score.archiveNumber, 'cover-art')
    await writeFile(cover, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))

    const [refreshed] = await store.refreshMissingCovers()
    expect(refreshed).toMatchObject({ coverFile: 'Library/Acoustic/AC-0001/cover-art', coverLookupStatus: 'matched' })
    expect(JSON.parse(await readFile(join(root, 'library', 'Metadata', 'AC-0001.json'), 'utf8')).coverFile).toBe(refreshed.coverFile)
  })

  it('attaches an original cover to an anonymous classical score', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arpeggio-test-'))
    temporaryRoots.push(root)
    const archiveRoot = join(root, 'library')
    const pages = await fixturePages(root)
    const store = await ArchiveStore.open(archiveRoot, async () => null)
    const imported = await store.importScore(pages, { title: '爱的罗曼史', artist: '', guitarType: 'acoustic', scoreType: '指弹谱' })
    const cover = join(root, 'original.png')
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    await writeFile(cover, bytes)

    const updated = await store.setCustomCover(imported.score.id, cover)
    expect(updated).toMatchObject({ coverLookupStatus: 'matched', albumTitle: 'Arpeggio 原创封面' })
    expect(await readFile(join(archiveRoot, updated.coverFile!))).toEqual(bytes)
    const reopened = await ArchiveStore.open(archiveRoot, async () => null)
    expect((await reopened.listScores())[0].coverFile).toBe(updated.coverFile)
  })
})
