import { describe, expect, it } from 'vitest'
import { allocateArchiveNumber, buildScoreRecord, formatTuning, normalizeSearchText, STANDARD_TUNING, STANDARD_TUNING_LABEL } from '../src/shared/score-domain'

describe('score domain', () => {
  it('allocates stable archive numbers by guitar type', () => {
    expect(allocateArchiveNumber('acoustic', ['AC-0001', 'EL-0008', 'AC-0003'])).toBe('AC-0004')
    expect(allocateArchiveNumber('electric', ['AC-0010'])).toBe('EL-0001')
  })

  it('builds a multi-page score without inventing optional metadata', () => {
    const score = buildScoreRecord({
      archiveNumber: 'AC-0001',
      title: '红色高跟鞋',
      artist: '蔡健雅',
      guitarType: 'acoustic',
      scoreType: '弹唱谱',
      pageFiles: ['page-01.jpg', 'page-02.jpg', 'page-03.jpg', 'page-04.jpg'],
      sourceHashes: ['a', 'b', 'c', 'd'],
      key: 'C',
      originalKey: 'D',
      capo: 2
    })

    expect(score.id).toBe('AC-0001')
    expect(score.pageCount).toBe(4)
    expect(score.arranger).toBeNull()
    expect(score.difficulty).toBeNull()
    expect(score.tuning).toBe(STANDARD_TUNING)
    expect(formatTuning(score.tuning)).toBe(STANDARD_TUNING_LABEL)
  })

  it('formats standard tuning consistently and keeps custom tuning exact', () => {
    expect(formatTuning('standard')).toBe(STANDARD_TUNING_LABEL)
    expect(formatTuning('无需特殊调弦（标准调弦 E A D G B E）')).toBe(STANDARD_TUNING_LABEL)
    expect(formatTuning('D A D G B E（Drop D）')).toBe('D A D G B E（Drop D）')
  })

  it('normalizes mixed Chinese and Latin search text', () => {
    expect(normalizeSearchText('  Acoustic  蔡健雅  ')).toBe('acoustic 蔡健雅')
  })
})
