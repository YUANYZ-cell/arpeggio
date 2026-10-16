import type { ImportMetadata, ImportResult } from '../main/archive-store'
import type { ScoreRecord } from './score-domain'
import type { LibraryState } from './library-state'

export interface FileChoice {
  path: string
  name: string
}

export interface ArpeggioApi {
  listScores(): Promise<ScoreRecord[]>
  refreshCovers(): Promise<ScoreRecord[]>
  chooseScoreFiles(): Promise<FileChoice[]>
  importScore(paths: string[], metadata: ImportMetadata): Promise<ImportResult>
  updateScore(id: string, patch: Partial<Pick<ScoreRecord, 'favorite' | 'learningStatus' | 'lastPage' | 'lastPlayedAt' | 'playCount' | 'notes'>>): Promise<ScoreRecord>
  assetUrl(path: string): Promise<string>
  enterFullscreen(value: boolean): Promise<void>
  isPackaged(): Promise<boolean>
  getLibraryState(): Promise<LibraryState>
  saveLibraryState(state: LibraryState): Promise<LibraryState>
  createBackup(): Promise<{ canceled: boolean; path?: string }>
}
