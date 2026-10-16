import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArchiveStore } from '../src/main/archive-store'

const temporaryRoots: string[] = []
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('library state', () => {
  it('provides durable defaults and persists user collections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arpeggio-state-'))
    temporaryRoots.push(root)
    const store = await ArchiveStore.open(root)
    const initial = await store.getLibraryState()
    expect(initial.settings.viewer.mode).toBe('single')
    expect(initial.settings.performance.warningSeconds).toBe(3)

    await store.saveLibraryState({
      ...initial,
      setlists: [{ id: 'live', name: '周五排练', scoreIds: ['AC-0001'], createdAt: '2026-09-12T00:00:00.000Z' }],
      bookmarks: [{ id: 'solo', scoreId: 'AC-0001', pageIndex: 2, label: 'Solo', createdAt: '2026-09-12T00:00:00.000Z' }]
    })
    const reopened = await ArchiveStore.open(root)
    expect((await reopened.getLibraryState()).setlists[0].scoreIds).toEqual(['AC-0001'])
    expect((await reopened.getLibraryState()).bookmarks[0].pageIndex).toBe(2)
  })
})
