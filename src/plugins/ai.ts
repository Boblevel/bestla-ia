import { AiService, AiServiceError } from '../core/ai.js'
import type { BotCommand, CommandContext } from '../types.js'
import { messageText } from '../utils/text.js'

function inputText(ctx: CommandContext): string {
  const quoted = ctx.quotedMessage()
  return ctx.argText.trim() || (quoted ? messageText(quoted).trim() : '')
}

function canUseAi(ctx: CommandContext): boolean {
  return ctx.config.ai.publicAccess || ctx.isOwner
}

async function runAi(ctx: CommandContext, instruction: string, text: string): Promise<void> {
  if (!canUseAi(ctx)) {
    await ctx.reply('L’assistant IA est réservé au propriétaire. Le propriétaire peut activer AI_PUBLIC=true dans .env s’il souhaite le rendre public.')
    return
  }
  try {
    const answer = await new AiService(ctx.config).complete(instruction, text)
    await ctx.reply(answer)
  } catch (error) {
    const message = error instanceof AiServiceError ? error.message : 'Impossible de joindre l’assistant IA pour le moment.'
    await ctx.reply(message)
  }
}

function pipePair(value: string): [string, string] | undefined {
  const separator = value.indexOf('|')
  if (separator === -1) return undefined
  const left = value.slice(0, separator).trim()
  const right = value.slice(separator + 1).trim()
  return left && right ? [left, right] : undefined
}

export const aiCommands: BotCommand[] = [
  {
    name: 'assistant',
    aliases: ['ia'],
    description: 'Pose une question à l’assistant IA configuré par le propriétaire.',
    usage: '<question>',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}assistant Explique-moi simplement ce sujet.`))
      await runAi(ctx, 'Réponds directement, naturellement et avec concision. Ne te présente pas, n’ajoute aucun nom de bot, aucune signature et aucun titre. Si tu ne sais pas, dis-le clairement.', text)
    },
  },
  {
    name: 'demander',
    aliases: ['gemini', 'prompt', 'ask'],
    description: 'Envoie un prompt libre à l’assistant IA et renvoie une réponse complète.',
    usage: '<prompt>',
    category: 'IA',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}demander Écris-moi une proposition commerciale courte.`))
      await runAi(
        ctx,
        'Exécute précisément le prompt du propriétaire. Réponds directement, de façon utile, structurée et naturelle. Ne te présente pas, n’ajoute aucun nom de bot, aucune signature ni aucun titre. N’invente pas de faits personnels ou commerciaux manquants et ne révèle jamais de secrets.',
        text,
      )
    },
  },
  {
    name: 'analyserclient',
    aliases: ['analyseclient', 'analysemessage'],
    description: 'Analyse un message client et propose la meilleure réponse ou un transfert humain.',
    usage: '<message> ou répondre à un message',
    category: 'IA',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Réponds à un message client avec ${ctx.prefix}analyserclient ou ajoute le texte après la commande.`))
      await runAi(
        ctx,
        'Analyse ce message client. Donne : 1) intention, 2) niveau d’urgence (faible/moyen/élevé), 3) informations manquantes, 4) réponse WhatsApp courte et polie, 5) indique clairement si une intervention humaine est recommandée. Ne promets ni prix, ni délai, ni disponibilité non fournis.',
        text,
      )
    },
  },
  {
    name: 'traduire',
    description: 'Traduit un texte vers la langue demandée.',
    usage: '<langue> | <texte>',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const pair = pipePair(ctx.argText)
      if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}traduire anglais | Bonjour, comment vas-tu ?`))
      const [language, text] = pair
      await runAi(ctx, `Traduis uniquement le texte en ${language}. Conserve le ton et les retours à la ligne. N’ajoute pas de commentaire.`, text)
    },
  },
  {
    name: 'resumer',
    aliases: ['resume'],
    description: 'Résume un texte envoyé ou cité.',
    usage: '<texte> ou répondre à un texte',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Écris ${ctx.prefix}resumer <texte> ou réponds à un message texte.`))
      await runAi(ctx, 'Résume ce texte en français sous forme de 3 à 7 points courts, sans inventer d’information.', text)
    },
  },
  {
    name: 'corrigertexte',
    aliases: ['corriger'],
    description: 'Corrige l’orthographe et la grammaire d’un texte.',
    usage: '<texte> ou répondre à un texte',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Écris ${ctx.prefix}corrigertexte <texte> ou réponds à un message texte.`))
      await runAi(ctx, 'Corrige uniquement ce texte en français. Conserve le sens, le ton et la mise en forme. Réponds seulement par la version corrigée.', text)
    },
  },
  {
    name: 'reformuler',
    description: 'Reformule un texte de manière claire et naturelle.',
    usage: '<texte> ou répondre à un texte',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Écris ${ctx.prefix}reformuler <texte> ou réponds à un message texte.`))
      await runAi(ctx, 'Reformule ce texte en français avec un style professionnel et simple. Ne change pas les faits et réponds uniquement par le texte reformulé.', text)
    },
  },
  {
    name: 'reponsepro',
    aliases: ['reponseclient', 'replypro'],
    description: 'Rédige une réponse professionnelle et polie à un message client.',
    usage: '<message> ou répondre à un message',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Écris ${ctx.prefix}reponsepro <message> ou réponds au message du client.`))
      await runAi(
        ctx,
        'Rédige une réponse WhatsApp professionnelle, polie, naturelle et concise. Ne promets rien qui ne soit pas indiqué. N’invente ni prix, ni délai, ni disponibilité. Réponds uniquement avec le message prêt à envoyer.',
        text,
      )
    },
  },
  {
    name: 'ameliorerprompt',
    aliases: ['promptpro', 'promptia'],
    description: 'Transforme une idée courte en prompt détaillé pour générer une image ou une vidéo.',
    usage: '<idée>',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}ameliorerprompt Une boutique moderne blanche et or`))
      await runAi(
        ctx,
        'Transforme cette idée en un prompt de génération visuelle très précis. Décris sujet, décor, lumière, cadrage, ambiance, style, qualité et format. N’ajoute aucune explication avant ou après le prompt.',
        text,
      )
    },
  },
  {
    name: 'ideescontenu',
    aliases: ['idees', 'contenuia'],
    description: 'Propose des idées de contenu utiles à partir d’un sujet.',
    usage: '<sujet>',
    category: 'IA',
    cooldownSeconds: 8,
    async execute(ctx) {
      const text = inputText(ctx)
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}ideescontenu accessoires téléphone`))
      await runAi(
        ctx,
        'Propose 7 idées de contenu courtes, variées et concrètes pour WhatsApp ou réseaux sociaux. Pour chaque idée : titre, angle et phrase d’accroche. Évite le spam, les fausses promesses et les techniques trompeuses.',
        text,
      )
    },
  },
  {
    name: 'etatia',
    description: 'Affiche l’état de la configuration IA sans révéler la clé.',
    category: 'IA',
    ownerOnly: true,
    async execute(ctx) {
      const status = new AiService(ctx.config).status()
      await ctx.reply(
        `🤖 *ÉTAT IA*\n\nFournisseur : *${status.provider}*\nModèle : *${status.model}*\nClé configurée : *${status.configured ? 'oui' : 'non'}*\nAccès public : *${ctx.config.ai.publicAccess ? 'oui' : 'non'}*`,
      )
    },
  },
]
