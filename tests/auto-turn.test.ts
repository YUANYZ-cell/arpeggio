import { describe, expect, it } from 'vitest'
import { AutoTurnTimeline, buildFixedTimeline, buildPerPageTimeline } from '../src/shared/auto-turn'

describe('auto turn engine', () => {
  it('builds fixed and per-page timelines in elapsed milliseconds', () => {
    expect(buildFixedTimeline(4, 20_000)).toEqual([20_000, 40_000, 60_000])
    expect(buildPerPageTimeline([48_000, 61_000, 52_000, 40_000])).toEqual([48_000, 109_000, 161_000])
  })

  it('pauses without counting paused wall time', () => {
    const timeline = new AutoTurnTimeline([1_000, 2_000])
    timeline.start(10_000)
    timeline.pause(10_600)
    timeline.resume(20_000)
    expect(timeline.elapsed(20_400)).toBe(1_000)
    expect(timeline.pageAt(20_400)).toBe(1)
  })

  it('resynchronizes future turns after a manual page change', () => {
    const timeline = new AutoTurnTimeline([10_000, 20_000, 30_000])
    timeline.start(0)
    timeline.resyncToPage(2, 5_000)
    expect(timeline.pageAt(14_999)).toBe(2)
    expect(timeline.pageAt(15_000)).toBe(3)
  })
})
