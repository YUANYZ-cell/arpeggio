export type AutoTurnMode = 'fixed' | 'per-page' | 'timeline' | 'rehearsal'

export function buildFixedTimeline(pageCount: number, intervalMs: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('页数必须为正整数')
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('翻页间隔必须大于 0')
  return Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => (index + 1) * intervalMs)
}

export function buildPerPageTimeline(durationsMs: number[]): number[] {
  if (durationsMs.length === 0) throw new Error('逐页时长不能为空')
  if (durationsMs.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error('每页时长必须大于 0')
  }
  let total = 0
  return durationsMs.slice(0, -1).map((duration) => {
    total += duration
    return total
  })
}

export class AutoTurnTimeline {
  private startedAt: number | null = null
  private pausedAt: number | null = null
  private pausedDuration = 0
  private elapsedOffset = 0

  constructor(private readonly turns: number[]) {
    if (turns.some((value, index) => value <= 0 || (index > 0 && value <= turns[index - 1]))) {
      throw new Error('翻页时间点必须严格递增')
    }
  }

  start(now: number): void {
    this.startedAt = now
    this.pausedAt = null
    this.pausedDuration = 0
    this.elapsedOffset = 0
  }

  pause(now: number): void {
    if (this.startedAt == null || this.pausedAt != null) return
    this.pausedAt = now
  }

  resume(now: number): void {
    if (this.pausedAt == null) return
    this.pausedDuration += now - this.pausedAt
    this.pausedAt = null
  }

  elapsed(now: number): number {
    if (this.startedAt == null) return this.elapsedOffset
    const effectiveNow = this.pausedAt ?? now
    return Math.max(0, effectiveNow - this.startedAt - this.pausedDuration + this.elapsedOffset)
  }

  pageAt(now: number): number {
    const elapsed = this.elapsed(now)
    return this.turns.reduce((page, turnAt) => elapsed >= turnAt ? page + 1 : page, 0)
  }

  resyncToPage(page: number, now: number): void {
    const targetElapsed = page <= 0 ? 0 : (this.turns[page - 1] ?? this.turns.at(-1) ?? 0)
    this.startedAt = now
    this.pausedAt = null
    this.pausedDuration = 0
    this.elapsedOffset = targetElapsed
  }
}
