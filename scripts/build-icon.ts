import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const svg = await readFile('build/icon.svg')
const pngPath = 'build/icon.png'
await sharp(svg).resize(512, 512).png().toFile(pngPath)
await writeFile('build/icon.ico', await pngToIco(pngPath))
console.log('Generated build/icon.png and build/icon.ico')
