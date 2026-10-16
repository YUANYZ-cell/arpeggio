import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArrowLeft, Bookmark, BookOpen, ChevronLeft, ChevronRight, Clock3, Disc3, FilePlus2, FolderHeart,
  Gauge, Guitar, Layers3, ListMusic, Maximize2, PanelLeftClose, PanelLeftOpen, Pause, PencilLine, Play, Plus,
  RotateCcw, Search, Settings, Tag, Trash2, ZoomIn, ZoomOut
} from 'lucide-react'
import type { FileChoice } from '../../shared/ipc'
import { formatTuning, scoreMatches, STANDARD_TUNING, type GuitarType, type ScoreRecord } from '../../shared/score-domain'
import { defaultLibraryState, type AutoTurnCue, type AutoTurnProfile, type AutoTurnProfileKind, type FitMode, type LibraryState } from '../../shared/library-state'
import { SetlistsDialog, SettingsDialog } from './LibraryDialogs'

type Scope = 'all' | 'acoustic' | 'electric' | 'favorites' | 'recent'
type View = 'library' | 'detail' | 'reader'

const scopeLabels: Record<Scope, string> = {
  all: '全部曲谱', acoustic: '木吉他', electric: '电吉他', favorites: '收藏', recent: '最近添加'
}

const coverPalettes = [
  ['#2d1517', '#9a4c3d', '#d79a68'],
  ['#111d23', '#315f65', '#b3c9b5'],
  ['#1d1725', '#62516e', '#d2a88f'],
  ['#172019', '#476047', '#c3a56d'],
  ['#1b1d2b', '#485782', '#a98e77']
]

function coverStageStyle(score?: ScoreRecord): React.CSSProperties {
  const seed = score ? [...score.archiveNumber].reduce((sum, character) => sum + character.charCodeAt(0), 0) : 0
  const [ink, mid, glow] = coverPalettes[seed % coverPalettes.length]
  return { '--stage-ink': ink, '--stage-mid': mid, '--stage-glow': glow } as React.CSSProperties
}

function NavItem({ active, icon, label, count, onClick }: { active?: boolean; icon: React.ReactNode; label: string; count?: number; onClick?: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count != null && <em>{count}</em>}</button>
}

function CoverArtwork({ score, url }: { score: ScoreRecord; url?: string }) {
  const [failed, setFailed] = useState(false)
  const tone = [...score.archiveNumber].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4
  return <div className={`album-cover cover-tone-${tone}`}>
    {url && !failed ? <img src={url} alt={`${score.albumTitle || score.title} 封面`} onError={() => setFailed(true)}/> :
      <div className="cover-fallback" aria-label={`${score.title} 曲谱封面`}>
        <span className="cover-kicker">ARPEGGIO / SCORE ARCHIVE</span>
        <span className="cover-orbit" aria-hidden="true"/>
        <strong>{score.title}</strong>
        <span className="cover-artist">{score.artist || '私人曲谱收藏'}</span>
        <span className="cover-footer">Score No. {score.archiveNumber}<i>♪</i></span>
      </div>}
    <span className="cover-open-cue"><BookOpen/></span>{score.favorite && <span className="card-favorite" aria-label="已收藏"><Bookmark fill="currentColor"/></span>}
  </div>
}

/**
 * How long the stage holds one cover before the rotation moves on. Slow on
 * purpose: the stage is a showcase, not a slideshow — a cover has to be read.
 */
const COVER_ROTATE_MS = 7000

/**
 * One full plate of the cover stage: the artwork with its floor reflection and
 * the editorial copy beside it. The stage renders two of these while a rotation
 * is in flight, so the swap is a dissolve rather than a blink.
 */
function StageLayerBody({ score, url }: { score: ScoreRecord; url?: string }) {
  return <>
    <div className="featured-art"><CoverArtwork score={score} url={url}/><div className="featured-mirror" aria-hidden="true"><CoverArtwork score={score} url={url}/></div></div>
    <div className="featured-copy"><span>NOW ON STAGE / {score.archiveNumber}</span><strong>{score.title}</strong><small>{score.artist || '未知艺术家'}</small><div className="featured-facts"><b>{score.guitarType === 'electric' ? '电吉他' : '木吉他'}</b><b>{score.scoreType}</b><b>{score.pageCount} 页</b></div><em>查看曲谱资料 <ChevronRight size={16}/></em></div>
  </>
}

function PaperClip() {
  return <svg className="sheet-clip" viewBox="0 0 22 47" fill="none" aria-hidden="true" focusable="false">
    <path d="M16.7 38.2V9.6a7.3 7.3 0 0 0-14.6 0v28a4.4 4.4 0 0 0 8.8 0V12" stroke="#675b47" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M17.5 38.2V9.6a8.1 8.1 0 0 0-16.2 0v28a5.2 5.2 0 0 0 10.4 0V12" stroke="#dbd0b7" strokeWidth=".9" strokeLinecap="round"/>
  </svg>
}

/** Character-staggered title reveal — the SplitText idea without the GSAP dependency. */
function SplitReveal({ text, className = '', step = 40, base = 120 }: { text: string; className?: string; step?: number; base?: number }) {
  return <span
    className={`split-reveal ${className}`}
    style={{ '--stagger-step': `${step}ms`, '--stagger-base': `${base}ms` } as React.CSSProperties}
    aria-label={text}
  >
    {[...text].map((char, index) => <span key={`${text}-${index}`} className="sr-ch" aria-hidden="true" style={{ '--i': index } as React.CSSProperties}>{char === ' ' ? ' ' : char}</span>)}
  </span>
}

/**
 * Living dot-wave field — the ShapeWaves concept adapted to a light Canvas2D
 * pass: a travelling interference field sets each dot's energy, and pointer
 * movement splashes expanding ripples into it. No WebGPU, no dependencies;
 * it sleeps when offscreen, hidden or reduced-motion.
 */
function StageWave({ className = 'stage-wave' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const CELL = 30
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const ripples: { x: number; y: number; at: number; power: number }[] = []
    let raf = 0
    let width = 0
    let height = 0
    let time = 0
    let last = 0
    let visible = true
    let tint: [number, number, number] = [179, 201, 181]
    const readTint = () => {
      const value = getComputedStyle(canvas).getPropertyValue('--stage-glow').trim()
      const match = /^#?([\da-f]{6})$/i.exec(value)
      if (match) tint = [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)]
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      // Guard against a runaway feedback loop: a canvas sized from its own
      // intrinsic width would otherwise grow without bound (see the CSS note).
      if (!rect.width || !rect.height || rect.width > 20000 || rect.height > 20000) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      readTint()
    }
    const draw = (now: number) => {
      raf = 0
      if (!visible || document.hidden) { last = 0; return }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      if (!reduce.matches) time += dt
      ctx.clearRect(0, 0, width, height)
      for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].at > 3600) ripples.splice(i, 1)
      const cols = Math.ceil(width / CELL)
      const rows = Math.ceil(height / CELL)
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = col * CELL
          const y = row * CELL
          const field = Math.sin(x * 0.0105 + time * 0.62) + Math.sin(y * 0.0132 - time * 0.43) + Math.sin((x + y) * 0.0071 + time * 0.27)
          let energy = (field + 3) / 6
          for (const ripple of ripples) {
            const age = (now - ripple.at) / 1000
            const dist = Math.hypot(x - ripple.x, y - ripple.y)
            const band = Math.exp(-(((dist - age * 240) / 46) ** 2))
            energy += band * Math.exp(-age * 1.35) * ripple.power
          }
          const clamped = Math.min(1, Math.max(0, energy))
          const alpha = clamped * clamped * 0.5
          if (alpha < 0.012) continue
          ctx.beginPath()
          ctx.arc(x, y, 0.7 + clamped * 1.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${alpha})`
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(draw) } }
    let lastSplash = 0
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
      const now = performance.now()
      if (now - lastSplash > 70) {
        ripples.push({ x, y, at: now, power: 0.55 })
        if (ripples.length > 24) ripples.shift()
        lastSplash = now
      }
      wake()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const onScreen = new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); if (visible) wake() })
    onScreen.observe(canvas)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('visibilitychange', wake)
    if (reduce.matches) { time = 8; draw(performance.now()) } else wake()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      onScreen.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])
  return <canvas ref={canvasRef} className={className} aria-hidden="true"/>
}

/**
 * Seamless cover marquee. The strip drifts at reading pace, pauses under the
 * pointer, and owns the wheel while the pointer is on it. Content renders twice
 * so the loop never shows a seam.
 *
 * The strip is the carousel: whichever cover sits on the playhead — the middle
 * of the visible window — is the one the stage presents, so drifting, wheeling
 * or panning the ribbon is what changes the stage. The drift covers exactly one
 * slot per COVER_ROTATE_MS, which keeps the stage dwell ring honest instead of
 * resetting halfway through it.
 */
const STRIP_PLAYHEAD = 0.5
/** A fling can sweep a dozen covers; the stage is re-aimed this often at most,
 *  so a fast scroll reads as one change instead of a blur of them. */
const STRIP_STAGE_COAST = 420

function CoverStrip({ scores, featuredId, coverUrls, onPreview, onOpen, drift, settled }: { scores: ScoreRecord[]; featuredId?: string; coverUrls: Record<string, string>; onPreview: (score: ScoreRecord) => void; onOpen: (score: ScoreRecord) => void; drift: boolean; settled: boolean }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const paused = useRef(false)
  const wheelTarget = useRef<number | null>(null)
  const aimClock = useRef(0)
  const aligned = useRef(false)
  const metrics = useRef({ repeat: 0, pitch: 0, inset: 0 })
  const aimNow = useRef<(force?: boolean) => void>(() => {})
  // The element stores scroll offsets quantised to its own grid — a 1.5x
  // display steps in thirds of a pixel — so `scrollLeft += step` rounds the
  // result every frame and the strip runs ~26% faster than asked. Keep the
  // authoritative position here and treat `scrollLeft` as a rounded view of it.
  const position = useRef(0)
  const written = useRef(0)
  // The frame loop outlives the render that started it, so it reads the newest
  // callback, prop and featured score through refs.
  const preview = useRef(onPreview)
  preview.current = onPreview
  const drifting = useRef(drift)
  drifting.current = drift
  // The shell paints a provisional opening score and commits the real one a
  // frame later, so parking the ribbon waits for that pick to settle.
  const settling = useRef(settled)
  settling.current = settled
  const shown = useRef(0)
  shown.current = Math.max(0, scores.findIndex((score) => score.id === featuredId))
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return undefined
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0
    let last = 0
    // The loop length is the real repeat distance: scrollWidth / 2 also carries
    // the trailing gap, which used to shift the phase on every wrap.
    const measure = () => {
      const covers = strip.querySelectorAll<HTMLElement>('.strip-cover')
      if (covers.length <= scores.length) return
      const repeat = covers[scores.length].offsetLeft - covers[0].offsetLeft
      if (repeat <= 0) return
      metrics.current = { repeat, pitch: repeat / scores.length, inset: parseFloat(getComputedStyle(strip).paddingLeft) || 0 }
    }
    measure()
    window.addEventListener('resize', measure)
    const slotAt = (scrollLeft: number) => {
      const { pitch, inset } = metrics.current
      return pitch > 0 ? Math.floor((scrollLeft + strip.clientWidth * STRIP_PLAYHEAD - inset) / pitch) : -1
    }
    const wrap = () => {
      const { repeat } = metrics.current
      if (repeat <= 0) return
      if (position.current >= repeat) { position.current -= repeat; if (wheelTarget.current != null) wheelTarget.current -= repeat }
      else if (position.current < 0) { position.current += repeat; if (wheelTarget.current != null) wheelTarget.current += repeat }
    }
    // Write the authoritative position out through the quantised element, and
    // remember what it actually held so an outside scroll can be spotted.
    const place = (value: number) => {
      position.current = value
      strip.scrollLeft = value
      written.current = strip.scrollLeft
    }
    // Opening move: park the strip so the score the app picked opens on the
    // playhead, and adopt it, so nothing dissolves on the first frame. Landing
    // on the slot edge rather than its middle also leaves the drift in phase
    // with the dwell ring: the first crossing then arrives a full slot later.
    // The target is folded into the loop rather than clamped: the list repeats,
    // so a score too early to reach from the left edge is simply reached inside
    // the second copy.
    const align = () => {
      aligned.current = true
      const { pitch, inset, repeat } = metrics.current
      if (pitch <= 0 || repeat <= 0) return
      let target = shown.current * pitch + inset - strip.clientWidth * STRIP_PLAYHEAD
      while (target < 0) target += repeat
      while (target >= repeat) target -= repeat
      place(target)
    }
    // Where the stage should be aimed. Slot arithmetic instead of measuring the
    // children every frame keeps it cheap enough to run inside the loop, and the
    // aim only fires off real movement: a resting pointer keeps the cover it
    // picked, while a drift or a wheel takes the stage back.
    const aim = (now: number, moved: boolean, force = false) => {
      const slot = slotAt(strip.scrollLeft)
      if (slot < 0) return
      const index = slot % scores.length
      if (index === shown.current) return
      if (!force) {
        if (!moved) return
        if (now - aimClock.current < STRIP_STAGE_COAST) return
      }
      aimClock.current = now
      shown.current = index
      preview.current(scores[index])
    }
    aimNow.current = (force = false) => aim(performance.now(), true, force)
    let lastScroll = -1
    const tick = (now: number) => {
      raf = 0
      const dt = last ? Math.min(64, now - last) : 16
      last = now
      const { repeat, pitch } = metrics.current
      if (repeat > strip.clientWidth) {
        if (!aligned.current && settling.current) align()
        // A focused cover scrolled into view, or a clamped write, counts as an
        // outside scroll: re-base on whatever the element really holds.
        if (Math.abs(strip.scrollLeft - written.current) > 0.75) position.current = strip.scrollLeft
        if (wheelTarget.current != null) {
          position.current += (wheelTarget.current - position.current) * Math.min(1, dt / 110)
          if (Math.abs(wheelTarget.current - position.current) < 0.6) wheelTarget.current = null
        } else if (drifting.current && !paused.current && !reduce.matches && !document.hidden) {
          position.current += dt * (pitch / COVER_ROTATE_MS)
        }
        wrap()
        place(position.current)
        const moved = strip.scrollLeft !== lastScroll
        lastScroll = strip.scrollLeft
        aim(now, moved)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure) }
  }, [scores])
  // React routes onWheel through a passive listener, where preventDefault() is
  // ignored, so the ribbon takes the wheel natively: browsing it never drags the
  // page along, and the eased target now survives the pointer sliding off mid
  // trip instead of being dropped the moment the ribbon leaves the cursor.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return undefined
    const onWheel = (event: WheelEvent) => {
      const { repeat } = metrics.current
      if (repeat <= strip.clientWidth) return
      event.preventDefault()
      let target = (wheelTarget.current ?? position.current) + event.deltaY + event.deltaX
      // Fold the target to the nearest copy so the eased trip stays short.
      while (target - position.current > repeat / 2) target -= repeat
      while (position.current - target > repeat / 2) target += repeat
      wheelTarget.current = target
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [scores])
  return <div
    className="cover-strip"
    ref={stripRef}
    onPointerEnter={() => { paused.current = true }}
    onPointerLeave={() => { paused.current = false; aimNow.current(true) }}
    onFocusCapture={() => { paused.current = true }}
    onBlurCapture={() => { paused.current = false }}
  >
    {[...scores, ...scores].map((score, index) => {
      const clone = index >= scores.length
      return <button
        key={`${score.id}:${index}`}
        className={`strip-cover ${score.id === featuredId ? 'active' : ''}`}
        aria-hidden={clone || undefined}
        aria-label={clone ? undefined : `快速浏览：${score.title}`}
        tabIndex={clone ? -1 : 0}
        onMouseEnter={() => { if (!clone) onPreview(score) }}
        onFocus={() => { if (!clone) onPreview(score) }}
        onClick={() => onOpen(score)}
      >
        <CoverArtwork score={score} url={coverUrls[score.id]}/>
        <span><strong>{score.title}</strong><small>{score.artist || '未知艺术家'}</small></span>
      </button>
    })}
  </div>
}

import { bookSpreadIndex, bookSpreadPageIndices, bookSpreadPages, bookSpreadStart, bookStep, fittedBookPageWidth, fittedPageWidth, fittedPerformancePageWidth, fittedPerformanceSheetWidth, hasBookStep, hasPerformanceSpreadStep, measureStage, performanceSpreadPages, performanceSpreadReadable, performanceSpreadStart, performanceSpreadStep, readingDeskWidth, SHEET_GAP, type StageSize } from './reader-layout'

/** Aspect used until a sheet has been measured: a plain A4 scan. */
const FALLBACK_SHEET = { width: 1280, height: 1810 }

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (score: ScoreRecord) => void }) {
  const [files, setFiles] = useState<FileChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', artist: '', guitarType: 'acoustic' as GuitarType, scoreType: '弹唱谱', originalKey: '', key: '', capo: '', tuning: STANDARD_TUNING, tags: '' })
  const choose = async () => setFiles(await window.arpeggio.chooseScoreFiles())
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!files.length) return setError('请先选择曲谱文件')
    if (!form.title.trim()) return setError('请填写曲名')
    setBusy(true); setError('')
    try {
      const result = await window.arpeggio.importScore(files.map((file) => file.path), {
        title: form.title, artist: form.artist, guitarType: form.guitarType, scoreType: form.scoreType,
        originalKey: form.originalKey || undefined, key: form.key || undefined,
        capo: form.capo === '' ? undefined : Number(form.capo), tuning: form.tuning, tags: form.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
      })
      if (result.status === 'duplicate') setError(`这份文件已在曲谱库中：${result.score.archiveNumber}`)
      else onImported(result.score)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="import-dialog" onSubmit={submit}>
      <header><div><span>ADD TO ARCHIVE</span><h2>录入新曲谱</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></header>
      <button className="file-drop" type="button" onClick={choose}><FilePlus2 size={25}/><strong>{files.length ? `已选择 ${files.length} 个文件` : '选择 PDF 或多张图片'}</strong><span>{files.length ? files.map((file) => file.name).join(' · ') : '多张图片将按选择顺序组成一份曲谱'}</span></button>
      <div className="form-grid">
        <label>曲名<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus/></label>
        <label>艺术家 / 作曲家<input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })}/></label>
        <label>吉他类型<select value={form.guitarType} onChange={(e) => setForm({ ...form, guitarType: e.target.value as GuitarType })}><option value="acoustic">木吉他</option><option value="electric">电吉他</option></select></label>
        <label>曲谱类型<select value={form.scoreType} onChange={(e) => setForm({ ...form, scoreType: e.target.value })}><option>弹唱谱</option><option>指弹谱</option><option>独奏谱</option><option>和弦谱</option></select></label>
        <label>原调<input placeholder="例如 D" value={form.originalKey} onChange={(e) => setForm({ ...form, originalKey: e.target.value })}/></label>
        <label>选调<input placeholder="例如 C" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}/></label>
        <label>Capo<input type="number" min="0" max="24" placeholder="不夹" value={form.capo} onChange={(e) => setForm({ ...form, capo: e.target.value })}/><small>留空即不夹变调夹</small></label>
        <label className="form-grid-wide">调弦设置<input value={form.tuning} onChange={(e) => setForm({ ...form, tuning: e.target.value })}/><small>有特殊调弦时，写明六根弦由 6 弦到 1 弦的音高，例如 D A D G B E（Drop D）</small></label>
        <label>标签<input placeholder="用逗号分隔" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}/></label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? '正在归档并匹配封面…' : '录入曲谱'}</button></footer>
    </form>
  </div>
}

function parseTimeline(value: string, pageCount: number): AutoTurnCue[] {
  const times = value.split(/[,，]/).map((item) => item.trim()).filter(Boolean).map((item) => {
    const parts = item.split(':').map(Number)
    return parts.length === 2 ? (parts[0] * 60 + parts[1]) * 1000 : parts[0] * 1000
  })
  return times.slice(0, pageCount).map((atMs, pageIndex) => ({ atMs, pageIndex })).filter((cue) => Number.isFinite(cue.atMs) && cue.atMs >= 0)
}

function PerformanceMode({ score, page, pageUrls, pageDimensions, spread, onSpreadChange, initialIntervalSeconds, profiles, onSaveProfile, onPage, onExit }: { score: ScoreRecord; page: number; pageUrls: string[]; pageDimensions: Record<number, { width: number; height: number }>; spread: boolean; onSpreadChange: (spread: boolean) => void; initialIntervalSeconds: number; profiles: AutoTurnProfile[]; onSaveProfile: (profile: AutoTurnProfile) => Promise<void>; onPage: (page: number) => void; onExit: () => void }) {
  const [controls, setControls] = useState(true)
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<AutoTurnProfileKind>('fixed')
  const [intervalSeconds, setIntervalSeconds] = useState(initialIntervalSeconds)
  const [perPageText, setPerPageText] = useState(Array(score.pageCount).fill(initialIntervalSeconds).join(', '))
  const [timelineText, setTimelineText] = useState(Array.from({ length: score.pageCount }, (_, index) => `0:${String(index * initialIntervalSeconds).padStart(2, '0')}`).join(', '))
  const [recording, setRecording] = useState(false)
  const [recordedCues, setRecordedCues] = useState<AutoTurnCue[]>([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [stage, setStage] = useState({ width: 0, height: 0 })
  // Sheets are measured here rather than read from the reader: performance mode
  // mounts its own <img> elements, and the first spread has to be sized from a
  // real scan instead of a guessed ratio.
  const [measured, setMeasured] = useState(() => pageDimensions)
  const stageRef = useRef<HTMLDivElement>(null)
  const anchor = useRef({ time: 0, elapsed: 0 })
  const recordStartedAt = useRef(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageRef = useRef(page)
  useEffect(() => { pageRef.current = page }, [page])
  // Layout effect so the measured stage is known before the first paint: sizing
  // in a passive effect renders one frame of a 120px stand-in sheet.
  useLayoutEffect(() => {
    const element = stageRef.current
    if (!element) return
    const measure = () => setStage({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const pageCount = score.pageCount
  // A spread is anchored to even sheets (1-2, 3-4 …) so the pedal stride stays
  // constant and a sheet never migrates between the two halves of the stand.
  const spreadStart = spread ? performanceSpreadStart(page, pageCount) : page
  const [leftSheet, rightSheet] = spread ? performanceSpreadPages(spreadStart, pageCount) : [page, null]
  const knownSheet = measured[leftSheet ?? 0] ?? measured[spreadStart] ?? Object.values(measured)[0] ?? FALLBACK_SHEET
  // Both halves of a spread share one ratio, so they render as one visual unit
  // instead of two sheets of slightly different heights on the same stand.
  const sheetWidth = spread
    ? fittedPerformanceSheetWidth(stage, knownSheet)
    : fittedPerformancePageWidth(stage, knownSheet)
  // Floored for the same reason the width is: rounding the height up would push
  // the sheet back past the bottom edge the width was just fitted to.
  const sheetHeight = Math.floor(sheetWidth * knownSheet.height / knownSheet.width)
  const spreadReadable = !spread || stage.width === 0 || performanceSpreadReadable(stage, knownSheet)
  const cues = useMemo<AutoTurnCue[]>(() => {
    const raw = (() => {
      if (mode === 'rehearsal') return recordedCues
      if (mode === 'timeline') return parseTimeline(timelineText, score.pageCount)
      const durations = mode === 'per-page'
        ? perPageText.split(/[,，]/).map(Number).map((value) => Number.isFinite(value) && value > 0 ? value : initialIntervalSeconds)
        : Array(score.pageCount).fill(intervalSeconds)
      let elapsed = 0
      return durations.slice(0, score.pageCount).map((duration, pageIndex) => {
        const cue = { atMs: elapsed, pageIndex }; elapsed += duration * 1000; return cue
      })
    })()
    if (!spread) return raw
    // A spread shows two sheets, so two per-sheet cues collapse into the one
    // turn that actually happens — keeping the earlier of the two times.
    const bySpread = new Map<number, AutoTurnCue>()
    for (const cue of raw) {
      const key = performanceSpreadStart(cue.pageIndex, score.pageCount)
      if (!bySpread.has(key)) bySpread.set(key, { atMs: cue.atMs, pageIndex: key })
    }
    return [...bySpread.values()]
  }, [initialIntervalSeconds, intervalSeconds, mode, perPageText, recordedCues, score.pageCount, spread, timelineText])
  const showControls = useCallback(() => {
    setControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControls(false), 2600)
  }, [])
  const stopTimer = () => { if (wakeTimer.current) clearTimeout(wakeTimer.current); wakeTimer.current = null }
  const schedule = useCallback(() => {
    stopTimer()
    const tick = () => {
      const elapsed = anchor.current.elapsed + performance.now() - anchor.current.time
      const currentCue = [...cues].reverse().find((cue) => cue.atMs <= elapsed) ?? cues[0]
      if (currentCue && currentCue.pageIndex !== pageRef.current) onPage(currentCue.pageIndex)
      const nextCue = cues.find((cue) => cue.atMs > elapsed)
      if (!nextCue) setRunning(false)
      else wakeTimer.current = setTimeout(tick, Math.max(40, nextCue.atMs - elapsed))
    }
    const elapsed = anchor.current.elapsed
    const nextCue = cues.find((cue) => cue.atMs > elapsed)
    if (nextCue) wakeTimer.current = setTimeout(tick, Math.max(40, nextCue.atMs - elapsed))
    else setRunning(false)
  }, [cues, onPage])
  useEffect(() => { if (running) schedule(); else stopTimer(); return stopTimer }, [running, schedule])
  const manualPage = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(score.pageCount - 1, next))
    onPage(bounded)
    if (recording) setRecordedCues((current) => [...current, { atMs: Math.round(performance.now() - recordStartedAt.current), pageIndex: bounded }])
  }, [onPage, recording, score.pageCount])
  // One press advances a whole spread, never a single sheet: a half turn would
  // only swap which sheet sits on the left while the player is reading.
  const stepPage = useCallback((direction: -1 | 1) => {
    const current = pageRef.current
    manualPage(spread ? performanceSpreadStep(current, direction, pageCount) : current + direction)
  }, [manualPage, pageCount, spread])
  useEffect(() => {
    showControls()
    const key = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)
      if (editable && event.key !== 'Escape') return
      if (event.key === 'Escape') onExit()
      else if (['ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); stepPage(1) }
      else if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); stepPage(-1) }
      else if (event.key === 'Enter' && !recording) setRunning((value) => { if (!value) anchor.current = { time: performance.now(), elapsed: cues.find((cue) => cue.pageIndex === pageRef.current)?.atMs ?? 0 }; return !value })
      showControls()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [cues, stepPage, onExit, recording, showControls])
  const toggle = () => setRunning((value) => { if (!value) anchor.current = { time: performance.now(), elapsed: cues.find((cue) => cue.pageIndex === spreadStart)?.atMs ?? 0 }; return !value })
  const toggleRecording = async () => {
    if (!recording) {
      setRunning(false); setRecordedCues([{ atMs: 0, pageIndex: spreadStart }]); recordStartedAt.current = performance.now(); setRecording(true)
    } else {
      setRecording(false)
      const profile: AutoTurnProfile = { id: crypto.randomUUID(), scoreId: score.id, name: `排练记录 ${profiles.length + 1}`, kind: 'rehearsal', cues: recordedCues, warningSeconds: 3, isDefault: profiles.length === 0, createdAt: new Date().toISOString() }
      await onSaveProfile(profile); setSelectedProfile(profile.id)
    }
  }
  const loadProfile = (id: string) => {
    setSelectedProfile(id)
    const profile = profiles.find((item) => item.id === id); if (!profile) return
    setMode(profile.kind)
    if (profile.intervalMs) setIntervalSeconds(profile.intervalMs / 1000)
    if (profile.durationsMs) setPerPageText(profile.durationsMs.map((value) => value / 1000).join(', '))
    if (profile.cues) { setRecordedCues(profile.cues); setTimelineText(profile.cues.map((cue) => `${Math.floor(cue.atMs / 60000)}:${String(Math.floor(cue.atMs / 1000) % 60).padStart(2, '0')}`).join(', ')) }
  }
  const resync = () => { anchor.current = { time: performance.now(), elapsed: cues.find((cue) => cue.pageIndex === spreadStart)?.atMs ?? 0 }; if (running) schedule() }
  const sheet = (index: number | null, position: 'left' | 'right') => index == null
    // A missing right half is an empty stand, not a reason to recentre the left
    // sheet: keeping the slot means the score never jumps between spreads.
    ? <div className="performance-sheet blank" key={position} aria-hidden="true"/>
    : <div className="performance-sheet" key={position}>
      <img
        src={pageUrls[index]}
        alt={`${score.title} 第 ${index + 1} 页`}
        onLoad={(event) => {
          const image = event.currentTarget
          setMeasured((current) => current[index]?.width === image.naturalWidth && current[index]?.height === image.naturalHeight ? current : { ...current, [index]: { width: image.naturalWidth, height: image.naturalHeight } })
        }}
      />
    </div>
  return <div className="performance" onMouseMove={showControls}>
    {/* The sheet box is published as a custom property on the stage itself, so
        the single-sheet and spread branches read one identical size. */}
    <div className="performance-stage" ref={stageRef} style={{ '--sheet-width': `${sheetWidth}px`, '--sheet-height': `${sheetHeight}px` } as React.CSSProperties}>
      {/* Two sheets side by side, sized so the pair plus its seam always fits
          the stage: the score is never cropped and never needs scrolling. */}
      {spread
        ? <div className="performance-spread">
          {sheet(leftSheet, 'left')}
          {sheet(rightSheet, 'right')}
        </div>
        : <div className="performance-page">{sheet(page, 'left')}</div>}
    </div>
    <button className={`edge prev ${controls ? 'visible' : ''}`} aria-label="上一页" disabled={spread ? !hasPerformanceSpreadStep(page, -1, pageCount) : page === 0} onClick={() => stepPage(-1)}><ChevronLeft/></button>
    <button className={`edge next ${controls ? 'visible' : ''}`} aria-label="下一页" disabled={spread ? !hasPerformanceSpreadStep(page, 1, pageCount) : page === pageCount - 1} onClick={() => stepPage(1)}><ChevronRight/></button>
    {/* The score owns the whole stage height, so every control lives in the right
        rail instead of floating over the notes. */}
    <div className={`performance-controls ${controls ? 'visible' : ''}`}>
      <div className="rail-score"><strong>{score.title}</strong><span>{score.archiveNumber} · {score.guitarType === 'acoustic' ? '木吉他' : '电吉他'}</span></div>
      {/* Only rehearsals can create a saved profile, so the picker stays hidden
          until this score actually has one. */}
      {profiles.length > 0 && <label>翻页方案 <select value={selectedProfile} onChange={(e) => loadProfile(e.target.value)}><option value="">临时方案（未保存）</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>}
      <button className="play-round" onClick={toggle} disabled={recording || cues.length < 2} title="Enter 开始/暂停">{running ? <Pause/> : <Play/>}</button>
      <div className="rail-state"><strong>{recording ? '正在记录手动翻页' : running ? '自动翻页进行中' : 'Performance Mode'}</strong><span>Enter 开始/暂停 · 方向键或脚踏板翻页</span></div>
      <span className="page-indicator">{rightSheet != null ? `${leftSheet! + 1}–${rightSheet + 1}` : `${spreadStart + 1}`} / {score.pageCount}</span>
      <label>版面 <select value={spread ? 'spread' : 'single'} onChange={(e) => onSpreadChange(e.target.value === 'spread')}><option value="spread">双页摊开</option><option value="single">单页</option></select></label>
      {spread && !spreadReadable && <p className="rail-hint">窗口偏窄，双页会偏小。可切换到单页，或拉宽窗口。</p>}
      <label>模式 <select value={mode} onChange={(e) => { setRunning(false); setMode(e.target.value as AutoTurnProfileKind) }}><option value="fixed">固定时间</option><option value="per-page">逐页时长</option><option value="timeline">整首时间轴</option><option value="rehearsal">排练记录</option></select></label>
      {mode === 'fixed' && <label>每页 <select value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value))}><option value="5">5 秒</option><option value="10">10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label>}
      {mode === 'per-page' && <input className="timing-input" aria-label="逐页时长" value={perPageText} onChange={(e) => setPerPageText(e.target.value)} title="每页秒数，以逗号分隔"/>}
      {mode === 'timeline' && <input className="timing-input" aria-label="翻页时间轴" value={timelineText} onChange={(e) => setTimelineText(e.target.value)} title="每页开始时间，例如 0:00, 0:52, 1:44"/>}
      {mode === 'rehearsal' && <button className={`record-button ${recording ? 'active' : ''}`} onClick={toggleRecording}>{recording ? '停止并保存' : '开始记录'}</button>}
      <button className="rail-icon" onClick={resync} title="从当前页重新同步"><RotateCcw size={18}/></button>
      <button className="rail-exit" onClick={onExit}>退出演奏模式 · Esc</button>
    </div>
  </div>
}

export default function App() {
  const [scores, setScores] = useState<ScoreRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [view, setView] = useState<View>('library')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pageUrls, setPageUrls] = useState<string[]>([])
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({})
  const [featuredId, setFeaturedId] = useState('')
  const [featureSeed] = useState(() => Math.random())
  const [zoom, setZoom] = useState(100)
  const [readerFit, setReaderFit] = useState<FitMode>('page')
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0, middle: 0 })
  const [pageDimensions, setPageDimensions] = useState<Record<number, { width: number; height: number }>>({})
  const [pageTurn, setPageTurn] = useState<{ from: number; to: number; direction: 'forward' | 'backward'; id: number } | null>(null)
  const turnId = useRef(0)
  const preloadedPages = useRef<HTMLImageElement[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [performance, setPerformance] = useState(false)
  // Two facing sheets is the default on stage — a performance is read from the
  // stand, and turning is the thing the player wants to do least. The choice is
  // remembered so a player who prefers one sheet is not re-opted in every time.
  const [performanceSpread, setPerformanceSpread] = useState(() => window.localStorage.getItem('arpeggio:performance-layout') !== 'single')
  const changePerformanceSpread = useCallback((next: boolean) => {
    setPerformanceSpread(next)
    try { window.localStorage.setItem('arpeggio:performance-layout', next ? 'spread' : 'single') } catch { /* private mode: keep the in-memory choice */ }
  }, [])
  const [editingNotes, setEditingNotes] = useState(false)
  const [editingSideNotes, setEditingSideNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [importing, setImporting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [libraryState, setLibraryState] = useState<LibraryState>(defaultLibraryState())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [setlistsOpen, setSetlistsOpen] = useState(false)
  // The cover stage cycles by itself. Someone who has asked the system for less
  // motion is opted out by default, and the choice survives restarts.
  const [stageRotate, setStageRotate] = useState(() => {
    const stored = window.localStorage.getItem('arpeggio:stage-rotation')
    if (stored) return stored === 'on'
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  const changeStageRotate = useCallback((next: boolean) => {
    setStageRotate(next)
    try { window.localStorage.setItem('arpeggio:stage-rotation', next ? 'on' : 'off') } catch { /* private mode: keep the in-memory choice */ }
  }, [])
  // The plate that is dissolving out, plus the two clocks that drive rotation.
  const [leavingFeatured, setLeavingFeatured] = useState<ScoreRecord | null>(null)
  const [rotateTick, setRotateTick] = useState(0)
  const previousFeatured = useRef<ScoreRecord | null>(null)
  const rotateClock = useRef(Date.now())
  const stageHovering = useRef(false)
  // Reader side rails are collapsed by default so the score fills the stage;
  // the toolbar toggle brings notes / page index back at any window size.
  const [readerPanels, setReaderPanels] = useState(true)
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scoresSnapshot = useRef('')
  const notify = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 1800)
  }, [])
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])
  const resolveCoverUrls = useCallback(async (items: ScoreRecord[]) => {
    const entries = await Promise.all(items.filter((score) => score.coverFile).map(async (score) => [score.id, await window.arpeggio.assetUrl(score.coverFile!)] as const))
    setCoverUrls(Object.fromEntries(entries))
  }, [])
  const applyScores = useCallback(async (data: ScoreRecord[]) => {
    const snapshot = JSON.stringify(data)
    if (snapshot === scoresSnapshot.current) return
    scoresSnapshot.current = snapshot
    setScores(data)
    await resolveCoverUrls(data)
  }, [resolveCoverUrls])
  const refreshScores = useCallback(async () => {
    await applyScores(await window.arpeggio.listScores())
  }, [applyScores])
  const load = useCallback(async () => {
    const [data, state] = await Promise.all([window.arpeggio.listScores(), window.arpeggio.getLibraryState()])
    await applyScores(data)
    setLibraryState(state); setSelectedId((current) => current || data[0]?.id || ''); setLoading(false)
  }, [applyScores])
  useEffect(() => {
    load()
    window.arpeggio.refreshCovers().then(refreshScores).catch(() => undefined)
  }, [load, refreshScores])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') refreshScores().catch(() => undefined) }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 3000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(interval)
    }
  }, [refreshScores])
  useEffect(() => {
    if (featuredId || !scores.length) return
    const previousId = window.localStorage.getItem('arpeggio:last-featured-score')
    const candidates = scores.length > 1 ? scores.filter((score) => score.id !== previousId) : scores
    const chosen = candidates[Math.floor(Math.random() * candidates.length)]
    setFeaturedId(chosen.id)
    window.localStorage.setItem('arpeggio:last-featured-score', chosen.id)
  }, [featuredId, scores])
  const visibleScores = useMemo(() => scores.filter((score) => {
    if (scope === 'acoustic' && score.guitarType !== 'acoustic') return false
    if (scope === 'electric' && score.guitarType !== 'electric') return false
    if (scope === 'favorites' && !score.favorite) return false
    return scoreMatches(score, query)
  }).sort((left, right) => scope === 'recent' ? Date.parse(right.createdAt) - Date.parse(left.createdAt) : 0), [query, scope, scores])
  const selected = scores.find((score) => score.id === selectedId) ?? visibleScores[0]
  const featured = visibleScores.find((score) => score.id === featuredId) ?? visibleScores[Math.floor(featureSeed * visibleScores.length)]
  // Two plates are painted for the length of the dissolve, so a rotation reads
  // as a cross-fade instead of a blink through an empty stage.
  useEffect(() => {
    const previous = previousFeatured.current
    previousFeatured.current = featured ?? null
    if (!featured || !previous || previous.id === featured.id) { setLeavingFeatured(null); return undefined }
    setLeavingFeatured(previous)
    const timer = window.setTimeout(() => setLeavingFeatured(null), 1200)
    return () => window.clearTimeout(timer)
  }, [featured?.id])
  // The dwell clock restarts whenever a new cover lands on the stage — also
  // when the person steps it by hand, so a click always buys a full dwell.
  useEffect(() => { rotateClock.current = Date.now() }, [featured?.id])
  const stepFeatured = useCallback((direction: 1 | -1) => {
    if (visibleScores.length < 2) return
    const index = Math.max(0, visibleScores.findIndex((score) => score.id === featured?.id))
    setFeaturedId(visibleScores[(index + direction + visibleScores.length) % visibleScores.length].id)
  }, [visibleScores, featured?.id])
  // Rotation yields to whatever the person is doing: a dialog, a cover the
  // pointer is resting on, a hidden window, a stage that is not on screen.
  const stageBusy = settingsOpen || setlistsOpen || importing || view !== 'library'
  useEffect(() => {
    if (!stageRotate || stageBusy || visibleScores.length < 2) return undefined
    const timer = window.setInterval(() => {
      if (stageHovering.current || document.hidden) return
      if (Date.now() - rotateClock.current < COVER_ROTATE_MS) return
      const index = Math.max(0, visibleScores.findIndex((score) => score.id === featured?.id))
      setFeaturedId(visibleScores[(index + 1) % visibleScores.length].id)
    }, 400)
    return () => window.clearInterval(timer)
  }, [stageRotate, stageBusy, visibleScores, featured?.id])
  // Book reading starts at two sheets: a two-sheet score has no cover-and-facing
  // sequence, both sheets are the spread (see reader-layout). Requiring three
  // sheets used to drop a two-sheet score to a lone centred page.
  const bookMode = libraryState.settings.viewer.mode === 'single' && (selected?.pageCount ?? 0) >= 2
  const openScore = (score: ScoreRecord) => { setSelectedId(score.id); setFeaturedId(score.id); setView('detail') }
  const openReader = () => { setView('reader'); requestAnimationFrame(() => stageRef.current?.focus()) }
  const showScope = (next: Scope) => { setScope(next); setView('library') }
  useEffect(() => {
    if (!selected) return
    const lastPage = Math.min(selected.lastPage, selected.pageCount - 1)
    setPage(libraryState.settings.viewer.mode === 'single' && selected.pageCount >= 2 ? bookSpreadStart(lastPage, selected.pageCount) : lastPage)
    setReaderFit('page'); setZoom(100); setPageDimensions({}); setPageTurn(null); setEditingNotes(false); setEditingSideNotes(false)
    Promise.all(selected.pageFiles.map((path) => window.arpeggio.assetUrl(path))).then(setPageUrls)
  }, [selected?.id])
  useEffect(() => {
    if (view !== 'reader' || performance || !stageRef.current) return
    const stage = stageRef.current
    const measure = () => setStageSize(measureStage(stage))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [view, selected?.id, performance, readerPanels])
  // Warm the *decoded* bitmap of every page of the open score so a page turn
  // never pays for it. A detached `<img>` without `decode()` only warms the
  // encoded bytes — the flip still decodes the whole scan on the frame that
  // creates the turning leaf, measured at 52-170ms for a 2480x3508 PNG. That
  // decode is the ~100ms freeze between the click and the first animation frame
  // (`node qa/app-repro.mjs --turn --perf`: animationstart moved from +104ms to
  // +27ms when the pages were decoded up front). The elements are parked in a
  // ref so nothing collects the bitmaps that were just paid for.
  useEffect(() => {
    const images = pageUrls.map((url) => {
      const image = new Image()
      image.decoding = 'async'
      image.src = url
      image.decode().catch(() => undefined)
      return image
    })
    preloadedPages.current = images
    return () => { preloadedPages.current = [] }
  }, [pageUrls])
  useEffect(() => { setPageTurn(null) }, [view, performance, libraryState.settings.viewer.mode])
  useEffect(() => { if (bookMode && view === 'reader' && !performance) setPage((current) => bookSpreadStart(current, selected?.pageCount ?? 0)) }, [bookMode, view, performance])
  const changePage = useCallback((next: number) => {
    if (!selected) return
    const target = Math.max(0, Math.min(selected.pageCount - 1, next))
    const bounded = bookMode && view === 'reader' && !performance ? bookSpreadStart(target, selected.pageCount) : target
    if (bounded === page) return
    // Only a neighbouring spread animates; jumping through the page index or a
    // bookmark lands straight on its spread instead of flipping through sheets.
    const adjacentBookSpread = Math.abs(bookSpreadIndex(bounded, selected.pageCount) - bookSpreadIndex(page, selected.pageCount)) === 1
    if (view === 'reader' && !performance && libraryState.settings.viewer.mode !== 'continuous' && (!bookMode || adjacentBookSpread) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPageTurn({ from: page, to: bounded, direction: bounded > page ? 'forward' : 'backward', id: ++turnId.current })
    } else setPageTurn(null)
    setPage(bounded)
    window.arpeggio.updateScore(selected.id, { lastPage: bounded }).catch(() => undefined)
  }, [selected, page, view, performance, libraryState.settings.viewer.mode, bookMode])
  const toggleFavorite = async () => {
    if (!selected) return
    const updated = await window.arpeggio.updateScore(selected.id, { favorite: !selected.favorite })
    setScores((current) => current.map((score) => score.id === updated.id ? updated : score))
    notify(updated.favorite ? '已加入收藏' : '已取消收藏')
  }
  const saveNotes = async () => {
    if (!selected) return
    const updated = await window.arpeggio.updateScore(selected.id, { notes: notesDraft.trim() })
    setScores((current) => current.map((score) => score.id === updated.id ? updated : score))
    setEditingNotes(false)
    setEditingSideNotes(false)
    notify('批注已保存')
  }
  const enterPerformance = async () => {
    if (!selected) return
    await window.arpeggio.updateScore(selected.id, { lastPlayedAt: new Date().toISOString(), playCount: selected.playCount + 1 })
    // The reader may be sitting on an odd sheet (a book spread starts anywhere);
    // align to the stage's pairs before mounting it so the very first frame is
    // already the correct spread instead of flashing a half-turned stand.
    if (performanceSpread) {
      const start = performanceSpreadStart(page, selected.pageCount)
      if (start !== page) {
        setPage(start)
        window.arpeggio.updateScore(selected.id, { lastPage: start }).catch(() => undefined)
      }
    }
    await window.arpeggio.enterFullscreen(true); setPerformance(true); await load()
  }
  const exitPerformance = async () => { await window.arpeggio.enterFullscreen(false); setPerformance(false) }
  const saveLibraryState = async (state: LibraryState) => setLibraryState(await window.arpeggio.saveLibraryState(state))
  const changeViewerMode = async (mode: LibraryState['settings']['viewer']['mode']) => {
    if (!selected || mode === libraryState.settings.viewer.mode) return
    const nextPage = mode === 'single' ? bookSpreadStart(page, selected.pageCount) : page
    setPage(nextPage)
    setPageTurn(null)
    await saveLibraryState({ ...libraryState, settings: { ...libraryState.settings, viewer: { ...libraryState.settings.viewer, mode } } })
  }
  const bookmarks = selected ? libraryState.bookmarks.filter((bookmark) => bookmark.scoreId === selected.id) : []
  const addBookmark = async () => {
    if (!selected) return
    if (bookmarks.some((bookmark) => bookmark.pageIndex === page)) return notify('这一页已有书签')
    await saveLibraryState({ ...libraryState, bookmarks: [...libraryState.bookmarks, { id: crypto.randomUUID(), scoreId: selected.id, pageIndex: page, label: `第 ${page + 1} 页`, createdAt: new Date().toISOString() }] })
    notify(`已收藏第 ${page + 1} 页`)
  }
  const saveAutoTurnProfile = async (profile: AutoTurnProfile) => {
    const others = libraryState.autoTurnProfiles.filter((item) => item.id !== profile.id)
    await saveLibraryState({ ...libraryState, autoTurnProfiles: [...others, profile] })
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setView('library'); searchRef.current?.focus(); return }
      const editable = event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)
      if (editable) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') changePage(bookMode && !performance ? bookStep(page, 1, selected?.pageCount ?? 0) : page + 1)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') changePage(bookMode && !performance ? bookStep(page, -1, selected?.pageCount ?? 0) : page - 1)
      else if (event.key === 'F11') { event.preventDefault(); enterPerformance() }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [changePage, page, bookMode, performance])

  // Pages of one score share their aspect ratio; falling back to any measured
  // page avoids a wrong-width first paint before a newly turned image loads.
  const knownDims = Object.values(pageDimensions)[0]
  // Book mode can start on any page, so the sheet frame must not depend on page
  // one having been measured: a stand-in A4 ratio letterboxes a 1200x1870 scan
  // inside the frame and shrinks the stave.
  const bookDimensions = pageDimensions[0] ?? knownDims ?? { width: 1280, height: 1810 }
  const dimsFor = (index: number) => pageDimensions[index] ?? knownDims ?? { width: 1280, height: 1810 }
  const bookWidth = fittedBookPageWidth(readerFit, zoom, { width: stageSize.middle, height: stageSize.height }, bookDimensions)
  const bookHeight = Math.round(bookWidth * bookDimensions.height / bookDimensions.width)
  const pageCount = selected?.pageCount ?? 0
  const currentBookPages = bookSpreadPages(bookSpreadStart(page, pageCount), pageCount)
  const fromBookPages = pageTurn && selected ? bookSpreadPages(bookSpreadStart(pageTurn.from, pageCount), pageCount) : null
  const toBookPages = pageTurn && selected ? bookSpreadPages(bookSpreadStart(pageTurn.to, pageCount), pageCount) : null
  const bookTransition = bookMode && pageTurn && fromBookPages && toBookPages
  const visibleBookPages: [number | null, number | null] = bookTransition
    ? pageTurn.direction === 'forward' ? [fromBookPages[0], toBookPages[1]] : [toBookPages[0], fromBookPages[1]]
    : currentBookPages
  const bookSheet = (pageIndex: number | null) => pageIndex == null ? <div className="book-blank"/> : <div className="paper book-paper">
    {selected?.assetKind === 'pdf' ? pageUrls[pageIndex] && <embed src={`${pageUrls[pageIndex]}#view=Fit`} type="application/pdf"/> : pageUrls[pageIndex] && <img src={pageUrls[pageIndex]} alt={`${selected?.title} 第 ${pageIndex + 1} 页`} onLoad={(event) => {
      const image = event.currentTarget
      setPageDimensions((current) => current[pageIndex]?.width === image.naturalWidth && current[pageIndex]?.height === image.naturalHeight ? current : { ...current, [pageIndex]: { width: image.naturalWidth, height: image.naturalHeight } })
    }}/>}</div>
  // Width of one sheet in the reading lane. Single source of truth: the lane
  // markup below and the reading desk both call it, so the desk can never drift
  // away from the sheet it has to sit under.
  const paperWidth = (index: number, double: boolean) => fittedPageWidth(readerFit, zoom, { width: double ? stageSize.middle / 2 : stageSize.middle, height: stageSize.height }, dimsFor(index))
  // Sheets the lane is about to render, side by side: the dark desk behind them
  // is sized from this — it used to be a fixed min(1020px, 100% - 408px) band
  // that a 适合宽度 spread (lane minus 84px) overflowed on both sides. A book
  // spread is one box (its pages are joined at the spine) and continuous mode
  // stacks its pages in a single column, so it passes the widest one only.
  const laneSheetWidths = (() => {
    if (!stageSize.middle || !selected) return []
    if (bookMode) return [bookWidth * 2]
    if (libraryState.settings.viewer.mode === 'continuous') return [Math.max(0, ...pageUrls.map((_, index) => paperWidth(index, false)))]
    const double = libraryState.settings.viewer.mode === 'double'
    const first = pageTurn?.direction === 'backward' ? pageTurn.from : page
    return (double && first + 1 < selected.pageCount ? [first, first + 1] : [first]).map((index) => paperWidth(index, double))
  })()
  const readingDesk = readingDeskWidth(laneSheetWidths, SHEET_GAP)
  // Sheets on screen right now, whichever layout produced them: the counter and
  // the page index both read this, so a two-sheet spread shows "1–2 / 2" and
  // lights both of its buttons instead of pretending only the left one exists.
  const onScreenPageIndices = bookMode
    ? bookSpreadPageIndices(page, pageCount)
    : libraryState.settings.viewer.mode === 'double' && page + 1 < pageCount ? [page, page + 1] : [page]
  const counterLabel = onScreenPageIndices.length > 1 ? `${onScreenPageIndices[0] + 1}–${onScreenPageIndices[onScreenPageIndices.length - 1] + 1}` : `${page + 1}`
  const turnHotzones = selected ? <>
    <button className="stage-hotzone prev" aria-label="上一页" disabled={bookMode && !performance ? !hasBookStep(page, -1, pageCount) : page === 0} onClick={() => changePage(bookMode && !performance ? bookStep(page, -1, pageCount) : page - 1)}><ChevronLeft/></button>
    <button className="stage-hotzone next" aria-label="下一页" disabled={bookMode && !performance ? !hasBookStep(page, 1, pageCount) : page === pageCount - 1} onClick={() => changePage(bookMode && !performance ? bookStep(page, 1, pageCount) : page + 1)}><ChevronRight/></button>
  </> : null

  if (performance && selected && pageUrls.length) return <PerformanceMode score={selected} page={page} pageUrls={pageUrls} pageDimensions={pageDimensions} spread={performanceSpread} onSpreadChange={changePerformanceSpread} initialIntervalSeconds={libraryState.settings.performance.defaultIntervalSeconds} profiles={libraryState.autoTurnProfiles.filter((profile) => profile.scoreId === selected.id)} onSaveProfile={saveAutoTurnProfile} onPage={changePage} onExit={exitPerformance}/>
  return <div className={`app-shell ${view === 'reader' ? 'view-detail view-reader' : view === 'detail' ? 'view-score-detail' : 'view-library'}`}>
    <header className="titlebar"><div className="brand"><span className="brand-mark">A</span><strong>Arpeggio</strong><i>A PRIVATE LIBRARY FOR GUITARISTS</i></div><span className="motto">Good music stays with you.</span><label className="global-search"><Search size={18}/><input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setView('library') }} placeholder="搜索曲名、艺术家、标签、调弦…"/><kbd>Ctrl K</kbd></label></header>
    <aside className="sidebar">
      <div className="nav-section">
        <NavItem active={view === 'library' && scope === 'all'} icon={<Archive/>} label="全部曲谱" count={scores.length} onClick={() => showScope('all')}/>
        <NavItem active={view === 'library' && scope === 'acoustic'} icon={<Guitar/>} label="木吉他" count={scores.filter((s) => s.guitarType === 'acoustic').length} onClick={() => showScope('acoustic')}/>
        <NavItem active={view === 'library' && scope === 'electric'} icon={<Gauge/>} label="电吉他" count={scores.filter((s) => s.guitarType === 'electric').length} onClick={() => showScope('electric')}/>
      </div>
      <div className="nav-section secondary-nav">
        <NavItem active={view === 'library' && scope === 'recent'} icon={<Clock3/>} label="最近添加" onClick={() => showScope('recent')}/><NavItem active={view === 'library' && scope === 'favorites'} icon={<Bookmark/>} label="收藏" onClick={() => showScope('favorites')}/><NavItem icon={<ListMusic/>} label="演出曲单" count={libraryState.setlists.length} onClick={() => setSetlistsOpen(true)}/><NavItem icon={<Layers3/>} label="分类集" onClick={() => showScope('all')}/><NavItem icon={<Tag/>} label="标签" onClick={() => showScope('all')}/><NavItem icon={<Trash2/>} label="回收站" count={0}/>
      </div>
      <div className="collections"><p>我的分类</p><NavItem icon={<BookOpen/>} label="弹唱" count={scores.filter((s) => s.tags.includes('弹唱')).length}/><NavItem icon={<FolderHeart/>} label="学习中" count={scores.filter((s) => s.learningStatus === 'learning').length}/></div>
      <div className="sidebar-colophon" aria-hidden="true"><Guitar/><span>GOOD<br/>MUSIC<br/>STAYS<br/>WITH YOU.</span></div>
      <button className="settings-button" onClick={() => setSettingsOpen(true)}><Settings size={17}/>设置</button>
    </aside>
    {view === 'library' && <main className="library-home" style={coverStageStyle(featured)}>
      <section className="cover-stage" aria-label="特色曲谱舞台">
        <div className="stage-ambient" aria-hidden="true"/>
        <StageWave/>
        <div className="hero-intro"><span>ARPEGGIO · COVER STAGE</span><h1><SplitReveal key={scope} text={scopeLabels[scope]}/></h1><p>从一张封面进入一份曲谱。收藏、查找，然后回到上次练习的位置。</p><div className="hero-actions"><button className="add-score hero-add" onClick={() => setImporting(true)}><Plus size={18}/>录入曲谱</button><span>{visibleScores.length} 份曲谱 · 本地收藏</span></div></div>
        {featured && <button className="featured-score" onClick={() => openScore(featured)} aria-label={`查看舞台曲目：${featured.title}`}>
          {leavingFeatured && <div className="featured-layer out" key={`out:${leavingFeatured.id}`} aria-hidden="true"><StageLayerBody score={leavingFeatured} url={coverUrls[leavingFeatured.id]}/></div>}
          <div className="featured-layer in" key={featured.id}><StageLayerBody score={featured} url={coverUrls[featured.id]}/></div>
        </button>}
        {visibleScores.length > 1 && <div className="stage-stepper" aria-label="切换主封面" style={{ '--rotate-dwell': `${COVER_ROTATE_MS}ms` } as React.CSSProperties}>
          <button className={`stage-rotate ${stageRotate ? 'on' : ''}`} aria-pressed={stageRotate} aria-label={stageRotate ? '暂停封面自动轮播' : '开启封面自动轮播'} title={stageRotate ? '暂停自动轮播' : '开启自动轮播'} onClick={() => changeStageRotate(!stageRotate)}>
            {stageRotate ? <Pause/> : <Play/>}
            {stageRotate && <svg className="rotate-ring" viewBox="0 0 36 36" aria-hidden="true" key={`${featured?.id}:${rotateTick}`}><circle cx="18" cy="18" r="16"/></svg>}
          </button>
          <button aria-label="上一个主封面" onClick={() => stepFeatured(-1)}><ChevronLeft/></button>
          <span>{String(Math.max(0, visibleScores.findIndex((score) => score.id === featured?.id)) + 1).padStart(2, '0')} / {String(visibleScores.length).padStart(2, '0')}</span>
          <button aria-label="下一个主封面" onClick={() => stepFeatured(1)}><ChevronRight/></button>
        </div>}
      </section>
      {visibleScores.length > 0 && <section
        className="cover-ribbon"
        onPointerEnter={() => { stageHovering.current = true }}
        onPointerLeave={() => { if (stageHovering.current) { stageHovering.current = false; rotateClock.current = Date.now(); setRotateTick((tick) => tick + 1) } }}
      ><header><div><span>QUICK BROWSE</span><h2>封面速览</h2></div><p>滚轮或触控板横向浏览 · 点击进入详情</p></header><CoverStrip scores={visibleScores} featuredId={featured?.id} coverUrls={coverUrls} drift={stageRotate} settled={featuredId !== ''} onPreview={(score) => setFeaturedId(score.id)} onOpen={openScore}/></section>}
      <div className="archive-lower">
      <section className="song-library"><header><div><span>THE COMPLETE LIBRARY</span><h2>{query ? `“${query}”的结果` : '所有歌曲'}</h2></div><p>{visibleScores.length} 份曲谱</p></header>
        {loading && <p className="empty">正在打开音乐档案…</p>}
        {!loading && visibleScores.length === 0 && <div className="library-empty"><Disc3/><h3>这里还没有歌曲</h3><p>换一个筛选条件，或录入第一份曲谱。</p></div>}
        {visibleScores.length > 0 && <div className="song-grid">{visibleScores.map((score) => <button key={score.id} className="song-card" onMouseEnter={() => setFeaturedId(score.id)} onFocus={() => setFeaturedId(score.id)} onClick={() => openScore(score)} aria-label={`打开 ${score.title} 曲谱`}>
          <CoverArtwork key={`${score.id}:${coverUrls[score.id] || ''}`} score={score} url={coverUrls[score.id]}/>
          <strong>{score.title}</strong><span>{score.artist || '未知艺术家'}</span><small>Score No. {score.archiveNumber} · {formatTuning(score.tuning)}</small>
        </button>)}</div>}
      </section>
      <div className="archive-side"><section className="setlist-shelf"><header><div><span>COLLECTIONS</span><h2>我的歌单</h2></div><button onClick={() => setSetlistsOpen(true)}>管理歌单 <ChevronRight size={16}/></button></header><div className="setlist-cards">
        {libraryState.setlists.map((setlist, index) => <button key={setlist.id} className={`setlist-card tone-${index % 3}`} onClick={() => setSetlistsOpen(true)}><ListMusic/><span><strong>{setlist.name}</strong><small>{setlist.scoreIds.length} 首歌曲</small></span><ChevronRight/></button>)}
        {!libraryState.setlists.length && <button className="setlist-card empty-setlist" onClick={() => setSetlistsOpen(true)}><BookOpen/><span><strong>创建第一张歌单</strong><small>为排练或演出整理曲目</small></span><Plus/></button>}
      </div></section><section className="archive-index"><header><span>CATALOGUE INDEX</span><h2>档案概览</h2></header><dl><div><dt>曲谱总数</dt><dd>{scores.length}</dd></div><div><dt>木吉他</dt><dd>{scores.filter((score) => score.guitarType === 'acoustic').length}</dd></div><div><dt>电吉他</dt><dd>{scores.filter((score) => score.guitarType === 'electric').length}</dd></div><div><dt>已收藏</dt><dd>{scores.filter((score) => score.favorite).length}</dd></div></dl><p className="index-signature" aria-hidden="true">Music is a kinder memory.</p></section></div>
      </div>
    </main>}
    {view === 'detail' && <main className="score-detail" style={coverStageStyle(selected)}>
      {!selected ? <div className="no-selection"><Guitar size={38}/><h2>私人吉他曲谱档案馆</h2><p>添加第一份曲谱，开始建立你的长期乐谱库。</p><button onClick={() => setImporting(true)}>添加曲谱</button></div> : <>
        <div className="detail-ambient" aria-hidden="true"/>
        <StageWave className="detail-wave"/>
        <header className="detail-nav"><button className="back-library" onClick={() => setView('library')}><ArrowLeft/>返回曲库</button><span>Score No. {selected.archiveNumber}</span><div><button className={`favorite ${selected.favorite ? 'on' : ''}`} onClick={toggleFavorite} aria-label={selected.favorite ? '取消收藏' : '加入收藏'}><Bookmark fill={selected.favorite ? 'currentColor' : 'none'}/></button><button className="icon-button" aria-label="阅读设置" onClick={() => setSettingsOpen(true)}><Settings/></button></div></header>
        <section className="detail-stage">
          <div className="detail-cover"><CoverArtwork score={selected} url={coverUrls[selected.id]}/><span aria-hidden="true">{selected.archiveNumber}</span></div>
          <div className="detail-copy"><span className="detail-kicker">{selected.guitarType === 'acoustic' ? 'ACOUSTIC GUITAR' : 'ELECTRIC GUITAR'} · {selected.scoreType}</span><h1><SplitReveal key={selected.id} text={selected.title} step={55} base={140}/></h1><h2>{selected.artist || '未知艺术家'}</h2><div className="detail-facts"><dl><dt>调弦</dt><dd>{formatTuning(selected.tuning)}</dd></dl><dl><dt>选调 / 原调</dt><dd>{selected.key || '—'} / {selected.originalKey || '—'}</dd></dl><dl><dt>Capo</dt><dd>{selected.capo == null ? '不夹变调夹' : `第 ${selected.capo} 品`}</dd></dl><dl><dt>曲谱页数</dt><dd>{selected.pageCount} 页</dd></dl></div><div className="detail-tags">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><p className="detail-note">{selected.notes || '这份曲谱还没有练习批注。打开阅读器后可随时记录指法、节拍和排练提示。'}</p><button className="open-reader" onClick={openReader}><BookOpen/>打开曲谱<span>从第 {Math.min(selected.lastPage + 1, selected.pageCount)} 页继续</span><ChevronRight/></button></div>
          <aside className="score-preview"><div className="preview-sheet">{selected.assetKind === 'pdf' ? pageUrls[0] && <embed src={`${pageUrls[0]}#view=Fit`} type="application/pdf"/> : pageUrls[0] && <img src={pageUrls[0]} alt={`${selected.title} 曲谱首页预览`}/>}</div><footer><span>FIRST PAGE PREVIEW</span><b>{selected.pageCount} PAGES</b></footer></aside>
        </section>
      </>}
    </main>}
    {view === 'reader' && <main className="detail">
      {!selected ? <div className="no-selection"><Guitar size={38}/><h2>私人吉他曲谱档案馆</h2><p>添加第一份曲谱，开始建立你的长期乐谱库。</p><button onClick={() => setImporting(true)}>添加曲谱</button></div> : <>
        <section className="metadata">
          <div className="meta-top"><button className="back-library" onClick={() => setView('detail')}><ArrowLeft/>返回详情</button><span className="archive-no">Score No. {selected.archiveNumber}</span><span>{selected.guitarType === 'acoustic' ? 'Acoustic Guitar' : 'Electric Guitar'} / {selected.scoreType}</span><button className={`favorite ${selected.favorite ? 'on' : ''}`} onClick={toggleFavorite} aria-label={selected.favorite ? '取消收藏' : '加入收藏'}><Bookmark fill={selected.favorite ? 'currentColor' : 'none'}/></button><button className="icon-button" aria-label="阅读设置" onClick={() => setSettingsOpen(true)}><Settings/></button></div>
          <h2>{selected.title}</h2><h3>{selected.artist}</h3><div className="reader-seal" aria-hidden="true"><span>A</span><small>GOOD MUSIC<br/>BETTER PEOPLE</small></div>
          <div className="facts"><dl><dt>调弦</dt><dd>{formatTuning(selected.tuning)}</dd></dl><dl><dt>选调</dt><dd>{selected.key || '—'}</dd></dl><dl><dt>原调</dt><dd>{selected.originalKey || '—'}</dd></dl><dl><dt>Capo</dt><dd>{selected.capo == null ? '不夹变调夹' : `${selected.capo} 品`}</dd></dl><dl><dt>页数</dt><dd>{selected.pageCount}</dd></dl></div>
          <details className="score-extras"><summary>曲谱资料 <ChevronRight size={14}/></summary><div className="tag-line">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="annotation-heading"><b>演奏批注</b><button type="button" onClick={() => { setNotesDraft(selected.notes || ''); setEditingNotes(true) }} aria-label="编辑演奏批注" title="编辑演奏批注"><PencilLine size={15}/></button></div>{editingNotes ? <div className="annotation-editor"><textarea aria-label="演奏批注内容" value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} rows={4}/><div><button type="button" onClick={() => setEditingNotes(false)}>取消</button><button type="button" onClick={saveNotes}>保存批注</button></div></div> : <p className="notes">{selected.notes || '用铅笔记下指法、节拍或排练提示。'}</p>}{bookmarks.length > 0 && <div className="bookmark-line"><b>书签</b>{bookmarks.map((bookmark) => <button key={bookmark.id} onClick={() => changePage(bookmark.pageIndex)}><Bookmark size={12}/>{bookmark.label}</button>)}</div>}</details>
        </section>
        <section className="viewer">
          <div className={`paper-stage mode-${libraryState.settings.viewer.mode}${readerPanels ? '' : ' panels-off'}`} ref={stageRef} tabIndex={-1} style={readingDesk ? { '--reader-desk-width': `${readingDesk}px` } as React.CSSProperties : undefined}>
            <aside className="reader-side reader-side-left">
              <span className="reader-side-kicker">REHEARSAL NOTES · 练习札记</span>
              <h4>练习批注</h4>
              {editingSideNotes ? <div className="reader-side-editor"><textarea aria-label="侧栏演奏批注内容" value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} rows={5}/><div><button onClick={() => setEditingSideNotes(false)}>取消侧栏批注</button><button onClick={saveNotes}>保存侧栏批注</button></div></div> : <><p className="reader-note-copy">{selected.notes || '还没有批注。可以记下指法、节拍或下次练习的提示。'}</p><button className="reader-edit-notes" onClick={() => { setNotesDraft(selected.notes || ''); setEditingSideNotes(true) }}><PencilLine size={13}/>写下批注</button></>}
              <div className="reader-saved-bookmarks"><span>已存书签 · {bookmarks.length}</span>{bookmarks.length ? bookmarks.map((bookmark) => <button key={bookmark.id} onClick={() => changePage(bookmark.pageIndex)}><Bookmark size={12}/>{bookmark.label}</button>) : <p>翻到需要复习的页，再标记书签。</p>}</div>
            </aside>
            <aside className="reader-side reader-side-right"><span className="reader-side-kicker">PAGE INDEX · 页码索引</span><h4>翻到哪一页</h4><div className="reader-page-index">{Array.from({ length: selected.pageCount }, (_, index) => <button key={index} className={onScreenPageIndices.includes(index) ? 'active' : ''} onClick={() => changePage(index)} aria-label={`跳转到第 ${index + 1} 页`}>{String(index + 1).padStart(2, '0')}{bookmarks.some((bookmark) => bookmark.pageIndex === index) && <Bookmark size={11} fill="currentColor"/>}</button>)}</div><button className="reader-add-bookmark" onClick={addBookmark}><Bookmark size={14}/>标记当前页</button><p>← → 或 Page Up / Page Down 翻页</p></aside>
            {libraryState.settings.viewer.mode === 'continuous' ? pageUrls.map((url, index) => <div className="paper" key={url} style={{ width: stageSize.middle ? paperWidth(index, false) : undefined }}><PaperClip/><img src={url} alt={`${selected.title} 第 ${index + 1} 页`} onLoad={(event) => {
              const image = event.currentTarget
              setPageDimensions((current) => current[index]?.width === image.naturalWidth && current[index]?.height === image.naturalHeight ? current : { ...current, [index]: { width: image.naturalWidth, height: image.naturalHeight } })
            }}/></div>) : <div className="stage-lane"><div className="lane-clip">{bookMode ? <div className="book-spread" style={{ '--book-page-width': `${bookWidth}px`, '--book-page-height': `${bookHeight}px` } as React.CSSProperties}>
              <div className="book-slot book-left">{bookSheet(visibleBookPages[0])}</div>
              <div className="book-slot book-right">{bookSheet(visibleBookPages[1])}</div>
              {bookTransition && <div key={pageTurn.id} className={`book-leaf ${pageTurn.direction}`} aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) setPageTurn((current) => current?.id === pageTurn.id ? null : current) }}>
                <div className="book-face book-front">{bookSheet(pageTurn.direction === 'forward' ? fromBookPages[1] : fromBookPages[0])}</div>
                <div className="book-face book-back">{bookSheet(pageTurn.direction === 'forward' ? toBookPages[0] : toBookPages[1])}</div>
              </div>}
              <PaperClip/>
            </div> : <div className="page-spread">
              {[pageTurn?.direction === 'backward' ? pageTurn.from : page, ...((libraryState.settings.viewer.mode === 'double' && (pageTurn?.direction === 'backward' ? pageTurn.from : page) + 1 < selected.pageCount) ? [(pageTurn?.direction === 'backward' ? pageTurn.from : page) + 1] : [])].map((pageIndex, position) => {
                const double = libraryState.settings.viewer.mode === 'double'
                const width = paperWidth(pageIndex, double)
                return <div className={`paper${double && position > 0 ? ' spread-join' : ''}`} key={pageIndex} style={{ width: stageSize.middle ? width : undefined }}>
                  {selected.assetKind === 'pdf' ? pageUrls[pageIndex] && <embed src={`${pageUrls[pageIndex]}#view=Fit`} type="application/pdf"/> : pageUrls[pageIndex] && <img src={pageUrls[pageIndex]} alt={`${selected.title} 第 ${pageIndex + 1} 页`} onLoad={(event) => {
                    const image = event.currentTarget
                    setPageDimensions((current) => current[pageIndex]?.width === image.naturalWidth && current[pageIndex]?.height === image.naturalHeight ? current : { ...current, [pageIndex]: { width: image.naturalWidth, height: image.naturalHeight } })
                  }}/>}
                </div>
              })}
              {pageTurn && <div key={pageTurn.id} className={`turn-leaf ${pageTurn.direction}`} aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) setPageTurn((current) => current?.id === pageTurn.id ? null : current) }}>
                {[pageTurn.direction === 'forward' ? pageTurn.from : pageTurn.to, ...((libraryState.settings.viewer.mode === 'double' && (pageTurn.direction === 'forward' ? pageTurn.from : pageTurn.to) + 1 < selected.pageCount) ? [(pageTurn.direction === 'forward' ? pageTurn.from : pageTurn.to) + 1] : [])].map((pageIndex) => {
                  const double = libraryState.settings.viewer.mode === 'double'
                  const width = paperWidth(pageIndex, double)
                  return <div className="paper" key={pageIndex} style={{ width: stageSize.middle ? width : undefined }}>
                    {selected.assetKind === 'pdf' ? pageUrls[pageIndex] && <embed src={`${pageUrls[pageIndex]}#view=Fit`} type="application/pdf"/> : pageUrls[pageIndex] && <img src={pageUrls[pageIndex]} alt=""/>}
                  </div>
                })}
              </div>}
              <PaperClip/>
            </div>}</div>{turnHotzones}</div>}
          </div>
           <div className="viewer-toolbar"><button aria-label="上一页" onClick={() => changePage(bookMode ? bookStep(page, -1, pageCount) : page - 1)} disabled={bookMode ? !hasBookStep(page, -1, pageCount) : page === 0}><ChevronLeft/></button><span className="reader-counter"><strong>{counterLabel}</strong><i> / {selected.pageCount}</i></span><button aria-label="下一页" onClick={() => changePage(bookMode ? bookStep(page, 1, pageCount) : page + 1)} disabled={bookMode ? !hasBookStep(page, 1, pageCount) : page === selected.pageCount - 1}><ChevronRight/></button><button className={bookmarks.some((bookmark) => bookmark.pageIndex === page) ? 'bookmarked' : ''} onClick={addBookmark} title="为当前页添加书签"><Bookmark fill={bookmarks.some((bookmark) => bookmark.pageIndex === page) ? 'currentColor' : 'none'}/></button><button className="panels-toggle" aria-label={readerPanels ? '收起侧栏面板' : '展开侧栏面板'} title={readerPanels ? '收起侧栏面板' : '展开侧栏面板（批注、页码索引）'} onClick={() => setReaderPanels((value) => !value)}>{readerPanels ? <PanelLeftClose/> : <PanelLeftOpen/>}</button><div className="toolbar-spacer"/><div className="layout-switch" role="group" aria-label="阅读版式"><button className={libraryState.settings.viewer.mode === 'page' ? 'active' : ''} onClick={() => changeViewerMode('page')}>单页</button><button className={libraryState.settings.viewer.mode === 'single' ? 'active' : ''} onClick={() => changeViewerMode('single')}>双页</button></div><div className="fit-switch" role="group" aria-label="谱面适配"><button className={readerFit === 'page' ? 'active' : ''} onClick={() => { setReaderFit('page'); setZoom(100) }}>整页</button><button className={readerFit === 'width' ? 'active' : ''} onClick={() => { setReaderFit('width'); setZoom(100) }}>适合宽度</button></div><button aria-label="缩小谱面" onClick={() => setZoom(Math.max(50, zoom - 10))}><ZoomOut/></button><span className="zoom-value">{zoom}%</span><button aria-label="放大谱面" onClick={() => setZoom(Math.min(180, zoom + 10))}><ZoomIn/></button><button className="toolbar-performance" onClick={enterPerformance}><Maximize2/>进入演奏模式</button></div>
        </section>
        <footer className="performance-entry"><button className="play-button" onClick={enterPerformance}><Play fill="currentColor"/></button><div><strong>演奏模式</strong><span>全屏阅读 · 键盘与脚踏板翻页 · 自动翻页</span></div><button className="enter-performance" onClick={enterPerformance}>进入演奏模式 <ChevronRight/></button></footer>
      </>}
    </main>}
    {importing && (
      <ImportDialog onClose={() => setImporting(false)} onImported={(score) => { setImporting(false); load().then(() => { setSelectedId(score.id); setView('library'); notify('曲谱已入库，封面已准备好') }) }}/>
    )}
    {settingsOpen && (
      <SettingsDialog state={libraryState} onSave={saveLibraryState} onClose={() => setSettingsOpen(false)}/>
    )}
    {setlistsOpen && (
      <SetlistsDialog state={libraryState} scores={scores} onSave={saveLibraryState} onClose={() => setSetlistsOpen(false)}/>
    )}
    {notice && <div className="notice-toast" role="status" aria-live="polite"><span aria-hidden="true">♪</span>{notice}</div>}
  </div>
}
