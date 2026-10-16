import { resolve } from 'node:path'
import { ArchiveStore } from '../src/main/archive-store'

function values(flag: string): string[] {
  const result: string[] = []
  for (let index = 2; index < process.argv.length; index += 1) if (process.argv[index] === flag && process.argv[index + 1]) result.push(process.argv[index + 1])
  return result
}
function value(flag: string, fallback = ''): string {
  return values(flag).at(-1) ?? fallback
}

const root = resolve(value('--root', 'runtime-data/Guitar Archive'))
const files = values('--file').map((file) => resolve(file))
const title = value('--title')
if (!title || files.length === 0) {
  console.error('用法: npm run importer -- --title "曲名" --artist "艺术家" --guitar acoustic --file "第1页.jpg" --file "第2页.jpg"')
  process.exit(2)
}
const store = await ArchiveStore.open(root)
const result = await store.importScore(files, {
  title,
  artist: value('--artist'),
  guitarType: value('--guitar', 'acoustic') === 'electric' ? 'electric' : 'acoustic',
  scoreType: value('--type', '弹唱谱'),
  originalKey: value('--original-key') || undefined,
  key: value('--key') || undefined,
  capo: value('--capo') ? Number(value('--capo')) : undefined,
  tuning: value('--tuning') || undefined,
  tags: value('--tags').split(/[,，]/).map((item) => item.trim()).filter(Boolean),
  notes: value('--notes')
})
console.log(JSON.stringify(result, null, 2))
