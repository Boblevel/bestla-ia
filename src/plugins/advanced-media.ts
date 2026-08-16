import sharp from 'sharp'
import type { BotCommand, CommandContext } from '../types.js'
import { brandedPanel } from '../utils/brand.js'
import {
  applyAudioEffect,
  compressVideo,
  convertAudioToMp3,
  extractAudioFromVideo,
  MediaProcessError,
  rotateVideo,
  trimAudio,
  trimVideo,
  videoToSticker,
  type AudioEffect,
} from '../utils/ffmpeg.js'
import { downloadMedia, findMedia } from '../utils/message.js'
import { createTextPdf } from '../utils/simple-pdf.js'

type DownloadedMedia = Awaited<ReturnType<typeof downloadMedia>>

async function selectedMedia(ctx: CommandContext, accepted: DownloadedMedia['type'][]): Promise<DownloadedMedia | undefined> {
  const source = ctx.quotedMessage() ?? ctx.message
  const media = findMedia(source)
  if (!media || !accepted.includes(media.type)) {
    await ctx.reply(`Réponds à ${accepted.includes('video') ? 'une vidéo' : 'un média compatible'} avec cette commande, ou envoie-le avec la commande en légende.`)
    return undefined
  }
  return downloadMedia(source, ctx.config.maxMediaBytes)
}

async function sendAudio(ctx: CommandContext, audio: Buffer, caption: string): Promise<void> {
  if (audio.length > ctx.config.maxMediaBytes) throw new MediaProcessError('Le résultat est trop lourd pour la limite média configurée.')
  await ctx.send({ audio, mimetype: 'audio/mpeg', ptt: false, fileName: 'bestla-audio.mp3' })
  await ctx.reply(caption)
}

async function sendVideo(ctx: CommandContext, video: Buffer, caption: string): Promise<void> {
  if (video.length > ctx.config.maxMediaBytes) throw new MediaProcessError('Le résultat est trop lourd. Essaie une vidéo plus courte ou plus légère.')
  await ctx.send({ video, mimetype: 'video/mp4', caption: `${caption}\n\n✦ BY ${ctx.config.signature}` })
}

function parseSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character)
}

function wrapText(value: string, size = 20): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current || current.length + word.length + 1 <= size) current = current ? `${current} ${word}` : word
    else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 6)
}

function textImageSvg(style: string, text: string): Buffer {
  const styles: Record<string, { background: string; accent: string; title: string }> = {
    neon: { background: '#11102b', accent: '#54F7E6', title: '#FFFFFF' },
    or: { background: '#1D1710', accent: '#F6C35C', title: '#FFF8E7' },
    rose: { background: '#381329', accent: '#FF7EB6', title: '#FFFFFF' },
    ciel: { background: '#102A43', accent: '#69D2FF', title: '#F4FBFF' },
    minimal: { background: '#F5F7FA', accent: '#1A73E8', title: '#111827' },
  }
  const palette = styles[style] ?? styles.neon ?? { background: '#11102b', accent: '#54F7E6', title: '#FFFFFF' }
  const lines = wrapText(text)
  const first = lines[0] ?? 'Bestla iA'
  const remaining = lines.slice(1)
  const body = remaining
    .map((line, index) => `<text x="84" y="${500 + index * 82}" font-family="Arial, sans-serif" font-size="54" font-weight="600" fill="${palette.title}">${escapeXml(line)}</text>`)
    .join('')
  return Buffer.from(
    `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.background}"/><stop offset="1" stop-color="#000000" stop-opacity="0.18"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/><circle cx="900" cy="180" r="210" fill="${palette.accent}" fill-opacity="0.16"/><rect x="72" y="72" width="936" height="936" rx="42" fill="none" stroke="${palette.accent}" stroke-width="5"/><rect x="84" y="166" width="150" height="14" rx="7" fill="${palette.accent}"/><text x="84" y="390" font-family="Arial, sans-serif" font-size="${first.length > 18 ? 82 : 104}" font-weight="800" fill="${palette.title}">${escapeXml(first)}</text>${body}<text x="84" y="932" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="3" fill="${palette.accent}">BESTLA iA • RHAFF SERVICE</text></svg>`,
    'utf8',
  )
}

function pipePair(value: string): [string, string] | undefined {
  const separator = value.indexOf('|')
  if (separator === -1) return undefined
  const left = value.slice(0, separator).trim()
  const right = value.slice(separator + 1).trim()
  return left && right ? [left, right] : undefined
}

export const advancedMediaCommands: BotCommand[] = [
  {
    name: 'convertiraudio',
    aliases: ['mp3'],
    description: 'Convertit une note vocale ou un fichier audio en MP3.',
    usage: '(en réponse à un audio)',
    category: 'Audio & Vidéo',
    cooldownSeconds: 10,
    async execute(ctx) {
      const media = await selectedMedia(ctx, ['audio'])
      if (!media) return
      const result = await convertAudioToMp3(media.buffer, media.mimetype)
      await sendAudio(ctx, result, '🎵 Audio converti en MP3.')
    },
  },
  {
    name: 'effetaudio',
    aliases: ['voixaudio'],
    description: 'Applique un effet à un audio : rapide, lent, robot, grave, aigu, bass, nightcore ou nettoyer.',
    usage: 'rapide|lent|robot|grave|aigu|bass|nightcore|nettoyer',
    category: 'Audio & Vidéo',
    cooldownSeconds: 12,
    async execute(ctx) {
      const effect = ctx.args[0]?.toLowerCase() as AudioEffect | undefined
      const effects = new Set<AudioEffect>(['rapide', 'lent', 'robot', 'grave', 'aigu', 'bass', 'nightcore', 'nettoyer'])
      if (!effect || !effects.has(effect)) return void (await ctx.reply(`Utilisation : ${ctx.prefix}effetaudio robot`))
      const media = await selectedMedia(ctx, ['audio'])
      if (!media) return
      const result = await applyAudioEffect(media.buffer, media.mimetype, effect)
      await sendAudio(ctx, result, `🎛️ Effet audio *${effect}* appliqué.`)
    },
  },
  {
    name: 'couperaudio',
    description: 'Découpe un audio à partir d’un début et d’une durée en secondes.',
    usage: '<début> <durée>',
    category: 'Audio & Vidéo',
    cooldownSeconds: 12,
    async execute(ctx) {
      const start = parseSeconds(ctx.args[0])
      const duration = parseSeconds(ctx.args[1])
      if (start === undefined || duration === undefined || duration <= 0) return void (await ctx.reply(`Utilisation : ${ctx.prefix}couperaudio 10 30`))
      const media = await selectedMedia(ctx, ['audio'])
      if (!media) return
      const result = await trimAudio(media.buffer, media.mimetype, start, duration)
      await sendAudio(ctx, result, '✂️ Audio découpé.')
    },
  },
  {
    name: 'extraireaudio',
    aliases: ['audio-video'],
    description: 'Extrait la piste audio d’une vidéo en MP3.',
    usage: '(en réponse à une vidéo)',
    category: 'Audio & Vidéo',
    cooldownSeconds: 12,
    async execute(ctx) {
      const media = await selectedMedia(ctx, ['video'])
      if (!media) return
      const result = await extractAudioFromVideo(media.buffer, media.mimetype)
      await sendAudio(ctx, result, '🎵 Audio extrait de la vidéo.')
    },
  },
  {
    name: 'compresservideo',
    aliases: ['convertirvideo'],
    description: 'Réencode une vidéo MP4 plus légère, adaptée à WhatsApp.',
    usage: '(en réponse à une vidéo)',
    category: 'Audio & Vidéo',
    cooldownSeconds: 15,
    async execute(ctx) {
      const media = await selectedMedia(ctx, ['video'])
      if (!media) return
      const result = await compressVideo(media.buffer, media.mimetype)
      await sendVideo(ctx, result, '📦 Vidéo compressée.')
    },
  },
  {
    name: 'tournervideo',
    description: 'Tourne une vidéo de 90, 180 ou 270 degrés.',
    usage: '90|180|270',
    category: 'Audio & Vidéo',
    cooldownSeconds: 15,
    async execute(ctx) {
      const angle = Number(ctx.args[0])
      if (angle !== 90 && angle !== 180 && angle !== 270) return void (await ctx.reply(`Utilisation : ${ctx.prefix}tournervideo 90`))
      const media = await selectedMedia(ctx, ['video'])
      if (!media) return
      const result = await rotateVideo(media.buffer, media.mimetype, angle)
      await sendVideo(ctx, result, `🔄 Vidéo tournée de ${angle}°.`)
    },
  },
  {
    name: 'coupervideo',
    description: 'Découpe une vidéo à partir d’un début et d’une durée en secondes.',
    usage: '<début> <durée>',
    category: 'Audio & Vidéo',
    cooldownSeconds: 15,
    async execute(ctx) {
      const start = parseSeconds(ctx.args[0])
      const duration = parseSeconds(ctx.args[1])
      if (start === undefined || duration === undefined || duration <= 0) return void (await ctx.reply(`Utilisation : ${ctx.prefix}coupervideo 5 20`))
      const media = await selectedMedia(ctx, ['video'])
      if (!media) return
      const result = await trimVideo(media.buffer, media.mimetype, start, duration)
      await sendVideo(ctx, result, '✂️ Vidéo découpée.')
    },
  },
  {
    name: 'autocollantvideo',
    aliases: ['vignettevideo'],
    description: 'Transforme les 8 premières secondes d’une vidéo en autocollant animé.',
    usage: '(en réponse à une vidéo courte)',
    category: 'Audio & Vidéo',
    cooldownSeconds: 20,
    async execute(ctx) {
      const media = await selectedMedia(ctx, ['video'])
      if (!media) return
      const sticker = await videoToSticker(media.buffer, media.mimetype)
      if (sticker.length > ctx.config.maxMediaBytes) return void (await ctx.reply('Autocollant trop lourd. Essaie une vidéo plus courte.'))
      await ctx.send({ sticker })
    },
  },
  {
    name: 'creerpdf',
    aliases: ['documentpdf'],
    description: 'Crée un document PDF texte à partir d’un titre et d’un contenu.',
    usage: '<titre> | <contenu>',
    category: 'Documents & Création',
    cooldownSeconds: 8,
    async execute(ctx) {
      const pair = pipePair(ctx.argText)
      if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}creerpdf Mon devis | Bonjour, voici les détails…`))
      const [title, content] = pair
      const document = createTextPdf(title, content)
      await ctx.send({
        document,
        mimetype: 'application/pdf',
        fileName: 'document-bestla-ia.pdf',
        caption: `📄 PDF créé par ${ctx.config.botName}.\n\n✦ BY ${ctx.config.signature}`,
      })
    },
  },
  {
    name: 'texteimage',
    aliases: ['affichetexte'],
    description: 'Crée une image carrée stylée avec un texte.',
    usage: 'neon|or|rose|ciel|minimal | <texte>',
    category: 'Documents & Création',
    cooldownSeconds: 8,
    async execute(ctx) {
      const pair = pipePair(ctx.argText)
      if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}texteimage neon | Bienvenue chez RHAFF SERVICE`))
      const [style, text] = pair
      if (!['neon', 'or', 'rose', 'ciel', 'minimal'].includes(style.toLowerCase())) {
        return void (await ctx.reply('Styles disponibles : neon, or, rose, ciel, minimal.'))
      }
      const image = await sharp(textImageSvg(style.toLowerCase(), text.slice(0, 160))).png().toBuffer()
      await ctx.send({ image, caption: `🖼️ Création ${style.toLowerCase()} par ${ctx.config.botName}.\n\n✦ BY ${ctx.config.signature}` })
    },
  },
  {
    name: 'mediaserveur',
    description: 'Explique les capacités audio, vidéo et PDF disponibles.',
    category: 'Documents & Création',
    async execute(ctx) {
      await ctx.reply(
        brandedPanel(
          'ATELIER MÉDIA',
          [
            `${ctx.prefix}convertiraudio • ${ctx.prefix}effetaudio • ${ctx.prefix}couperaudio`,
            `${ctx.prefix}extraireaudio • ${ctx.prefix}compresservideo • ${ctx.prefix}tournervideo`,
            `${ctx.prefix}coupervideo • ${ctx.prefix}autocollantvideo`,
            `${ctx.prefix}creerpdf • ${ctx.prefix}texteimage`,
            'Réponds au média ou envoie-le avec la commande en légende.',
          ],
          ctx.config,
        ),
      )
    },
  },
]
