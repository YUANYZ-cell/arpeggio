// `single` is the historical persisted value for the bound-book layout. Keep
// it stable for existing archives; `page` is the literal one-sheet mode.
export type ViewerMode = 'page' | 'single' | 'double' | 'continuous'
export type FitMode = 'width' | 'height' | 'page' | 'custom'
export type AutoTurnProfileKind = 'fixed' | 'per-page' | 'timeline' | 'rehearsal'

export interface Setlist {
  id: string
  name: string
  scoreIds: string[]
  createdAt: string
}

export interface PageBookmark {
  id: string
  scoreId: string
  pageIndex: number
  label: string
  note?: string
  createdAt: string
}

export interface AutoTurnCue {
  atMs: number
  pageIndex: number
}

export interface AutoTurnProfile {
  id: string
  scoreId: string
  name: string
  kind: AutoTurnProfileKind
  intervalMs?: number
  durationsMs?: number[]
  cues?: AutoTurnCue[]
  warningSeconds: 0 | 1 | 2 | 3 | 5
  isDefault: boolean
  createdAt: string
}

export interface LibrarySettings {
  appearance: 'archive-light' | 'archive-dark'
  viewer: { mode: ViewerMode; fit: FitMode; pageGap: number }
  performance: { animation: boolean; warningSeconds: 0 | 1 | 2 | 3 | 5; defaultIntervalSeconds: number; hideControlsSeconds: number }
  controls: { nextPage: string[]; previousPage: string[]; toggleAutoTurn: string; fullscreen: string; exit: string }
  backup: { automatic: boolean; directory: string }
}

export interface LibraryState {
  schemaVersion: 1
  setlists: Setlist[]
  bookmarks: PageBookmark[]
  autoTurnProfiles: AutoTurnProfile[]
  settings: LibrarySettings
}

export function defaultLibraryState(): LibraryState {
  return {
    schemaVersion: 1,
    setlists: [],
    bookmarks: [],
    autoTurnProfiles: [],
    settings: {
      appearance: 'archive-light',
      viewer: { mode: 'single', fit: 'width', pageGap: 16 },
      performance: { animation: true, warningSeconds: 3, defaultIntervalSeconds: 20, hideControlsSeconds: 3 },
      controls: {
        nextPage: ['ArrowRight', 'Space', 'PageDown'], previousPage: ['ArrowLeft', 'PageUp'],
        toggleAutoTurn: 'Enter', fullscreen: 'F11', exit: 'Escape'
      },
      backup: { automatic: false, directory: '' }
    }
  }
}
