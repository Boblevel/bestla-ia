import type { BotCommand, CommandContext } from '../types.js'
import {
  downloadSocialAudio,
  downloadSocialVideo,
  inspectSocialMedia,
  parseAudioBitrate,
  parseVideoQuality,
  SocialDownloadError,
} from '../core/social-downloader.js'

function extractUrlAndOption(ctx: CommandContext): { url?: string; option?: string } {
  const tokens = ctx.args.map((item) => item.trim()).filter(Boolean)
  const urlIndex = tokens.findIndex((item) => /^https?:\/\//i.test(item))
  if (urlIndex === -1) return {}

  const url = tokens.splice(urlIndex, 1)[0]
  if (!url) return {}

  const option = tokens[0]
  return option ? { url, option } : { url }
}

function durationLabel(seconds: number | null): string {
  if (!seconds) return 'inconnue'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}min`
    : `${minutes}min ${String(secs).padStart(2, '0')}s`
}

async function replyDownloadError(ctx: CommandContext, error: unknown): Promise<void> {
  if (error instanceof SocialDownloadError) {
    await ctx.reply(error.message)
    return
  }
  throw error
}

export const socialMediaCommands: BotCommand[] = [
  {
    name: 'telecharger',
    aliases: ['dl', 'download', 'telechargervideo'],
    description: 'Télécharge une vidéo publique depuis un lien compatible (YouTube, Instagram, Facebook, TikTok et autres sites pris en charge).',
    usage: '<lien> [360p|480p|720p|1080p|best]',
    category: 'Audio & Vidéo',
    cooldownSeconds: 20,
    async execute(ctx) {
      const { url, option } = extractUrlAndOption(ctx)
      if (!url) return void (await ctx.reply(`Utilisation : ${ctx.prefix}telecharger https://... 720p`))
      try {
        const quality = parseVideoQuality(option)
        await ctx.reply(`Téléchargement en cours (${quality === 'best' ? 'meilleure qualité' : `${quality}p max`})…`)
        const media = await downloadSocialVideo(url, quality, ctx.config.maxMediaBytes)
        if (media.mimetype.startsWith('video/')) {
          await ctx.send({
            video: media.buffer,
            mimetype: media.mimetype,
            caption: `${media.title}\nSource : ${media.extractor} • ${media.qualityLabel}`,
          })
        } else {
          await ctx.send({
            document: media.buffer,
            mimetype: media.mimetype,
            fileName: media.fileName,
            caption: `${media.title}\nSource : ${media.extractor} • ${media.qualityLabel}`,
          })
        }
      } catch (error) {
        await replyDownloadError(ctx, error)
      }
    },
  },
  {
    name: 'telechargeraudio',
    aliases: ['dlaudio', 'lienmp3', 'extrairelienaudio'],
    description: 'Télécharge uniquement l’audio d’un lien public et le convertit en MP3.',
    usage: '<lien> [64k|96k|128k|160k|192k|256k|320k]',
    category: 'Audio & Vidéo',
    cooldownSeconds: 20,
    async execute(ctx) {
      const { url, option } = extractUrlAndOption(ctx)
      if (!url) return void (await ctx.reply(`Utilisation : ${ctx.prefix}telechargeraudio https://... 128k`))
      try {
        const bitrate = parseAudioBitrate(option)
        await ctx.reply(`Extraction audio en cours (${bitrate} kb/s)…`)
        const media = await downloadSocialAudio(url, bitrate, ctx.config.maxMediaBytes)
        await ctx.send({
          audio: media.buffer,
          mimetype: 'audio/mpeg',
          ptt: false,
        })
      } catch (error) {
        await replyDownloadError(ctx, error)
      }
    },
  },
  {
    name: 'qualites',
    aliases: ['formatslien', 'qualitesvideo'],
    description: 'Analyse un lien public et affiche les résolutions vidéo détectées avant téléchargement.',
    usage: '<lien>',
    category: 'Audio & Vidéo',
    cooldownSeconds: 12,
    async execute(ctx) {
      const { url } = extractUrlAndOption(ctx)
      if (!url) return void (await ctx.reply(`Utilisation : ${ctx.prefix}qualites https://...`))
      try {
        const info = await inspectSocialMedia(url)
        const standard = [360, 480, 720, 1080, 1440, 2160]
        const shown = standard.filter((height) => info.qualities.some((actual) => actual >= height - 20 && actual <= height + 20))
        const available = shown.length ? shown.map((height) => `${height}p`).join(', ') : 'qualités variables selon le site'
        await ctx.reply(
          `Titre : ${info.title.slice(0, 180)}\nSource : ${info.extractor}\nDurée : ${durationLabel(info.duration)}\nQualités détectées : ${available}\n\nExemple : ${ctx.prefix}telecharger ${info.url} 720p`,
        )
      } catch (error) {
        await replyDownloadError(ctx, error)
      }
    },
  },
]
