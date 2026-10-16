import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import {
  allocateArchiveNumber,
  buildScoreRecord,
  type GuitarType,
  type ScoreRecord,
  type ScoreRecordInput
} from '../shared/score-domain'
import { defaultLibraryState, type LibraryState } from '../shared/library-state'
import { downloadCoverArt, lookupAppleCoverArt, lookupCoverArt, prefersAppleCoverArt, type CoverArtMatch } from './cover-art'

export type ImportMetadata = Omit<ScoreRecordInput, 'archiveNumber' | 'pageFiles' | 'sourceHashes' | 'albumTitle' | 'coverFile' | 'coverSourceUrl' | 'coverLookupStatus'>
export interface ImportResult {
  status: 'imported' | 'duplicate'
  score: ScoreRecord
}

const require = createRequire(import.meta.url)

async function sha256(path: string): Promise<string> {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

function fingerprint(hashes: string[]): string {
  return createHash('sha256').update(hashes.join(':')).digest('hex')
}

function asScore(value: unknown): ScoreRecord {
  return value as ScoreRecord
}

export class ArchiveStore {
  private constructor(
    readonly root: string,
    private database: Database,
    private readonly databasePath: string,
    private readonly sql: SqlJsStatic,
    private readonly coverLookup: (title: string, artist: string) => Promise<CoverArtMatch | null>
  ) {}

  private diskHash = ''

  private async syncFromDisk(): Promise<void> {
    const bytes = await readFile(this.databasePath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash === this.diskHash) return
    const replacement = new this.sql.Database(new Uint8Array(bytes))
    this.database.close()
    this.database = replacement
    this.diskHash = hash
  }

  static async open(root: string, coverLookup: (title: string, artist: string) => Promise<CoverArtMatch | null> = lookupCoverArt): Promise<ArchiveStore> {
    await mkdir(root, { recursive: true })
    await Promise.all([
      mkdir(join(root, 'Library', 'Acoustic'), { recursive: true }),
      mkdir(join(root, 'Library', 'Electric'), { recursive: true }),
      mkdir(join(root, 'Metadata'), { recursive: true }),
      mkdir(join(root, 'Backups'), { recursive: true }),
      mkdir(join(root, 'Import Inbox'), { recursive: true })
    ])
    const databasePath = join(root, 'archive.db')
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
    let bytes: Uint8Array | undefined
    try {
      bytes = new Uint8Array(await readFile(databasePath))
    } catch {
      bytes = undefined
    }
    const database = bytes ? new SQL.Database(bytes) : new SQL.Database()
    database.run(`
      CREATE TABLE IF NOT EXISTS scores (
        id TEXT PRIMARY KEY,
        archive_number TEXT NOT NULL UNIQUE,
        fingerprint TEXT NOT NULL UNIQUE,
        guitar_type TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        score_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scores_title ON scores(title);
      CREATE INDEX IF NOT EXISTS idx_scores_guitar_type ON scores(guitar_type);
      CREATE TABLE IF NOT EXISTS app_state (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const store = new ArchiveStore(root, database, databasePath, SQL, coverLookup)
    await store.persist()
    return store
  }

  async listScores(): Promise<ScoreRecord[]> {
    await this.syncFromDisk()
    const statement = this.database.prepare('SELECT score_json FROM scores ORDER BY created_at DESC, archive_number ASC')
    const scores: ScoreRecord[] = []
    try {
      while (statement.step()) scores.push(asScore(JSON.parse(String(statement.get()[0]))))
    } finally {
      statement.free()
    }
    return scores
  }

  async getScore(id: string): Promise<ScoreRecord | null> {
    await this.syncFromDisk()
    const statement = this.database.prepare('SELECT score_json FROM scores WHERE id = ?')
    try {
      statement.bind([id])
      return statement.step() ? asScore(JSON.parse(String(statement.get()[0]))) : null
    } finally {
      statement.free()
    }
  }

  async getLibraryState(): Promise<LibraryState> {
    await this.syncFromDisk()
    const statement = this.database.prepare("SELECT state_json FROM app_state WHERE state_key = 'library'")
    try {
      return statement.step() ? JSON.parse(String(statement.get()[0])) as LibraryState : defaultLibraryState()
    } finally {
      statement.free()
    }
  }

  async saveLibraryState(state: LibraryState): Promise<LibraryState> {
    await this.syncFromDisk()
    const normalized: LibraryState = { ...state, schemaVersion: 1 }
    const now = new Date().toISOString()
    this.database.run(
      `INSERT INTO app_state (state_key, state_json, updated_at) VALUES ('library', ?, ?)
       ON CONFLICT(state_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
      [JSON.stringify(normalized), now]
    )
    await this.persist()
    return normalized
  }

  async allocateNumber(guitarType: GuitarType): Promise<string> {
    return allocateArchiveNumber(guitarType, (await this.listScores()).map((score) => score.archiveNumber))
  }

  async importScore(sourcePaths: string[], metadata: ImportMetadata): Promise<ImportResult> {
    if (sourcePaths.length === 0) throw new Error('请选择至少一个曲谱文件')
    const supported = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])
    for (const path of sourcePaths) {
      if (!supported.has(extname(path).toLocaleLowerCase())) throw new Error(`不支持的文件类型：${basename(path)}`)
    }
    const hashes = await Promise.all(sourcePaths.map(sha256))
    await this.syncFromDisk()
    const contentFingerprint = fingerprint(hashes)
    const duplicateStatement = this.database.prepare('SELECT score_json FROM scores WHERE fingerprint = ?')
    try {
      duplicateStatement.bind([contentFingerprint])
      if (duplicateStatement.step()) {
        return { status: 'duplicate', score: asScore(JSON.parse(String(duplicateStatement.get()[0]))) }
      }
    } finally {
      duplicateStatement.free()
    }

    const archiveNumber = await this.allocateNumber(metadata.guitarType)
    const shelf = metadata.guitarType === 'electric' ? 'Electric' : 'Acoustic'
    const scoreDirectory = join(this.root, 'Library', shelf, archiveNumber)
    await mkdir(scoreDirectory, { recursive: false })
    const pageFiles: string[] = []
    try {
      for (const [index, sourcePath] of sourcePaths.entries()) {
        const extension = extname(sourcePath).toLocaleLowerCase() || '.bin'
        const target = join(scoreDirectory, `page-${String(index + 1).padStart(2, '0')}${extension}`)
        await copyFile(sourcePath, target)
        const copiedHash = await sha256(target)
        if (copiedHash !== hashes[index]) throw new Error(`复制校验失败：${basename(sourcePath)}`)
        pageFiles.push(relative(this.root, target).replaceAll('\\', '/'))
      }
      const artwork = await this.resolveArtwork(metadata.title, metadata.artist ?? '', scoreDirectory)
      const score = buildScoreRecord({
        ...metadata,
        archiveNumber,
        pageFiles,
        sourceHashes: hashes,
        assetKind: extname(sourcePaths[0]).toLocaleLowerCase() === '.pdf' ? 'pdf' : 'image',
        ...artwork
      })
      this.database.run('BEGIN TRANSACTION')
      try {
        this.database.run(
          `INSERT INTO scores (id, archive_number, fingerprint, guitar_type, title, artist, score_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [score.id, score.archiveNumber, contentFingerprint, score.guitarType, score.title, score.artist, JSON.stringify(score), score.createdAt, score.updatedAt]
        )
        this.database.run('COMMIT')
      } catch (error) {
        this.database.run('ROLLBACK')
        throw error
      }
      await writeFile(join(this.root, 'Metadata', `${archiveNumber}.json`), `${JSON.stringify({ schemaVersion: 1, ...score, contentFingerprint }, null, 2)}\n`, 'utf8')
      await this.persist()
      return { status: 'imported', score }
    } catch (error) {
      await rm(scoreDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async updateScore(id: string, patch: Partial<Pick<ScoreRecord, 'favorite' | 'learningStatus' | 'lastPage' | 'lastPlayedAt' | 'playCount' | 'notes'>>): Promise<ScoreRecord> {
    const existing = await this.getScore(id)
    if (!existing) throw new Error('曲谱不存在')
    const score = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    this.database.run('UPDATE scores SET score_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(score), score.updatedAt, id])
    await writeFile(join(this.root, 'Metadata', `${score.archiveNumber}.json`), `${JSON.stringify({ schemaVersion: 1, ...score }, null, 2)}\n`, 'utf8')
    await this.persist()
    return score
  }

  async setCustomCover(id: string, sourcePath: string): Promise<ScoreRecord> {
    const existing = await this.getScore(id)
    if (!existing) throw new Error('曲谱不存在')
    const bytes = await readFile(sourcePath)
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    if (!bytes.length || bytes.length > 12 * 1024 * 1024 || !(jpeg || png || webp)) throw new Error('封面必须是小于 12 MB 的 JPG、PNG 或 WebP 图片')
    const shelf = existing.guitarType === 'electric' ? 'Electric' : 'Acoustic'
    const coverPath = join(this.root, 'Library', shelf, existing.archiveNumber, 'cover-art')
    await writeFile(coverPath, bytes)
    const score: ScoreRecord = {
      ...existing,
      albumTitle: 'Arpeggio 原创封面',
      coverFile: relative(this.root, coverPath).replaceAll('\\', '/'),
      coverSourceUrl: null,
      coverLookupStatus: 'matched',
      updatedAt: new Date().toISOString()
    }
    this.database.run('UPDATE scores SET score_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(score), score.updatedAt, score.id])
    await writeFile(join(this.root, 'Metadata', `${score.archiveNumber}.json`), `${JSON.stringify({ schemaVersion: 1, ...score }, null, 2)}\n`, 'utf8')
    await this.persist()
    return score
  }

  async refreshMissingCovers(): Promise<ScoreRecord[]> {
    for (const score of await this.listScores()) {
      if (score.coverLookupStatus === 'matched' || score.coverFile || (score.coverLookupStatus === 'not_found' && !prefersAppleCoverArt(score.title, score.artist))) continue
      const shelf = score.guitarType === 'electric' ? 'Electric' : 'Acoustic'
      const scoreDirectory = join(this.root, 'Library', shelf, score.archiveNumber)
      const artwork = await this.resolveArtwork(score.title, score.artist, scoreDirectory)
      const updated = { ...score, ...artwork, updatedAt: new Date().toISOString() }
      this.database.run('UPDATE scores SET score_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(updated), updated.updatedAt, score.id])
      await writeFile(join(this.root, 'Metadata', `${score.archiveNumber}.json`), `${JSON.stringify({ schemaVersion: 1, ...updated }, null, 2)}\n`, 'utf8')
      await this.persist()
    }
    return this.listScores()
  }

  private async resolveArtwork(title: string, artist: string, scoreDirectory: string): Promise<Pick<ScoreRecord, 'albumTitle' | 'coverFile' | 'coverSourceUrl' | 'coverLookupStatus'>> {
    const coverPath = join(scoreDirectory, 'cover-art')
    try {
      const existing = await readFile(coverPath)
      const jpeg = existing[0] === 0xff && existing[1] === 0xd8 && existing[2] === 0xff
      const png = existing.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const webp = existing.toString('ascii', 0, 4) === 'RIFF' && existing.toString('ascii', 8, 12) === 'WEBP'
      if (existing.length > 0 && existing.length <= 12 * 1024 * 1024 && (jpeg || png || webp)) {
        return { albumTitle: null, coverFile: relative(this.root, coverPath).replaceAll('\\', '/'), coverSourceUrl: null, coverLookupStatus: 'matched' }
      }
    } catch { /* No previously downloaded cover to recover. */ }
    if (!artist.trim()) return { albumTitle: null, coverFile: null, coverSourceUrl: null, coverLookupStatus: 'not_found' }
    let unavailable = false
    const providers = [() => this.coverLookup(title, artist)]
    if (this.coverLookup === lookupCoverArt) {
      const apple = () => lookupAppleCoverArt(title, artist)
      if (prefersAppleCoverArt(title, artist)) providers.unshift(apple)
      else providers.push(apple)
    }
    for (const provider of providers) {
      try {
        const match = await provider()
        if (!match) continue
        await writeFile(coverPath, await downloadCoverArt(match.imageUrl))
        return {
          albumTitle: match.albumTitle,
          coverFile: relative(this.root, coverPath).replaceAll('\\', '/'),
          coverSourceUrl: match.sourceUrl,
          coverLookupStatus: 'matched'
        }
      } catch { unavailable = true }
    }
    return { albumTitle: null, coverFile: null, coverSourceUrl: null, coverLookupStatus: unavailable ? 'unavailable' : 'not_found' }
  }

  absoluteAssetPath(relativePath: string): string {
    const resolved = join(this.root, relativePath)
    const inside = relative(this.root, resolved)
    if (inside.startsWith('..') || inside.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('曲谱路径越界')
    return resolved
  }

  async createBackup(destinationBase: string, timestamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, '')): Promise<string> {
    const relation = relative(this.root, destinationBase)
    if (relation === '' || (!relation.startsWith('..') && !relation.includes(':'))) {
      throw new Error('备份目录必须位于曲谱库之外')
    }
    await this.syncFromDisk()
    await mkdir(destinationBase, { recursive: true })
    const backupPath = join(destinationBase, `Arpeggio-Backup-${timestamp}`)
    await cp(this.root, backupPath, { recursive: true, errorOnExist: true, force: false })
    await writeFile(join(backupPath, 'BACKUP_MANIFEST.json'), `${JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      scoreCount: (await this.listScores()).length,
      source: 'Arpeggio Guitar Archive'
    }, null, 2)}\n`, 'utf8')
    return backupPath
  }

  private async persist(): Promise<void> {
    const temporary = `${this.databasePath}.tmp`
    const bytes = Buffer.from(this.database.export())
    await writeFile(temporary, bytes)
    try {
      await rename(temporary, this.databasePath)
    } catch {
      await rm(this.databasePath, { force: true })
      await rename(temporary, this.databasePath)
    }
    this.diskHash = createHash('sha256').update(bytes).digest('hex')
  }
}
