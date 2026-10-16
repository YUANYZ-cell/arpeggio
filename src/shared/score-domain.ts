export type GuitarType = 'acoustic' | 'electric' | 'other'
export type LearningStatus = 'not_started' | 'learning' | 'practicing' | 'mastered'
export type ScoreAssetKind = 'image' | 'pdf'

export const STANDARD_TUNING = 'Standard (E A D G B E)'
export const STANDARD_TUNING_LABEL = 'Standard · E A D G B E'
const LEGACY_STANDARD_TUNING_INSTRUCTION = '无需特殊调弦（标准调弦 E A D G B E）'

export interface ScoreRecord {
  id: string
  archiveNumber: string
  title: string
  artist: string
  composer: string | null
  arranger: string | null
  guitarType: GuitarType
  scoreType: string
  tuning: string
  key: string | null
  originalKey: string | null
  capo: number | null
  difficulty: number | null
  pageCount: number
  pageFiles: string[]
  sourceHashes: string[]
  assetKind: ScoreAssetKind
  tags: string[]
  notes: string
  favorite: boolean
  learningStatus: LearningStatus
  lastPage: number
  lastPlayedAt: string | null
  playCount: number
  albumTitle?: string | null
  coverFile?: string | null
  coverSourceUrl?: string | null
  coverLookupStatus?: 'matched' | 'not_found' | 'unavailable'
  createdAt: string
  updatedAt: string
}

export interface ScoreRecordInput {
  archiveNumber: string
  title: string
  artist?: string
  composer?: string
  arranger?: string
  guitarType: GuitarType
  scoreType: string
  tuning?: string
  key?: string
  originalKey?: string
  capo?: number
  difficulty?: number
  pageFiles: string[]
  sourceHashes: string[]
  assetKind?: ScoreAssetKind
  tags?: string[]
  notes?: string
  albumTitle?: string | null
  coverFile?: string | null
  coverSourceUrl?: string | null
  coverLookupStatus?: 'matched' | 'not_found' | 'unavailable'
  createdAt?: string
}

export function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function allocateArchiveNumber(guitarType: GuitarType, existing: string[]): string {
  const prefix = guitarType === 'electric' ? 'EL' : guitarType === 'other' ? 'OT' : 'AC'
  const matcher = new RegExp(`^${prefix}-(\\d+)$`)
  const highest = existing.reduce((maximum, value) => {
    const match = matcher.exec(value)
    return match ? Math.max(maximum, Number(match[1])) : maximum
  }, 0)
  return `${prefix}-${String(highest + 1).padStart(4, '0')}`
}

export function buildScoreRecord(input: ScoreRecordInput): ScoreRecord {
  if (!input.title.trim()) throw new Error('曲名不能为空')
  if (input.pageFiles.length === 0) throw new Error('曲谱至少需要一页')
  if (input.pageFiles.length !== input.sourceHashes.length) throw new Error('谱页与哈希数量不一致')
  const now = input.createdAt ?? new Date().toISOString()
  return {
    id: input.archiveNumber,
    archiveNumber: input.archiveNumber,
    title: input.title.trim(),
    artist: input.artist?.trim() ?? '',
    composer: input.composer?.trim() || null,
    arranger: input.arranger?.trim() || null,
    guitarType: input.guitarType,
    scoreType: input.scoreType,
    tuning: input.tuning?.trim() || STANDARD_TUNING,
    key: input.key ?? null,
    originalKey: input.originalKey ?? null,
    capo: input.capo ?? null,
    difficulty: input.difficulty ?? null,
    pageCount: input.pageFiles.length,
    pageFiles: [...input.pageFiles],
    sourceHashes: [...input.sourceHashes],
    assetKind: input.assetKind ?? 'image',
    tags: [...(input.tags ?? [])],
    notes: input.notes ?? '',
    favorite: false,
    learningStatus: 'not_started',
    lastPage: 0,
    lastPlayedAt: null,
    playCount: 0,
    albumTitle: input.albumTitle ?? null,
    coverFile: input.coverFile ?? null,
    coverSourceUrl: input.coverSourceUrl ?? null,
    coverLookupStatus: input.coverLookupStatus,
    createdAt: now,
    updatedAt: now
  }
}

export function formatTuning(tuning: string | null | undefined): string {
  const explicitTuning = tuning?.trim()
  const normalized = explicitTuning?.toLocaleLowerCase()
  return !normalized || normalized === 'standard' || normalized === 'e a d g b e' || normalized === STANDARD_TUNING.toLocaleLowerCase() || normalized === STANDARD_TUNING_LABEL.toLocaleLowerCase() || normalized === LEGACY_STANDARD_TUNING_INSTRUCTION.toLocaleLowerCase()
    ? STANDARD_TUNING_LABEL
    : explicitTuning!
}

export function scoreMatches(score: ScoreRecord, query: string): boolean {
  const needle = normalizeSearchText(query)
  if (!needle) return true
  const haystack = normalizeSearchText([
    score.title,
    score.artist,
    score.composer ?? '',
    score.arranger ?? '',
    score.archiveNumber,
    score.guitarType,
    score.scoreType,
    score.tuning,
    score.key ?? '',
    score.originalKey ?? '',
    score.capo == null ? '' : `capo ${score.capo}`,
    ...score.tags
  ].join(' '))
  return needle.split(' ').every((part) => haystack.includes(part))
}
