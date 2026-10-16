import type { FitMode } from '../../shared/library-state'

/**
 * Reader layout math, extracted from App.tsx so unit tests and the
 * qa/reader-overlap-check.mjs harness can exercise the exact same code
 * the React tree uses to size the page stage.
 */

export interface StageSize {
  width: number
  height: number
  /**
   * Width of the stage's center grid track (the lane the book/page spread
   * is allowed to occupy between the two reader side panels).
   */
  middle: number
}

export interface PageDimensions {
  width: number
  height: number
}

export function measureStage(stage: HTMLElement): StageSize {
  const width = stage.clientWidth
  const height = stage.clientHeight
  // Resolve the actual center grid track so spreads are sized against the lane
  // between the reader side panels instead of the full stage width. Only a grid
  // stage has that track: in the flex layouts (continuous mode, and the narrow
  // shell) the specified `grid-template-columns` still computes to the rail
  // tracks, and parsing it used to hand back a rail width (196px) as the lane.
  const style = getComputedStyle(stage)
  const tracks = style.display === 'grid' ? style.gridTemplateColumns.split(/\s+/).map(parseFloat) : []
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  const middle = tracks.length >= 3 && Number.isFinite(tracks[1]) && tracks[1] > 0
    ? tracks[1]
    : Math.max(240, width - (Number.isFinite(padding) ? padding : 20))
  return { width, height, middle }
}

export function fittedPageWidth(fit: FitMode, zoom: number, stage: { width: number; height: number }, page: PageDimensions): number {
  const availableWidth = Math.max(240, stage.width - 64)
  const availableHeight = Math.max(240, stage.height - 40)
  const heightWidth = availableHeight * page.width / page.height
  const base = fit === 'width' ? availableWidth : fit === 'height' ? heightWidth : Math.min(availableWidth, heightWidth)
  // Cap at the track so zoom can never push a page over the reader side panels.
  return Math.round(Math.min(base * zoom / 100, availableWidth))
}

/**
 * A score that is exactly two sheets has no cover-and-facing sequence: both
 * sheets *are* the spread. Treating it like a longer book left it as a single
 * centred sheet — on a wide window that wasted most of the lane and read as a
 * book that only had one page. Two sheets therefore render as one spread and
 * there is nothing to turn; every longer score keeps the cover + facing pairs.
 */
const TWO_SHEET_SPREAD = 2

export function bookSpreadStart(pageIndex: number, pageCount = 0): number {
  if (pageCount === TWO_SHEET_SPREAD) return 0
  return pageIndex === 0 ? 0 : 1 + 2 * Math.floor((pageIndex - 1) / 2)
}

export function bookSpreadPages(start: number, pageCount: number): [number | null, number | null] {
  if (pageCount === TWO_SHEET_SPREAD) return [0, 1]
  return start === 0 ? [null, 0] : [start, start + 1 < pageCount ? start + 1 : null]
}

export function bookStep(start: number, direction: -1 | 1, pageCount = 0): number {
  if (pageCount === TWO_SHEET_SPREAD) return 0
  return Math.max(0, start + (direction === 1 ? start === 0 ? 1 : 2 : start === 1 ? -1 : -2))
}

/** Whether a real spread lies one step away in that direction. */
export function hasBookStep(pageIndex: number, direction: -1 | 1, pageCount: number): boolean {
  const target = bookStep(pageIndex, direction, pageCount)
  return target !== bookSpreadStart(pageIndex, pageCount) && target < pageCount
}

/** Index of the spread a sheet is part of — one spread per two sheets after the cover. */
export function bookSpreadIndex(pageIndex: number, pageCount: number): number {
  if (pageCount === TWO_SHEET_SPREAD) return 0
  return pageIndex === 0 ? 0 : 1 + Math.floor((pageIndex - 1) / 2)
}

/** Sheets visible at once for the spread a sheet belongs to (1-based labels use +1). */
export function bookSpreadPageIndices(pageIndex: number, pageCount: number): number[] {
  return bookSpreadPages(bookSpreadStart(pageIndex, pageCount), pageCount).filter((index): index is number => index != null)
}

export function fittedBookPageWidth(fit: FitMode, zoom: number, stage: { width: number; height: number }, page: PageDimensions): number {
  const availableWidth = Math.max(120, (stage.width - 84) / 2)
  const availableHeight = Math.max(180, stage.height - 40)
  const heightWidth = availableHeight * page.width / page.height
  const base = fit === 'width' ? availableWidth : Math.min(availableWidth, heightWidth)
  // Cap at the per-page track so zoom keeps the whole spread between the side panels.
  return Math.round(Math.min(base * zoom / 100, availableWidth))
}

/* ---------------------------------------------------------------------------
 * Performance mode spreads.
 *
 * On stage the player reads from the music stand, so the goal is not "one sheet
 * at a time in a book" but "both facing sheets, whole, legible, and never
 * scrolled". That is a different geometry problem from the book reader: there is
 * no cover, no turning leaf, and the two sheets are two independent images that
 * simply sit side by side.
 * ------------------------------------------------------------------------- */

/**
 * Empty border the performance stage keeps around the spread, per side.
 *
 * Small on purpose. The single-sheet stage used to run edge to edge, so a
 * generous mat here silently shrank every stave — 18px cost 5% of the score
 * height in the regression that caught it. This is just enough to keep the
 * paper off the window frame.
 */
export const PERFORMANCE_STAGE_PADDING = 10

/** Width of the seam between the two facing sheets of a performance spread. */
export const PERFORMANCE_SPREAD_GAP = 12

/** Below this a stave stops being comfortably readable from a music stand. */
export const PERFORMANCE_READABLE_SHEET_WIDTH = 300

/**
 * First sheet of the spread a sheet belongs to. Unlike the book reader, which
 * models a cover followed by facing pairs, a score starts at sheet one, so the
 * pairs are anchored to even sheets: 1-2, 3-4, 5-6.
 *
 * Fixed pairing is deliberate. With a foot pedal the stride must be constant
 * and a given sheet must never migrate between the left and right half of the
 * stand, otherwise the player has to re-read the layout on every turn.
 */
export function performanceSpreadStart(pageIndex: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  const bounded = Math.max(0, Math.min(pageCount - 1, Math.floor(pageIndex)))
  return Math.floor(bounded / 2) * 2
}

/**
 * The two sheets of a performance spread, in reading order. The right half is
 * null when the score has an odd sheet count and this is the final spread.
 */
export function performanceSpreadPages(start: number, pageCount: number): [number | null, number | null] {
  if (pageCount <= 0) return [null, null]
  const left = performanceSpreadStart(start, pageCount)
  const right = left + 1
  return [left, right < pageCount ? right : null]
}

/** Spread one stride away, clamped to the score so callers cannot walk off it. */
export function performanceSpreadStep(start: number, direction: -1 | 1, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.max(0, Math.min(pageCount - 1, performanceSpreadStart(start, pageCount) + direction * 2))
}

/** Whether a real spread lies one stride away in that direction. */
export function hasPerformanceSpreadStep(pageIndex: number, direction: -1 | 1, pageCount: number): boolean {
  const target = performanceSpreadStart(pageIndex, pageCount) + direction * 2
  return target >= 0 && target < pageCount
}

/**
 * Fit one sheet into a box that already accounts for the other sheet, the seam
 * and the stage padding.
 *
 * There is deliberately no fit *mode* here. The reader offers 整页 / 适合宽度,
 * and 适合宽度 is free to overflow on the axis it does not control — on stage
 * that would crop the bottom of a stave, which is the one outcome a performance
 * view must never produce. Performance sizing therefore always honours both
 * axes: the sheet is the smaller of "as wide as I may be" and "as tall as I may
 * be", so it is complete on screen at every window size and every zoom.
 */
function fitSheetIntoBox(availableWidth: number, availableHeight: number, page: PageDimensions, zoom: number): number {
  const heightWidth = availableHeight * page.width / page.height
  const base = Math.min(availableWidth, heightWidth)
  // Capped at `base`, not at `availableWidth`: on a width-bound stage the height
  // is the binding constraint, and capping against width alone let a zoomed
  // sheet run past the bottom of the stage again.
  //
  // Floored, not rounded. On a height-bound stage `base` is the height limit
  // expressed as a width, so rounding the width up pushes the sheet back over
  // the bottom edge (measured: 1060.5px of room became a 1061px sheet at
  // 1724x1080). Flooring keeps the "complete on screen" promise exact on both
  // axes; the sub-pixel of slack it leaves is invisible.
  return Math.max(1, Math.floor(Math.min(base * zoom / 100, base)))
}

/** Width of one sheet when the stage shows a single sheet. */
export function fittedPerformancePageWidth(stage: { width: number; height: number }, page: PageDimensions, zoom = 100): number {
  const availableWidth = Math.max(1, stage.width - PERFORMANCE_STAGE_PADDING * 2)
  const availableHeight = Math.max(1, stage.height - PERFORMANCE_STAGE_PADDING * 2)
  return fitSheetIntoBox(availableWidth, availableHeight, page, zoom)
}

/** Width of each of the two sheets of a performance spread. */
export function fittedPerformanceSheetWidth(stage: { width: number; height: number }, page: PageDimensions, zoom = 100): number {
  // Floors are deliberately 1px, never a "sensible minimum": the invariant that
  // a spread always fits the stage must hold at any window size, and a floor
  // would turn a narrow stage into the horizontal scroll it is meant to avoid.
  const availableWidth = Math.max(1, (stage.width - PERFORMANCE_STAGE_PADDING * 2 - PERFORMANCE_SPREAD_GAP) / 2)
  const availableHeight = Math.max(1, stage.height - PERFORMANCE_STAGE_PADDING * 2)
  return fitSheetIntoBox(availableWidth, availableHeight, page, zoom)
}

/**
 * Total width the two sheet frames occupy — the box the stage has to contain.
 * Used by the regression test that proves a spread never needs scrolling.
 */
export function performanceSpreadWidth(sheetWidth: number, gap = PERFORMANCE_SPREAD_GAP): number {
  return Math.round(sheetWidth * 2 + gap)
}

/**
 * Whether a spread at this stage size still leaves every stave readable. When
 * it does not the player is better served by a single sheet, and the control
 * rail says so rather than silently shrinking the score.
 */
export function performanceSpreadReadable(stage: { width: number; height: number }, page: PageDimensions): boolean {
  return fittedPerformanceSheetWidth(stage, page) >= PERFORMANCE_READABLE_SHEET_WIDTH
}

/**
 * Margin between a sheet and the edge of the dark reading desk underneath it.
 * The desk used to be a fixed band — `min(1020px, 100% - 408px)` — that ignored
 * the sheets completely: at 适合宽度 a book spread is as wide as the lane minus
 * 84px, so the sheets (plus their 9px cover board and shadow) ended up hanging
 * over the cream desk on both sides. Sizing the desk from the sheets instead
 * keeps one consistent mat margin in every viewer mode, fit and zoom.
 */
export const READING_DESK_MARGIN = 26

/** Horizontal gap between the two sheets of `page-spread` (`.page-spread{gap}`). */
export const SHEET_GAP = 10

/**
 * Width of the reading desk for the sheets the lane is about to render, given
 * their widths in the order they sit side by side (a book spread is one box:
 * its two pages are joined at the spine, so it passes a single width).
 */
export function readingDeskWidth(sheetWidths: number[], gap = SHEET_GAP, margin = READING_DESK_MARGIN): number {
  if (!sheetWidths.length) return 0
  const span = sheetWidths.reduce((total, width, index) => index === 0 ? width : total + gap + width, 0)
  return Math.round(Math.max(0, span) + margin * 2)
}
