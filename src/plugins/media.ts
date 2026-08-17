import QRCode from 'qrcode'
import sharp from 'sharp'
import type { BotCommand, CommandContext } from '../types.js'
import { downloadMedia, findMedia } from '../utils/message.js'

function sourceMessage(ctx: CommandContext) {
  if (findMedia(ctx.message)) return ctx.message
  const quoted = ctx.quotedMessage()
  return quoted && findMedia(quoted) ? quoted : undefined
}

async function requireImage(ctx: CommandContext) {
  const source = sourceMessage(ctx)
  if (!source) {
    await ctx.reply('Envoie une image avec la commande en légende ou réponds à une image.')
    return undefined
  }
  const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
  if (media.type !== 'image') {
    await ctx.reply('Le média sélectionné doit être une image.')
    return undefined
  }
  return media.buffer
}

function escapeSvgText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function watermarkSvg(text: string, width: number): Buffer {
  const fontSize = Math.max(20, Math.min(120, Math.round(width / 16)))
  const horizontalPadding = Math.round(fontSize * 0.8)
  const height = Math.round(fontSize * 2.5)
  const safeText = escapeSvgText(text)
  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" fill="#11182C" fill-opacity="0.72"/><text x="${horizontalPadding}" y="${Math.round(fontSize * 1.55)}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#FFFFFF">${safeText}</text></svg>`,
  )
}

export const mediaCommands: BotCommand[] = [
  {
    name: 'autocollant',
    aliases: ['vignette'],
    description: 'Transforme une image en autocollant WebP.',
    usage: '(en légende ou en réponse à une image)',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const source = sourceMessage(ctx)
      if (!source) {
        return void (await ctx.reply('Envoie une image avec la légende .autocollant ou réponds à une image.'))
      }
      const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
      if (media.type === 'sticker') {
        await ctx.send({ sticker: media.buffer })
        return
      }
      if (media.type !== 'image') return void (await ctx.reply('Cette commande accepte uniquement une image.'))
      const sticker = await sharp(media.buffer, { animated: false })
        .rotate()
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 82 })
        .toBuffer()
      await ctx.send({ sticker })
    },
  },
  {
    name: 'image',
    aliases: ['photo'],
    description: 'Transforme un autocollant en image PNG.',
    usage: '(en réponse à un autocollant)',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const source = sourceMessage(ctx)
      if (!source) return void (await ctx.reply('Réponds à un autocollant avec .image.'))
      const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
      if (media.type !== 'sticker') return void (await ctx.reply('Le média sélectionné n’est pas un autocollant.'))
      const image = await sharp(media.buffer, { animated: false }).png().toBuffer()
      await ctx.send({ image, caption: 'Autocollant converti.' })
    },
  },
  {
    name: 'infomedia',
    aliases: ['formatmedia'],
    description: 'Affiche le type et le format d’un média.',
    usage: '(en réponse à un média)',
    category: 'Média',
    async execute(ctx) {
      const source = sourceMessage(ctx)
      const media = source ? findMedia(source) : undefined
      if (!media) return void (await ctx.reply('Réponds à une image, vidéo, note vocale, autocollant ou document.'))
      await ctx.reply(`Type : ${media.type}\nFormat : ${media.mimetype}`)
    },
  },
  {
    name: 'codeqr',
    aliases: ['creerqr'],
    description: 'Crée un code QR à partir d’un texte ou d’un lien.',
    usage: '<texte ou lien>',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      if (!ctx.argText) return void (await ctx.reply(`Utilisation : ${ctx.prefix}codeqr https://exemple.com`))
      const image = await QRCode.toBuffer(ctx.argText.slice(0, 2_000), {
        type: 'png',
        width: 900,
        margin: 2,
        color: { dark: '#18233A', light: '#FFFFFF' },
      })
      await ctx.send({ image, caption: 'Code QR créé.' })
    },
  },
  {
    name: 'compresserimage',
    aliases: ['allegerimage'],
    description: 'Compresse une image en JPEG.',
    usage: '[qualité 20 à 90]',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const quality = Math.min(90, Math.max(20, Number(ctx.args[0] ?? 65) || 65))
      const image = await sharp(input).rotate().jpeg({ quality, mozjpeg: true }).toBuffer()
      await ctx.send({ image, caption: `Image compressée à ${quality} %.` })
    },
  },
  {
    name: 'redimensionner',
    aliases: ['taillerimage'],
    description: 'Redimensionne une image sans la déformer.',
    usage: '<largeur> [hauteur]',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const width = Number(ctx.args[0])
      const height = ctx.args[1] ? Number(ctx.args[1]) : undefined
      if (!Number.isInteger(width) || width < 64 || width > 4_000 || (height && (!Number.isInteger(height) || height < 64 || height > 4_000))) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}redimensionner 1080 1080`))
      }
      const image = await sharp(input)
        .rotate()
        .resize({ width, ...(height ? { height } : {}), fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
      await ctx.send({ image, caption: 'Image redimensionnée.' })
    },
  },
  {
    name: 'noiretblanc',
    aliases: ['gris'],
    description: 'Transforme une image en noir et blanc.',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const image = await sharp(input).rotate().grayscale().jpeg({ quality: 85 }).toBuffer()
      await ctx.send({ image, caption: 'Effet noir et blanc appliqué.' })
    },
  },
  {
    name: 'tournerimage',
    aliases: ['rotation'],
    description: 'Tourne une image de 90, 180 ou 270 degrés.',
    usage: '90|180|270',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const angle = Number(ctx.args[0])
      if (![90, 180, 270].includes(angle)) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}tournerimage 90`))
      }
      const image = await sharp(input).rotate(angle).png().toBuffer()
      await ctx.send({ image, caption: `Image tournée de ${angle}°.` })
    },
  },
  {
    name: 'flouimage',
    aliases: ['flouterimage'],
    description: 'Applique un flou réglable à une image.',
    usage: '[intensité 1 à 100]',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const intensity = Number(ctx.args[0] ?? 6)
      if (!Number.isFinite(intensity) || intensity < 1 || intensity > 100) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}flouimage 8 (entre 1 et 100)`))
      }
      const image = await sharp(input).rotate().blur(intensity).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
      await ctx.send({ image, caption: `Flou appliqué (intensité ${intensity}).` })
    },
  },
  {
    name: 'filigrane',
    aliases: ['marque'],
    description: 'Ajoute une signature visible en bas d’une image.',
    usage: '<texte>',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const text = ctx.argText.trim().slice(0, 80)
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}filigrane Mon texte`))
      const metadata = await sharp(input).metadata()
      const width = Math.max(320, Math.min(4_000, metadata.width ?? 1_080))
      const image = await sharp(input)
        .rotate()
        .composite([{ input: watermarkSvg(text, width), gravity: 'south' }])
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer()
      await ctx.send({ image, caption: 'Filigrane ajouté.' })
    },
  },
  {
    name: 'recadrerimage',
    aliases: ['rognerimage'],
    description: 'Recadre une image au format carré, portrait ou paysage.',
    usage: 'carre|portrait|paysage',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const choice = ctx.args[0]?.toLowerCase()
      const formats: Record<string, { width: number; height: number; label: string }> = {
        carre: { width: 1_080, height: 1_080, label: 'carré' },
        portrait: { width: 1_080, height: 1_350, label: 'portrait' },
        paysage: { width: 1_600, height: 900, label: 'paysage' },
      }
      const format = choice ? formats[choice] : undefined
      if (!format) return void (await ctx.reply(`Utilisation : ${ctx.prefix}recadrerimage carre|portrait|paysage`))
      const image = await sharp(input)
        .rotate()
        .resize(format.width, format.height, { fit: 'cover', position: sharp.strategy.attention })
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer()
      await ctx.send({ image, caption: `Image recadrée au format ${format.label}.` })
    },
  },
  {
    name: 'infosimage',
    aliases: ['detailsimage'],
    description: 'Affiche les dimensions, le format et le poids d’une image.',
    usage: '(en réponse à une image)',
    category: 'Média',
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const metadata = await sharp(input).metadata()
      await ctx.reply(
        `🖼️ *INFORMATIONS IMAGE*\n\nFormat : ${metadata.format?.toUpperCase() ?? 'inconnu'}\nDimensions : ${metadata.width ?? '?'} × ${metadata.height ?? '?'} px\nCanaux : ${metadata.channels ?? '?'}\nPoids : ${(input.length / 1_024 / 1_024).toFixed(2)} Mo`,
      )
    },
  },
  {
    name: 'amelioreimage',
    aliases: ['optimiserimage'],
    description: 'Améliore automatiquement le contraste et la netteté d’une image.',
    usage: '(en réponse à une image)',
    category: 'Média',
    cooldownSeconds: 5,
    async execute(ctx) {
      const input = await requireImage(ctx)
      if (!input) return
      const image = await sharp(input)
        .rotate()
        .normalise()
        .sharpen({ sigma: 1.1, m1: 1, m2: 2 })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer()
      await ctx.send({ image, caption: 'Image améliorée.' })
    },
  },
]
