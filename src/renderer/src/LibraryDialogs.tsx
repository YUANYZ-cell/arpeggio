import { useState } from 'react'
import { Check, DatabaseBackup, GripVertical, Plus, X } from 'lucide-react'
import type { LibraryState, Setlist } from '../../shared/library-state'
import type { ScoreRecord } from '../../shared/score-domain'

export function SettingsDialog({ state, onSave, onClose }: { state: LibraryState; onSave: (state: LibraryState) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(state)
  const [tab, setTab] = useState<'appearance' | 'viewer' | 'performance' | 'controls' | 'backup'>('appearance')
  const [backupMessage, setBackupMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => { setSaving(true); await onSave(draft); setSaving(false); onClose() }
  const backup = async () => {
    setBackupMessage('')
    const result = await window.arpeggio.createBackup()
    if (!result.canceled) setBackupMessage(`备份已保存：${result.path}`)
  }
  return <div className="modal-backdrop"><section className="settings-dialog">
    <header><div><span>ARPEGGIO PREFERENCES</span><h2>设置</h2></div><button className="icon-button" onClick={onClose}><X/></button></header>
    <div className="settings-body"><nav>
      {([['appearance', '外观'], ['viewer', '曲谱阅读器'], ['performance', '演奏模式'], ['controls', '快捷键与脚踏板'], ['backup', '曲谱库与备份']] as const).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </nav><div className="settings-content">
      {tab === 'appearance' && <><h3>外观</h3><p>Archive Light 是当前经过视觉验收的主主题。</p><div className="theme-options"><button className="selected"><span className="light-swatch"/><b>Archive Light</b><Check/></button><button disabled><span className="dark-swatch"/><b>Archive Dark</b><small>后续版本</small></button></div></>}
        {tab === 'viewer' && <><h3>曲谱阅读器</h3><label className="setting-row"><span><b>默认阅读方式</b><small>打开曲谱时使用的页面布局</small></span><select value={draft.settings.viewer.mode} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, viewer: { ...draft.settings.viewer, mode: e.target.value as 'page' | 'single' | 'double' | 'continuous' } } })}><option value="page">单页阅读</option><option value="single">双页翻书</option><option value="double">并排双页</option><option value="continuous">连续滚动</option></select></label><label className="setting-row"><span><b>默认适配</b><small>优先保证谱面清晰可读</small></span><select value={draft.settings.viewer.fit} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, viewer: { ...draft.settings.viewer, fit: e.target.value as 'width' | 'height' | 'page' } } })}><option value="width">适合宽度</option><option value="height">适合高度</option><option value="page">整页</option></select></label></>}
      {tab === 'performance' && <><h3>演奏模式</h3><label className="setting-row"><span><b>默认自动翻页间隔</b><small>固定时间模式的初始值</small></span><select value={draft.settings.performance.defaultIntervalSeconds} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, performance: { ...draft.settings.performance, defaultIntervalSeconds: Number(e.target.value) } } })}>{[5, 10, 20, 30, 60].map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label><label className="setting-row"><span><b>翻页前预警</b><small>在不遮挡谱面的区域显示倒计时</small></span><select value={draft.settings.performance.warningSeconds} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, performance: { ...draft.settings.performance, warningSeconds: Number(e.target.value) as 0 | 1 | 2 | 3 | 5 } } })}>{[0, 1, 2, 3, 5].map((value) => <option key={value} value={value}>{value === 0 ? '关闭' : `${value} 秒`}</option>)}</select></label><label className="setting-row"><span><b>轻微翻页动画</b><small>尊重系统减少动态效果设置</small></span><input type="checkbox" checked={draft.settings.performance.animation} onChange={(e) => setDraft({ ...draft, settings: { ...draft.settings, performance: { ...draft.settings.performance, animation: e.target.checked } } })}/></label></>}
      {tab === 'controls' && <><h3>快捷键与脚踏板</h3><p>任何能模拟键盘按键的 USB / 蓝牙脚踏板都可直接使用。</p><div className="shortcut-list"><span>下一页 <kbd>→ / Space / PageDown</kbd></span><span>上一页 <kbd>← / PageUp</kbd></span><span>自动翻页开始 / 暂停 <kbd>Enter</kbd></span><span>全屏演奏 <kbd>F11</kbd></span><span>退出演奏模式 <kbd>Esc</kbd></span></div></>}
      {tab === 'backup' && <><h3>曲谱库与备份</h3><p>备份包含原始曲谱、SQLite、metadata、收藏、曲单、书签、翻页方案和设置。</p><button className="backup-button" onClick={backup}><DatabaseBackup/>导出完整 Guitar Archive Backup</button>{backupMessage && <p className="backup-success">{backupMessage}</p>}<p className="warning-copy">恢复操作会覆盖当前档案库，因此首版要求先退出应用并按 README 的离线恢复步骤操作。</p></>}
    </div></div>
    <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={save} disabled={saving}>{saving ? '正在保存…' : '保存设置'}</button></footer>
  </section></div>
}

export function SetlistsDialog({ state, scores, onSave, onClose }: { state: LibraryState; scores: ScoreRecord[]; onSave: (state: LibraryState) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(state)
  const [selectedId, setSelectedId] = useState(state.setlists[0]?.id ?? '')
  const [name, setName] = useState('')
  const selected = draft.setlists.find((setlist) => setlist.id === selectedId)
  const create = () => {
    const trimmed = name.trim(); if (!trimmed) return
    const setlist: Setlist = { id: crypto.randomUUID(), name: trimmed, scoreIds: [], createdAt: new Date().toISOString() }
    setDraft({ ...draft, setlists: [...draft.setlists, setlist] }); setSelectedId(setlist.id); setName('')
  }
  const toggleScore = (scoreId: string) => {
    if (!selected) return
    const nextIds = selected.scoreIds.includes(scoreId) ? selected.scoreIds.filter((id) => id !== scoreId) : [...selected.scoreIds, scoreId]
    setDraft({ ...draft, setlists: draft.setlists.map((setlist) => setlist.id === selected.id ? { ...setlist, scoreIds: nextIds } : setlist) })
  }
  return <div className="modal-backdrop"><section className="setlists-dialog">
    <header><div><span>PERFORMANCE COLLECTIONS</span><h2>演出曲单</h2></div><button className="icon-button" onClick={onClose}><X/></button></header>
    <div className="setlists-body"><aside><div className="new-setlist"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="新曲单名称" onKeyDown={(e) => { if (e.key === 'Enter') create() }}/><button onClick={create}><Plus/></button></div>{draft.setlists.length === 0 && <p>还没有曲单</p>}{draft.setlists.map((setlist) => <button key={setlist.id} className={selectedId === setlist.id ? 'active' : ''} onClick={() => setSelectedId(setlist.id)}><ListHandle/ ><span>{setlist.name}</span><em>{setlist.scoreIds.length} 首</em></button>)}</aside><main>{selected ? <><h3>{selected.name}</h3><p>勾选曲目加入曲单。木吉他与电吉他可混合编排。</p><div className="setlist-scores">{scores.map((score) => <label key={score.id}><input type="checkbox" checked={selected.scoreIds.includes(score.id)} onChange={() => toggleScore(score.id)}/><div><b>{score.title}</b><span>{score.artist} · {score.guitarType === 'acoustic' ? '木吉他' : '电吉他'} · {score.archiveNumber}</span></div></label>)}</div></> : <div className="setlist-empty"><ListHandle/><b>创建第一份演出曲单</b><span>适合排练或现场演出的顺序编排</span></div>}</main></div>
    <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={async () => { await onSave(draft); onClose() }}>保存曲单</button></footer>
  </section></div>
}

function ListHandle() { return <GripVertical size={17}/> }
