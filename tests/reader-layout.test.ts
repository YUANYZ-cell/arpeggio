import { describe, expect, it } from 'vitest'
import { bookSpreadIndex, bookSpreadPageIndices, bookSpreadPages, bookSpreadStart, bookStep, fittedBookPageWidth, fittedPageWidth, fittedPerformancePageWidth, fittedPerformanceSheetWidth, hasBookStep, hasPerformanceSpreadStep, performanceSpreadPages, performanceSpreadReadable, performanceSpreadStart, performanceSpreadStep, readingDeskWidth, READING_DESK_MARGIN, PERFORMANCE_READABLE_SHEET_WIDTH, PERFORMANCE_SPREAD_GAP, PERFORMANCE_STAGE_PADDING } from '../src/renderer/src/reader-layout'

const PAGE = { width: 1280, height: 1810 }

describe('bookSpreadStart', () => {
  it('covers pages in cover + facing pairs', () => {
    expect(bookSpreadStart(0)).toBe(0)
    expect(bookSpreadStart(1)).toBe(1)
    expect(bookSpreadStart(2)).toBe(1)
    expect(bookSpreadStart(3)).toBe(3)
    expect(bookSpreadStart(4)).toBe(3)
  })
})

describe('bookSpreadPages', () => {
  it('pairs pages after the cover', () => {
    expect(bookSpreadPages(0, 4)).toEqual([null, 0])
    expect(bookSpreadPages(1, 4)).toEqual([1, 2])
    expect(bookSpreadPages(3, 4)).toEqual([3, null])
  })
})

describe('two-sheet scores', () => {
  // Regression: requiring three sheets for a book spread dropped a two-sheet
  // score to a lone centred page — on a wide window it read as a book that only
  // had one page, and the counter said "1 / 2".
  it('shows both sheets as the one spread', () => {
    expect(bookSpreadStart(0, 2)).toBe(0)
    expect(bookSpreadStart(1, 2)).toBe(0)
    expect(bookSpreadPages(0, 2)).toEqual([0, 1])
    expect(bookSpreadPageIndices(1, 2)).toEqual([0, 1])
  })

  it('has nothing left to turn', () => {
    expect(bookStep(0, 1, 2)).toBe(0)
    expect(bookStep(1, -1, 2)).toBe(0)
    expect(hasBookStep(0, 1, 2)).toBe(false)
    expect(hasBookStep(1, -1, 2)).toBe(false)
  })
})

describe('bookSpreadIndex', () => {
  it('groups sheets two at a time after the cover', () => {
    expect([0, 1, 2, 3, 4, 5].map((index) => bookSpreadIndex(index, 7))).toEqual([0, 1, 1, 2, 2, 3])
  })
})

describe('bookStep', () => {
  it('moves one sheet at a time (last spread overshoots and is bounded by callers)', () => {
    expect(bookStep(0, 1)).toBe(1)
    expect(bookStep(1, 1)).toBe(3)
    expect(bookStep(3, 1)).toBe(5) // callers disable navigation when this >= pageCount
    expect(bookStep(3, -1)).toBe(1)
    expect(bookStep(1, -1)).toBe(0)
  })
})

describe('hasBookStep', () => {
  it('is true only when a neighbouring spread exists', () => {
    expect(hasBookStep(0, 1, 4)).toBe(true)
    expect(hasBookStep(1, 1, 4)).toBe(true)
    expect(hasBookStep(3, 1, 4)).toBe(false) // the last spread overshoots the score
    expect(hasBookStep(0, -1, 4)).toBe(false)
    expect(hasBookStep(1, -1, 4)).toBe(true)
  })
})

describe('fittedBookPageWidth', () => {
  const stage = { width: 682, height: 653 } // center grid track at the 1120px minimum window

  it('never lets the two-page spread overflow the center track at fit zoom', () => {
    for (const fit of ['page', 'width', 'height'] as const) {
      for (const zoom of [50, 100]) {
        const perPage = fittedBookPageWidth(fit, zoom, stage, PAGE)
        expect(perPage * 2).toBeLessThanOrEqual(stage.width)
      }
    }
  })

  it('keeps the spread inside the track at realistic stage sizes', () => {
    // Regression: fitting used the full paper-stage width, so the spread
    // covered the reader side panels at narrow window sizes.
    for (const width of [520, 682, 760, 900]) {
      const perPage = fittedBookPageWidth('page', 100, { width, height: 653 }, PAGE)
      expect(perPage * 2).toBeLessThanOrEqual(width)
    }
  })
})

describe('fittedPageWidth', () => {
  it('keeps a double spread inside the center track', () => {
    const middle = 682
    const perPaper = fittedPageWidth('page', 100, { width: middle / 2, height: 653 }, PAGE)
    expect(perPaper * 2 + 10).toBeLessThanOrEqual(middle)
  })
})

describe('performance spread pairing', () => {
  it('anchors pairs to even sheets so the stride never varies', () => {
    const count = 9
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => performanceSpreadStart(index, count)))
      .toEqual([0, 0, 2, 2, 4, 4, 6, 6, 8])
  })

  it('shows both halves, and leaves the right half empty on an odd score', () => {
    expect(performanceSpreadPages(0, 4)).toEqual([0, 1])
    expect(performanceSpreadPages(2, 4)).toEqual([2, 3])
    expect(performanceSpreadPages(4, 5)).toEqual([4, null])
    expect(performanceSpreadPages(0, 1)).toEqual([0, null])
  })

  it('has nothing to show for an empty score', () => {
    expect(performanceSpreadStart(3, 0)).toBe(0)
    expect(performanceSpreadPages(0, 0)).toEqual([null, null])
  })

  it('advances a whole spread, never a single sheet', () => {
    expect(performanceSpreadStep(0, 1, 5)).toBe(2)
    expect(performanceSpreadStep(1, 1, 5)).toBe(2)
    expect(performanceSpreadStep(2, 1, 5)).toBe(4)
    expect(performanceSpreadStep(4, 1, 5)).toBe(4) // last spread, clamped
    expect(performanceSpreadStep(4, -1, 5)).toBe(2)
    expect(performanceSpreadStep(2, -1, 5)).toBe(0)
    expect(performanceSpreadStep(0, -1, 5)).toBe(0)
  })

  it('reports a neighbour only when a real spread lies that way', () => {
    expect(hasPerformanceSpreadStep(0, 1, 5)).toBe(true)
    expect(hasPerformanceSpreadStep(2, 1, 5)).toBe(true)
    expect(hasPerformanceSpreadStep(4, 1, 5)).toBe(false)
    expect(hasPerformanceSpreadStep(0, -1, 5)).toBe(false)
    expect(hasPerformanceSpreadStep(2, -1, 5)).toBe(true)
  })
})

describe('performance spread fitting', () => {
  // The headline requirement: two sheets, whole, side by side, no cropping and
  // no horizontal scroll — at every window size the app can be run at, so the
  // assertions below sweep both axes rather than trusting one happy size.
  it('keeps the pair plus its seam inside the stage at any realistic size', () => {
    for (const width of [200, 320, 520, 682, 900, 1102, 1400, 1724, 1899]) {
      for (const height of [360, 653, 720, 900, 1080]) {
        for (const zoom of [50, 100, 130, 180]) {
          const sheet = fittedPerformanceSheetWidth({ width, height }, PAGE, zoom)
          expect(sheet * 2 + PERFORMANCE_SPREAD_GAP, `${width}x${height} ${zoom}%`).toBeLessThanOrEqual(width)
        }
      }
    }
  })

  it('never lets a sheet grow past the stage height', () => {
    // Regression: honouring a 适合宽度 mode on stage let the sheet overflow the
    // height on a short window, which cropped the bottom stave instead of
    // scrolling — the one outcome a performance view must not produce. The
    // bound is exact, not "within a pixel": rounding the fitted width up used
    // to hand back a sheet 0.05px too tall, which the DOM then rounded into a
    // whole clipped pixel.
    for (const width of [200, 520, 900, 1724, 1899]) {
      for (const height of [360, 653, 720, 900, 1080]) {
        for (const zoom of [50, 100, 180]) {
          const sheet = fittedPerformanceSheetWidth({ width, height }, PAGE, zoom)
          const rendered = sheet * PAGE.height / PAGE.width
          expect(rendered, `${width}x${height} ${zoom}%`).toBeLessThanOrEqual(Math.max(1, height - PERFORMANCE_STAGE_PADDING * 2))
        }
      }
    }
  })

  it('fills one of the two axes instead of leaving the stand half empty', () => {
    // A4 on a 16:9 stage is height-bound: both sheets reach the full stage height.
    const wide = fittedPerformanceSheetWidth({ width: 1724, height: 1044 }, PAGE)
    expect(wide * PAGE.height / PAGE.width).toBeCloseTo(1044 - PERFORMANCE_STAGE_PADDING * 2, 0)
    // A narrow stage is width-bound, and then the pair spans the whole lane.
    const narrow = fittedPerformanceSheetWidth({ width: 520, height: 720 }, PAGE)
    expect(narrow * 2 + PERFORMANCE_SPREAD_GAP).toBeCloseTo(520 - PERFORMANCE_STAGE_PADDING * 2, 0)
  })

  it('does not let zoom push a sheet past its box', () => {
    const stage = { width: 1400, height: 900 }
    const capped = Math.max(1, (stage.width - PERFORMANCE_STAGE_PADDING * 2 - PERFORMANCE_SPREAD_GAP) / 2)
    expect(fittedPerformanceSheetWidth(stage, PAGE, 180)).toBeLessThanOrEqual(capped)
    expect(fittedPerformanceSheetWidth(stage, PAGE, 100)).toBeLessThanOrEqual(capped)
  })

  it('leaves the single-sheet stage inside its own borders', () => {
    for (const width of [200, 520, 900, 1899]) {
      for (const height of [360, 720, 1080]) {
        const sheet = fittedPerformancePageWidth({ width, height }, PAGE)
        expect(sheet).toBeLessThanOrEqual(width - PERFORMANCE_STAGE_PADDING * 2)
        expect(sheet * PAGE.height / PAGE.width).toBeLessThanOrEqual(Math.max(1, height - PERFORMANCE_STAGE_PADDING * 2))
      }
    }
  })

  it('flags a spread that has shrunk past comfortable reading', () => {
    expect(performanceSpreadReadable({ width: 1724, height: 1044 }, PAGE)).toBe(true)
    expect(performanceSpreadReadable({ width: 924, height: 720 }, PAGE)).toBe(true)
    expect(performanceSpreadReadable({ width: 620, height: 720 }, PAGE)).toBe(false)
  })

  it('agrees with the readable threshold it advertises', () => {
    for (const width of [500, 620, 924, 1400, 1724]) {
      const stage = { width, height: 720 }
      expect(performanceSpreadReadable(stage, PAGE)).toBe(fittedPerformanceSheetWidth(stage, PAGE) >= PERFORMANCE_READABLE_SHEET_WIDTH)
    }
  })
})

describe('readingDeskWidth', () => {
  // Regression: the desk was a fixed min(1020px, 100% - 408px) band, so at
  // 适合宽度 the sheets (lane minus 84px, plus a 9px cover board on each side)
  // reached past the desk and hung over the cream background.
  it('always covers the sheets it sits under, with the mat margin on both sides', () => {
    for (const stageWidth of [682, 1102, 1400, 1486, 1899]) {
      for (const fit of ['page', 'width'] as const) {
        for (const zoom of [50, 100, 130]) {
          const stage = { width: stageWidth, height: 700 }
          const spread = fittedBookPageWidth(fit, zoom, stage, PAGE) * 2
          expect(readingDeskWidth([spread])).toBeGreaterThanOrEqual(spread + READING_DESK_MARGIN * 2)
        }
      }
    }
  })

  it('counts a side-by-side pair with the page gap', () => {
    expect(readingDeskWidth([300, 500], 10)).toBe(300 + 10 + 500 + READING_DESK_MARGIN * 2)
  })

  it('reports nothing to draw when the lane has not been measured', () => {
    expect(readingDeskWidth([])).toBe(0)
  })
})
