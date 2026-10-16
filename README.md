# Arpeggio · 吉他曲谱档案馆

A Windows guitar-score archive, reader and performance workspace.

把图片或 PDF 曲谱整理成可检索、可阅读、可演奏的本地档案。

**技术栈 / Stack:** Electron · React · TypeScript · SQLite / sql.js · Vitest

<img src="build/icon.png" width="88" alt="Application icon">

## 能做什么

- 按木吉他与电吉他归档，支持标签、收藏、哈希去重与 JSON sidecar。
- 阅读位置恢复、单页和双页阅读、全屏演奏与定时翻页。
- Electron 主进程管理文件和数据库，窄 IPC 与受限资源协议连接阅读界面。

## 安装与运行

Windows 与 Node.js 24+。

```powershell
npm ci
npm run dev
```

公开版从空曲库启动，请导入自己有权使用的图片或 PDF。原私有版本随附的谱面、歌曲封面、档案数据库及元数据未公开。曲谱保存在用户应用数据目录；封面匹配可能向 MusicBrainz / Apple 查询曲名与歌手，离线展示可设置 `ARPEGGIO_DISABLE_COVER_LOOKUP=1`。

```powershell
npm run dist
```

打包产物位于 `release/`，不在 Git 仓库中。网页字体 LXGW WenKai 的许可证位于字体目录 `OFL.txt`。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

依赖原私有种子曲库的端到端场景未作为公开版验收承诺。

命令结果与验收范围见 [VALIDATION.md](VALIDATION.md)。这些检查不能替代目标机器上的原生桌面验收。

## 发布范围

[公开源码说明](PUBLICATION.md) · [全部作品](https://github.com/YUANYZ-cell)
