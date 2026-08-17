import { MediaAiError, MediaAiService } from '../core/media-ai.js'
import type { BotCommand, CommandContext } from '../types.js'
import { downloadMedia, findMedia } from '../utils/message.js'

function canUseMediaAi(ctx: CommandContext): boolean {
  return ctx.isOwner || ctx.config.mediaAi.publicAccess
}

async function guard(ctx: CommandContext): Promise<MediaAiService | undefined> {
  if (!canUseMediaAi(ctx)) {
    await ctx.reply('La génération média IA est réservée au propriétaire. Elle peut être rendue publique avec MEDIA_AI_PUBLIC=true.')
    return undefined
  }
  const service = new MediaAiService(ctx.config)
  if (!service.isConfigured()) {
    await ctx.reply('La génération média IA n’est pas encore prête. Active MEDIA_AI_ENABLED=true, ajoute ta clé Gemini pour la vidéo, et configure Cloudflare si tu veux générer les images gratuitement.')
    return undefined
  }
  return service
}

async function sourceImage(ctx: CommandContext): Promise<{ buffer: Buffer; mimetype: string } | undefined> {
  const direct = findMedia(ctx.message)
  const quoted = ctx.quotedMessage()
  const source = direct?.type === 'image' ? ctx.message : quoted && findMedia(quoted)?.type === 'image' ? quoted : undefined
  if (!source) {
    await ctx.reply('Envoie une image avec la commande en légende, ou réponds à une image avec cette commande.')
    return undefined
  }
  const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
  if (media.type !== 'image') {
    await ctx.reply('Le média doit être une image.')
    return undefined
  }
  return { buffer: media.buffer, mimetype: media.mimetype }
}

async function sourceVideo(ctx: CommandContext): Promise<{ buffer: Buffer; mimetype: string } | undefined> {
  const direct = findMedia(ctx.message)
  const quoted = ctx.quotedMessage()
  const source = direct?.type === 'video' ? ctx.message : quoted && findMedia(quoted)?.type === 'video' ? quoted : undefined
  if (!source) {
    await ctx.reply('Envoie une vidéo avec la commande en légende, ou réponds à une vidéo avec cette commande.')
    return undefined
  }
  const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
  if (media.type !== 'video') {
    await ctx.reply('Le média doit être une vidéo.')
    return undefined
  }
  return { buffer: media.buffer, mimetype: media.mimetype }
}

async function mediaFailure(ctx: CommandContext, error: unknown): Promise<void> {
  const message = error instanceof MediaAiError ? error.message : 'La génération média IA a échoué pour le moment.'
  await ctx.reply(message)
}

export const generativeMediaCommands: BotCommand[] = [
  {
    name: 'genererimage',
    aliases: ['imageia', 'creerimage', 'imagine', 'geminiimage'],
    description: 'Génère une image avec l’API média IA configurée.',
    usage: '<description>',
    category: 'Média',
    cooldownSeconds: 20,
    async execute(ctx) {
      const service = await guard(ctx)
      if (!service) return
      if (!ctx.argText.trim()) return void (await ctx.reply(`Utilisation : ${ctx.prefix}genererimage Une boutique futuriste blanche et or`))
      try {
        const generated = await service.generateImage(ctx.argText)
        await ctx.send({
          image: generated.buffer,
          mimetype: generated.mimetype,
          caption: '🎨 Image générée.',
        })
      } catch (error) {
        await mediaFailure(ctx, error)
      }
    },
  },
  {
    name: 'modifierimage',
    aliases: ['retoucheia', 'editerimage'],
    description: 'Modifie une image selon une instruction.',
    usage: '<modification> en réponse à une image',
    category: 'Média',
    cooldownSeconds: 20,
    async execute(ctx) {
      const service = await guard(ctx)
      if (!service) return
      if (!ctx.argText.trim()) return void (await ctx.reply(`Utilisation : réponds à une image avec ${ctx.prefix}modifierimage Remplace le fond par un studio blanc et or`))
      const image = await sourceImage(ctx)
      if (!image) return
      try {
        const generated = await service.editImage(ctx.argText, image)
        await ctx.send({
          image: generated.buffer,
          mimetype: generated.mimetype,
          caption: '🪄 Image modifiée.',
        })
      } catch (error) {
        await mediaFailure(ctx, error)
      }
    },
  },
  {
    name: 'generervideo',
    aliases: ['videoia', 'creervideo'],
    description: 'Génère une courte vidéo IA à partir d’un texte.',
    usage: '<description>',
    category: 'Audio & Vidéo',
    cooldownSeconds: 60,
    async execute(ctx) {
      const service = await guard(ctx)
      if (!service) return
      if (!ctx.argText.trim()) return void (await ctx.reply(`Utilisation : ${ctx.prefix}generervideo Plan cinématique vertical d’une boutique moderne`))
      try {
        const generated = await service.generateVideo(ctx.argText)
        await ctx.send({
          video: generated.buffer,
          mimetype: generated.mimetype,
          caption: '🎬 Vidéo générée.',
        })
      } catch (error) {
        await mediaFailure(ctx, error)
      }
    },
  },
  {
    name: 'animerimage',
    aliases: ['imagevideo', 'imageversvideo'],
    description: 'Anime une image en vidéo avec une instruction.',
    usage: '<mouvement> en réponse à une image',
    category: 'Audio & Vidéo',
    cooldownSeconds: 60,
    async execute(ctx) {
      const service = await guard(ctx)
      if (!service) return
      if (!ctx.argText.trim()) return void (await ctx.reply(`Utilisation : réponds à une image avec ${ctx.prefix}animerimage La caméra avance lentement, mouvements naturels`))
      const image = await sourceImage(ctx)
      if (!image) return
      try {
        const generated = await service.generateVideo(ctx.argText, image)
        await ctx.send({
          video: generated.buffer,
          mimetype: generated.mimetype,
          caption: '🎞️ Animation générée.',
        })
      } catch (error) {
        await mediaFailure(ctx, error)
      }
    },
  },
  {
    name: 'modifiervideo',
    aliases: ['editervideo', 'retouchevideo'],
    description: 'Modifie une vidéo selon une instruction avec l’IA multimodale.',
    usage: '<modification> en réponse à une vidéo',
    category: 'Audio & Vidéo',
    cooldownSeconds: 60,
    async execute(ctx) {
      const service = await guard(ctx)
      if (!service) return
      if (!ctx.argText.trim()) {
        return void (await ctx.reply(
          `Utilisation : réponds à une vidéo avec ${ctx.prefix}modifiervideo Garde tout identique mais rends l’éclairage plus cinématique`,
        ))
      }
      const video = await sourceVideo(ctx)
      if (!video) return
      try {
        const generated = await service.editVideo(ctx.argText, video)
        await ctx.send({
          video: generated.buffer,
          mimetype: generated.mimetype,
          caption: '🎞️ Vidéo modifiée.',
        })
      } catch (error) {
        await mediaFailure(ctx, error)
      }
    },
  },
  {
    name: 'etatmediaia',
    aliases: ['statutmediaia'],
    description: 'Affiche l’état de la génération d’images et vidéos IA.',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const state = new MediaAiService(ctx.config).status()
      await ctx.reply(
        `Média IA : *${state.enabled ? 'activé' : 'désactivé'}*\nMode : *${state.provider}*\nImage : ${state.imageProvider} • ${state.imageConfigured ? 'prête' : 'indisponible'} • ${state.imageAccounts} compte(s) de secours\nModèle image : ${state.imageModel}\nRetouche image : ${state.imageEditConfigured ? 'Gemini prête' : 'Gemini non configurée'} • ${state.imageEditModel}\nVidéo : ${state.videoConfigured ? 'Gemini prête' : 'Gemini non configurée'}${state.videoFallback ? ' + secours local 5 s prêt' : ''}\nModèle vidéo : ${state.videoModel}\nAccès public : *${ctx.config.mediaAi.publicAccess ? 'oui' : 'non'}*`,
      )
    },
  },
]
