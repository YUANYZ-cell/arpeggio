import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArchiveStore } from '../src/main/archive-store'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('archive backup', () => {
  it('exports a self-describing complete archive copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arpeggio-source-'))
    const destination = await mkdtemp(join(tmpdir(), 'arpeggio-backup-'))
    roots.push(root, destination)
    const store = await ArchiveStore.open(root)
    const backup = await store.createBackup(destination, '2026-09-12T04-00-00')
    await stat(join(backup, 'archive.db'))
    const manifest = JSON.parse(await readFile(join(backup, 'BACKUP_MANIFEST.json'), 'utf8'))
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.scoreCount).toBe(0)
  })
})
