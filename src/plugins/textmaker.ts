import sharp from 'sharp'
import type { BotCommand } from '../types.js'

interface TextStyle {
  label: string
  background: [string, string]
  foreground: string
  accent: string
  shadow?: string
  stroke?: string
  pattern?: 'grid' | 'stars' | 'stripes' | 'dots'
}

const STYLES: Record<string, TextStyle> = {
  '3d': { label: '3D', background: ['#161A30', '#313866'], foreground: '#F0ECE5', accent: '#F0B86E', shadow: '#000000', stroke: '#B6BBC4', pattern: 'grid' },
  angel: { label: 'ANGEL', background: ['#E8F6FF', '#B8DFF7'], foreground: '#FFFFFF', accent: '#79A7D3', shadow: '#6F8FAF', stroke: '#DDF3FF', pattern: 'stars' },
  avenger: { label: 'AVENGER', background: ['#101820', '#263B50'], foreground: '#F4F4F4', accent: '#D72638', shadow: '#000000', stroke: '#7E8A97', pattern: 'stripes' },
  blub: { label: 'BLUB', background: ['#001F3F', '#0074D9'], foreground: '#EAF6FF', accent: '#7FDBFF', shadow: '#00111F', stroke: '#39CCCC', pattern: 'dots' },
  bpink: { label: 'BPINK', background: ['#12040F', '#40112E'], foreground: '#FFE4F4', accent: '#FF69B4', shadow: '#000000', stroke: '#FFB7DB', pattern: 'stars' },
  cat: { label: 'CAT', background: ['#2D1E2F', '#6B4F4F'], foreground: '#FFF5E6', accent: '#F6BD60', shadow: '#1D1010', stroke: '#F7EDE2', pattern: 'dots' },
  glitch: { label: 'GLITCH', background: ['#090909', '#181818'], foreground: '#F8F8F8', accent: '#00F5D4', shadow: '#FF0054', stroke: '#9B5DE5', pattern: 'grid' },
  glitter: { label: 'GLITTER', background: ['#321450', '#7B2CBF'], foreground: '#FFF4C2', accent: '#FFD166', shadow: '#2B0A3D', stroke: '#F15BB5', pattern: 'stars' },
  graffiti: { label: 'GRAFFITI', background: ['#1F2421', '#3A4A3F'], foreground: '#FFF7D6', accent: '#FF9F1C', shadow: '#111111', stroke: '#2EC4B6', pattern: 'stripes' },
  hacker: { label: 'HACKER', background: ['#020A02', '#061B06'], foreground: '#B7FFB7', accent: '#00FF41', shadow: '#001B05', stroke: '#39FF14', pattern: 'grid' },
  light: { label: 'LIGHT', background: ['#171717', '#303030'], foreground: '#FFFFFF', accent: '#FFF275', shadow: '#000000', stroke: '#FFE66D', pattern: 'dots' },
  marvel: { label: 'MARVEL', background: ['#3B0A0A', '#8B1111'], foreground: '#FFFFFF', accent: '#E62429', shadow: '#170000', stroke: '#FFFFFF', pattern: 'stripes' },
  neon: { label: 'NEON', background: ['#080713', '#15102A'], foreground: '#EFFFFF', accent: '#00F5FF', shadow: '#FF00E5', stroke: '#8A2BE2', pattern: 'grid' },
  sci: { label: 'SCI-FI', background: ['#071923', '#0C3146'], foreground: '#D8F3FF', accent: '#58D3F7', shadow: '#00121B', stroke: '#9CEBFF', pattern: 'grid' },
  sign: { label: 'SIGN', background: ['#442B1A', '#815B3A'], foreground: '#FFF1CF', accent: '#E8B86D', shadow: '#25160D', stroke: '#F4D58D', pattern: 'stripes' },
  tattoo: { label: 'TATTOO', background: ['#171717', '#2B2B2B'], foreground: '#F0E6D2', accent: '#B38B59', shadow: '#000000', stroke: '#D6C6A8', pattern: 'dots' },
  watercolor: { label: 'WATERCOLOR', background: ['#D8F3DC', '#BDE0FE'], foreground: '#3A3A5A', accent: '#FFAFCC', shadow: '#FFFFFF', stroke: '#CDB4DB', pattern: 'stars' },
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function splitText(value: string, maxChars = 18): string[] {
  const words = value.trim().replace(/\s+/g, ' ').split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars || !current) current = candidate
    else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 4)
}

function patternSvg(pattern: TextStyle['pattern'], accent: string): string {
  if (pattern === 'grid') {
    return `<g opacity="0.11" stroke="${accent}" stroke-width="2">${Array.from({ length: 13 }, (_, i) => `<path d="M0 ${i * 90}H1080M${i * 90} 0V1080"/>`).join('')}</g>`
  }
  if (pattern === 'stars') {
    return `<g fill="${accent}" opacity="0.28">${Array.from({ length: 40 }, (_, i) => `<circle cx="${35 + ((i * 193) % 1010)}" cy="${30 + ((i * 347) % 1020)}" r="${2 + (i % 5)}"/>`).join('')}</g>`
  }
  if (pattern === 'stripes') {
    return `<g opacity="0.09" stroke="${accent}" stroke-width="22">${Array.from({ length: 15 }, (_, i) => `<path d="M${-300 + i * 110} 1080L${250 + i * 110} 0"/>`).join('')}</g>`
  }
  return `<g fill="${accent}" opacity="0.12">${Array.from({ length: 70 }, (_, i) => `<circle cx="${20 + ((i * 137) % 1040)}" cy="${20 + ((i * 223) % 1040)}" r="${4 + (i % 8)}"/>`).join('')}</g>`
}

function textSvg(styleName: string, rawText: string): Buffer {
  const style = STYLES[styleName] ?? STYLES.neon!
  const text = rawText.trim().slice(0, 160)
  const lines = splitText(text || 'BESTLA')
  const fontSize = Math.max(76, Math.min(156, Math.floor(760 / Math.max(...lines.map((line) => line.length), 5))))
  const lineGap = Math.round(fontSize * 1.16)
  const startY = 540 - ((lines.length - 1) * lineGap) / 2
  const texts = lines.map((line, index) => {
    const y = Math.round(startY + index * lineGap)
    return `<text x="540" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="3" fill="${style.foreground}" stroke="${style.stroke ?? style.accent}" stroke-width="3" paint-order="stroke fill" filter="url(#shadow)">${escapeXml(line)}</text>`
  }).join('')
  return Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${style.background[0]}"/><stop offset="1" stop-color="${style.background[1]}"/></linearGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="${style.accent}" stop-opacity="0.34"/><stop offset="1" stop-color="${style.accent}" stop-opacity="0"/></radialGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="8" dy="12" stdDeviation="9" flood-color="${style.shadow ?? '#000000'}" flood-opacity="0.8"/></filter>
    </defs>
    <rect width="1080" height="1080" rx="46" fill="url(#bg)"/>
    <circle cx="540" cy="520" r="440" fill="url(#glow)"/>
    ${patternSvg(style.pattern, style.accent)}
    <rect x="55" y="55" width="970" height="970" rx="38" fill="none" stroke="${style.accent}" stroke-opacity="0.65" stroke-width="4"/>
    ${texts}
    <text x="540" y="965" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="700" fill="${style.accent}" letter-spacing="6">${style.label} • BESTLA iA</text>
  </svg>`)
}

function makeCommand(name: string): BotCommand {
  const label = STYLES[name]?.label ?? name.toUpperCase()
  return {
    name,
    description: `Crée une image texte avec l’effet ${label}, sans clé API externe.`,
    usage: '<texte>',
    category: 'Créateur de texte',
    cooldownSeconds: 6,
    async execute(ctx) {
      const text = ctx.argText.trim()
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}${name} Ton texte`))
      const image = await sharp(textSvg(name, text)).png().toBuffer()
      await ctx.send({ image, caption: `Effet *${label}* créé par Bestla iA.` })
    },
  }
}

export const textMakerCommands: BotCommand[] = [
  '3d', 'angel', 'avenger', 'blub', 'bpink', 'cat', 'glitch', 'glitter', 'graffiti',
  'hacker', 'light', 'marvel', 'neon', 'sci', 'sign', 'tattoo', 'watercolor',
].map(makeCommand)
