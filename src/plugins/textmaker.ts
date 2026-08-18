import sharp from 'sharp'
import { MediaAiService } from '../core/media-ai.js'
import type { BotCommand } from '../types.js'

interface TextStyle {
  label: string
  background: [string, string, string]
  foreground: string
  accent: string
  accent2: string
  shadow: string
  pattern: 'grid' | 'stars' | 'stripes' | 'dots' | 'none'
}

const STYLES: Record<string, TextStyle> = {
  '3d': { label: '3D', background: ['#0A1020', '#182545', '#070A12'], foreground: '#FFF7E8', accent: '#FFB347', accent2: '#FF6B35', shadow: '#000000', pattern: 'grid' },
  ange: { label: 'ANGE', background: ['#EAF8FF', '#BFDFFF', '#FDFEFF'], foreground: '#FFFFFF', accent: '#78B7E8', accent2: '#F8D778', shadow: '#547A9B', pattern: 'stars' },
  vengeur: { label: 'VENGEUR', background: ['#070B12', '#243B55', '#090B10'], foreground: '#F8FAFC', accent: '#E52B3D', accent2: '#5CC8FF', shadow: '#000000', pattern: 'stripes' },
  bulle: { label: 'BULLE', background: ['#061D3A', '#0575E6', '#021B79'], foreground: '#F2FBFF', accent: '#64E9FF', accent2: '#B6FFFA', shadow: '#001024', pattern: 'dots' },
  rose: { label: 'ROSE', background: ['#120510', '#48143A', '#16040F'], foreground: '#FFF2FA', accent: '#FF4FB3', accent2: '#FFB7DE', shadow: '#000000', pattern: 'stars' },
  chat: { label: 'CHAT', background: ['#1C1624', '#5B425F', '#211827'], foreground: '#FFF6E8', accent: '#FFBE72', accent2: '#FCE2C0', shadow: '#120C15', pattern: 'dots' },
  parasite: { label: 'PARASITE', background: ['#030303', '#151515', '#050505'], foreground: '#F8F8F8', accent: '#00F5D4', accent2: '#FF0054', shadow: '#000000', pattern: 'grid' },
  paillettes: { label: 'PAILLETTES', background: ['#25103E', '#6A1B9A', '#180B2B'], foreground: '#FFF7D6', accent: '#FFD166', accent2: '#FF70D6', shadow: '#190725', pattern: 'stars' },
  graffiti: { label: 'GRAFFITI', background: ['#171D1B', '#34443D', '#101412'], foreground: '#FFF7D6', accent: '#FF9F1C', accent2: '#2EC4B6', shadow: '#050505', pattern: 'stripes' },
  pirate: { label: 'PIRATE', background: ['#010601', '#061A08', '#010601'], foreground: '#C9FFC9', accent: '#00FF41', accent2: '#7DFF97', shadow: '#001003', pattern: 'grid' },
  lumiere: { label: 'LUMIERE', background: ['#0D0D0D', '#272727', '#101010'], foreground: '#FFFFFF', accent: '#FFF275', accent2: '#FFB703', shadow: '#000000', pattern: 'dots' },
  superheros: { label: 'SUPER-HEROS', background: ['#320606', '#9D111C', '#130306'], foreground: '#FFFFFF', accent: '#FF2D37', accent2: '#FFD166', shadow: '#170000', pattern: 'stripes' },
  neon: { label: 'NEON', background: ['#05040C', '#17102E', '#05040B'], foreground: '#F5FFFF', accent: '#00F5FF', accent2: '#FF00E5', shadow: '#000000', pattern: 'grid' },
  sciencefiction: { label: 'SCIENCE-FICTION', background: ['#03141D', '#0A3B55', '#020A10'], foreground: '#DFF8FF', accent: '#58D3F7', accent2: '#8DFFDB', shadow: '#00121B', pattern: 'grid' },
  enseigne: { label: 'ENSEIGNE', background: ['#352316', '#805B38', '#2A1A0F'], foreground: '#FFF1CF', accent: '#E8B86D', accent2: '#F9DCA7', shadow: '#25160D', pattern: 'stripes' },
  tatouage: { label: 'TATOUAGE', background: ['#111111', '#292929', '#0A0A0A'], foreground: '#EFE4CF', accent: '#B38B59', accent2: '#E4D0AD', shadow: '#000000', pattern: 'none' },
  aquarelle: { label: 'AQUARELLE', background: ['#F7FBF8', '#DDEFFD', '#FFF6FA'], foreground: '#33344A', accent: '#FF8FB8', accent2: '#76B8E8', shadow: '#FFFFFF', pattern: 'none' },
}

const PREMIUM_BACKGROUNDS: Record<string, string> = {
  '3d': 'luxury cinematic 3D studio, metallic gold and orange light, deep navy shadows, premium advertising poster',
  ange: 'celestial clouds, soft blue heaven light, elegant golden halo glow, ethereal premium fantasy poster',
  vengeur: 'epic superhero energy, red and blue cinematic lighting, dramatic sparks, blockbuster poster atmosphere',
  bulle: 'glossy liquid bubbles, electric blue glass, iridescent reflections, futuristic premium advertising background',
  rose: 'luxury pink neon, glossy silk and crystal highlights, elegant fashion campaign background',
  chat: 'stylish feline silhouette atmosphere, warm amber studio light, premium playful poster background',
  parasite: 'cyberpunk glitch, black technology panels, cyan and magenta digital distortion, hacker aesthetic',
  paillettes: 'luxury glitter particles, violet velvet, gold dust, glamorous celebration background',
  graffiti: 'urban graffiti wall, spray paint bursts, street art texture, bold premium hip-hop poster background',
  pirate: 'dark green terminal glow, cyber security command center, matrix-like atmosphere, premium hacker poster',
  lumiere: 'cinematic light beams, warm gold illumination, dark luxury studio, elegant glowing atmosphere',
  superheros: 'heroic comic blockbuster background, red energy, gold sparks, dramatic cinematic depth',
  neon: 'premium neon city light, cyan and magenta glow, glossy black reflections, futuristic nightclub poster',
  sciencefiction: 'futuristic holographic interface, blue energy rings, deep space technology, cinematic sci-fi poster',
  enseigne: 'luxury vintage illuminated sign, warm bulbs, dark wood and brass, premium storefront aesthetic',
  tatouage: 'black ink ornamental tattoo studio, engraved texture, dramatic monochrome lighting, premium emblem background',
  aquarelle: 'high-end watercolor wash, pastel pigments, elegant paper texture, artistic fashion editorial background',
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function splitText(value: string, maxChars = 17): string[] {
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
    return `<g opacity="0.10" stroke="${accent}" stroke-width="2">${Array.from({ length: 18 }, (_, i) => `<path d="M0 ${i * 75}H1280M${i * 75} 0V1280"/>`).join('')}</g>`
  }
  if (pattern === 'stars') {
    return `<g fill="${accent}" opacity="0.34">${Array.from({ length: 70 }, (_, i) => `<circle cx="${30 + ((i * 193) % 1220)}" cy="${25 + ((i * 347) % 1230)}" r="${2 + (i % 6)}"/>`).join('')}</g>`
  }
  if (pattern === 'stripes') {
    return `<g opacity="0.10" stroke="${accent}" stroke-width="26">${Array.from({ length: 18 }, (_, i) => `<path d="M${-400 + i * 120} 1280L${220 + i * 120} 0"/>`).join('')}</g>`
  }
  if (pattern === 'dots') {
    return `<g fill="${accent}" opacity="0.14">${Array.from({ length: 100 }, (_, i) => `<circle cx="${20 + ((i * 137) % 1240)}" cy="${20 + ((i * 223) % 1240)}" r="${4 + (i % 9)}"/>`).join('')}</g>`
  }
  return ''
}

function decorationSvg(name: string, style: TextStyle): string {
  const a = style.accent
  const b = style.accent2
  if (name === 'ange') {
    return `<g fill="none" stroke="${a}" opacity="0.62" stroke-width="18"><ellipse cx="640" cy="340" rx="170" ry="42"/><path d="M430 510C260 420 125 470 90 650c140-80 245-45 330 70M850 510c170-90 305-40 340 140-140-80-245-45-330 70"/></g>`
  }
  if (name === 'bulle') {
    return `<g fill="none" stroke="${b}" opacity="0.48">${Array.from({ length: 16 }, (_, i) => `<circle cx="${90 + ((i * 211) % 1100)}" cy="${100 + ((i * 163) % 1050)}" r="${24 + (i % 5) * 18}" stroke-width="${4 + (i % 3) * 2}"/>`).join('')}</g>`
  }
  if (name === 'chat') {
    return `<g fill="${a}" opacity="0.20"><path d="M440 420L500 255l85 145zM695 400l85-145 60 165z"/></g><g stroke="${b}" opacity="0.55" stroke-width="8"><path d="M405 690L170 640M405 725L150 725M875 690l235-50M875 725l255 0"/></g>`
  }
  if (name === 'parasite') {
    return `<g opacity="0.50"><rect x="70" y="410" width="1140" height="10" fill="${a}"/><rect x="35" y="615" width="1210" height="8" fill="${b}"/><rect x="150" y="845" width="980" height="12" fill="${a}"/></g>`
  }
  if (name === 'graffiti') {
    return `<g fill="${a}" opacity="0.28"><circle cx="130" cy="970" r="80"/><circle cx="1120" cy="270" r="95"/><path d="M160 980c120-120 210-50 300-140 80-80 160-65 255-10" fill="none" stroke="${b}" stroke-width="35" stroke-linecap="round"/></g>`
  }
  if (name === 'pirate') {
    return `<g fill="${a}" opacity="0.10">${Array.from({ length: 22 }, (_, i) => `<rect x="0" y="${i * 58}" width="1280" height="2"/>`).join('')}</g><text x="90" y="150" font-family="DejaVu Sans Mono, monospace" font-size="34" fill="${a}" opacity="0.72">&gt; BESTLA_SYSTEM_READY</text>`
  }
  if (name === 'sciencefiction') {
    return `<g fill="none" stroke="${a}" opacity="0.35"><circle cx="640" cy="630" r="420" stroke-width="3" stroke-dasharray="28 18"/><circle cx="640" cy="630" r="360" stroke="${b}" stroke-width="2" stroke-dasharray="9 18"/><path d="M120 230H370M910 230h250M120 1040h250M910 1040h250" stroke-width="8"/></g>`
  }
  if (name === 'enseigne') {
    return `<g><rect x="95" y="300" width="1090" height="650" rx="38" fill="#000000" opacity="0.20" stroke="${a}" stroke-width="12"/><circle cx="140" cy="345" r="13" fill="${b}"/><circle cx="1140" cy="345" r="13" fill="${b}"/><circle cx="140" cy="905" r="13" fill="${b}"/><circle cx="1140" cy="905" r="13" fill="${b}"/></g>`
  }
  if (name === 'tatouage') {
    return `<g fill="none" stroke="${a}" opacity="0.55" stroke-width="5"><path d="M180 640c85-190 210-250 360-150-90-40-110-170-25-250M1100 640c-85-190-210-250-360-150 90-40 110-170 25-250"/><path d="M250 875c120 85 220 80 310-10M1030 875c-120 85-220 80-310-10"/></g>`
  }
  if (name === 'aquarelle') {
    return `<g opacity="0.38"><ellipse cx="330" cy="430" rx="310" ry="220" fill="${a}"/><ellipse cx="865" cy="520" rx="350" ry="260" fill="${b}"/><ellipse cx="610" cy="870" rx="420" ry="180" fill="#FFD6A5"/></g>`
  }
  if (name === 'superheros' || name === 'vengeur') {
    return `<g transform="translate(640 625)" opacity="0.28"><path d="M0-430L320-250 250 180 0 420-250 180-320-250z" fill="none" stroke="${a}" stroke-width="25"/><path d="M0-330L220-205 170 120 0 300-170 120-220-205z" fill="none" stroke="${b}" stroke-width="8"/></g>`
  }
  return ''
}

function textLayers(name: string, style: TextStyle, lines: string[], fontSize: number, lineGap: number, startY: number): string {
  return lines.map((line, index) => {
    const y = Math.round(startY + index * lineGap)
    const escaped = escapeXml(line)
    const common = `x="640" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="4"`
    if (name === '3d') {
      const extrusion = Array.from({ length: 13 }, (_, depth) => `<text ${common} transform="translate(${depth * 5} ${depth * 5})" fill="${depth % 2 ? style.accent2 : style.accent}" opacity="${0.34 + depth * 0.025}">${escaped}</text>`).join('')
      return `${extrusion}<text ${common} fill="${style.foreground}" stroke="${style.accent}" stroke-width="3" paint-order="stroke fill">${escaped}</text>`
    }
    if (name === 'parasite') {
      return `<text ${common} transform="translate(-10 0)" fill="${style.accent2}" opacity="0.8">${escaped}</text><text ${common} transform="translate(10 0)" fill="${style.accent}" opacity="0.8">${escaped}</text><text ${common} fill="${style.foreground}">${escaped}</text>`
    }
    if (name === 'neon' || name === 'lumiere') {
      return `<text ${common} fill="none" stroke="${style.accent2}" stroke-width="20" opacity="0.17" filter="url(#blurGlow)">${escaped}</text><text ${common} fill="${style.foreground}" stroke="${style.accent}" stroke-width="7" paint-order="stroke fill" filter="url(#softGlow)">${escaped}</text>`
    }
    if (name === 'graffiti') {
      return `<text ${common} transform="skewX(-7)" fill="${style.foreground}" stroke="#101010" stroke-width="18" paint-order="stroke fill">${escaped}</text><text ${common} transform="skewX(-7)" fill="${style.foreground}" stroke="${style.accent}" stroke-width="7" paint-order="stroke fill">${escaped}</text>`
    }
    if (name === 'tatouage') {
      return `<text ${common} font-family="DejaVu Serif, serif" fill="${style.foreground}" stroke="${style.accent}" stroke-width="2" paint-order="stroke fill">${escaped}</text>`
    }
    return `<text ${common} fill="${style.foreground}" stroke="${style.accent}" stroke-width="5" paint-order="stroke fill" filter="url(#shadow)">${escaped}</text>`
  }).join('')
}

function textSvg(styleName: string, rawText: string): Buffer {
  const style = STYLES[styleName] ?? STYLES.neon!
  const text = rawText.trim().slice(0, 160)
  const lines = splitText(text || 'BESTLA')
  const longest = Math.max(...lines.map((line) => line.length), 5)
  const fontSize = Math.max(82, Math.min(178, Math.floor(980 / longest)))
  const lineGap = Math.round(fontSize * 1.18)
  const startY = 625 - ((lines.length - 1) * lineGap) / 2
  const renderedText = textLayers(styleName, style, lines, fontSize, lineGap, startY)

  return Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280" viewBox="0 0 1280 1280">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${style.background[0]}"/><stop offset="0.52" stop-color="${style.background[1]}"/><stop offset="1" stop-color="${style.background[2]}"/></linearGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="${style.accent}" stop-opacity="0.32"/><stop offset="1" stop-color="${style.accent}" stop-opacity="0"/></radialGradient>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="10" dy="15" stdDeviation="11" flood-color="${style.shadow}" flood-opacity="0.82"/></filter>
      <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="blurGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="1280" height="1280" rx="58" fill="url(#bg)"/>
    <circle cx="640" cy="620" r="520" fill="url(#glow)"/>
    ${patternSvg(style.pattern, style.accent)}
    ${decorationSvg(styleName, style)}
    <rect x="55" y="55" width="1170" height="1170" rx="48" fill="none" stroke="${style.accent}" stroke-opacity="0.60" stroke-width="5"/>
    <rect x="75" y="75" width="1130" height="1130" rx="40" fill="none" stroke="${style.accent2}" stroke-opacity="0.25" stroke-width="2"/>
    ${renderedText}
    <text x="640" y="1165" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="800" fill="${style.accent}" letter-spacing="6">${style.label} • BESTLA iA</text>
  </svg>`)
}

function textOverlaySvg(styleName: string, rawText: string): Buffer {
  const style = STYLES[styleName] ?? STYLES.neon!
  const text = rawText.trim().slice(0, 160)
  const lines = splitText(text || 'BESTLA')
  const longest = Math.max(...lines.map((line) => line.length), 5)
  const fontSize = Math.max(88, Math.min(190, Math.floor(1_030 / longest)))
  const lineGap = Math.round(fontSize * 1.15)
  const startY = 625 - ((lines.length - 1) * lineGap) / 2
  const renderedText = textLayers(styleName, style, lines, fontSize, lineGap, startY)

  return Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280" viewBox="0 0 1280 1280">
    <defs>
      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="12" dy="18" stdDeviation="14" flood-color="${style.shadow}" flood-opacity="0.95"/></filter>
      <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="blurGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="24"/></filter>
    </defs>
    <rect x="42" y="42" width="1196" height="1196" rx="64" fill="#000000" opacity="0.08" stroke="${style.accent}" stroke-opacity="0.72" stroke-width="5"/>
    <rect x="68" y="68" width="1144" height="1144" rx="52" fill="none" stroke="${style.accent2}" stroke-opacity="0.42" stroke-width="2"/>
    ${decorationSvg(styleName, style)}
    ${renderedText}
    <text x="640" y="1170" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="27" font-weight="800" fill="${style.accent}" letter-spacing="5">${style.label} • BESTLA iA</text>
  </svg>`)
}

function premiumBackgroundPrompt(styleName: string): string {
  const mood = PREMIUM_BACKGROUNDS[styleName] ?? PREMIUM_BACKGROUNDS.neon!
  return [
    'Square 1:1 premium graphic-design background for a typography poster.',
    mood,
    'Ultra detailed, professional art direction, strong depth, clean composition, high contrast, 4K look.',
    'Keep the central area visually readable for a large title overlay.',
    'Absolutely no text, no letters, no words, no logo, no watermark.',
  ].join(' ')
}

async function renderPremiumTextMaker(ctx: Parameters<BotCommand['execute']>[0], styleName: string, text: string): Promise<Buffer> {
  const service = new MediaAiService(ctx.config)
  if (service.isConfigured()) {
    try {
      const generated = await service.generateImage(premiumBackgroundPrompt(styleName))
      const darkener = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280"><rect width="1280" height="1280" fill="#000" opacity="0.20"/></svg>')
      return await sharp(generated.buffer)
        .resize(1280, 1280, { fit: 'cover' })
        .composite([{ input: darkener }, { input: textOverlaySvg(styleName, text) }])
        .png({ compressionLevel: 9 })
        .toBuffer()
    } catch {
      // Le fournisseur IA peut être temporairement limité. Le rendu local reste
      // disponible afin de ne jamais casser les commandes TextMaker.
    }
  }
  return sharp(textSvg(styleName, text)).png({ compressionLevel: 9 }).toBuffer()
}

function makeCommand(name: string): BotCommand {
  const label = STYLES[name]?.label ?? name.toUpperCase()
  return {
    name,
    description: `Crée une affiche texte premium avec l’effet ${label}, un fond généré par IA et un texte net superposé.`,
    usage: '<texte>',
    category: 'Créateur de texte',
    cooldownSeconds: 6,
    async execute(ctx) {
      const text = ctx.argText.trim()
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}${name} Ton texte`))
      const image = await renderPremiumTextMaker(ctx, name, text)
      await ctx.send({ image })
    },
  }
}

export const textMakerCommands: BotCommand[] = [
  '3d', 'ange', 'vengeur', 'bulle', 'rose', 'chat', 'parasite', 'paillettes', 'graffiti',
  'pirate', 'lumiere', 'superheros', 'neon', 'sciencefiction', 'enseigne', 'tatouage', 'aquarelle',
].map(makeCommand)
