import { randomInt } from 'node:crypto'
import type { BotCommand, CommandContext } from '../types.js'
import { jidToMention, sameUser } from '../utils/jid.js'

const QUESTIONS_COUPLE = [
  'Quel petit détail chez moi te fait sourire sans que je m’en rende compte ?',
  'Si on pouvait partir demain sans préparer, tu choisirais quelle destination ?',
  'Quel souvenir de nous tu aimerais revivre exactement pareil ?',
  'Quel surnom drôle tu pourrais me donner aujourd’hui ?',
  'Quelle activité simple on devrait faire plus souvent ensemble ?',
  'Si notre histoire était un film, quel serait son titre ?',
]

const DEFIS_RIGOLOS = [
  'Envoie un vocal de 10 secondes avec une voix de présentateur télé.',
  'Fais un compliment sans utiliser les mots beau, belle, gentil ou gentille.',
  'Choisis trois emojis qui décrivent la personne en face et explique-les.',
  'Écris une mini déclaration comme si tu étais dans un film dramatique.',
  'Raconte ton dernier moment gênant en seulement une phrase.',
  'Invente un slogan publicitaire drôle pour la personne en face.',
]

const VERITES = [
  'Quelle habitude bizarre assumes-tu totalement ?',
  'Quel message as-tu déjà écrit puis supprimé avant de l’envoyer ?',
  'Quelle est la chose la plus drôle que tu as faite pour impressionner quelqu’un ?',
  'Quel compliment te fait toujours plaisir ?',
  'Quel est ton petit plaisir que tu défendras toujours ?',
  'Quelle décision spontanée t’a déjà rendu très heureux ?'
]

const GAGES = [
  'Envoie un emoji au hasard puis invente une histoire de deux phrases autour de lui.',
  'Fais un vocal où tu dis une phrase sérieuse avec une voix très drôle.',
  'Donne trois qualités à la personne de ton choix dans le chat.',
  'Écris ton prochain message sans utiliser la lettre « e ».',
  'Fais une mini publicité de 15 secondes pour un objet qui est près de toi.',
  'Choisis une chanson et résume son ambiance en trois emojis, sans citer les paroles.',
]

const BLAGUES = [
  'Pourquoi les développeurs aiment le mode sombre ? Parce que la lumière attire les bugs. 😄',
  'Un client dit : « Je veux un site simple ». Le développeur répond : « Parfait, on se revoit dans trois semaines ». 😂',
  'Pourquoi le téléphone est allé chez le médecin ? Il avait perdu tous ses contacts. 😄',
  'J’ai voulu vendre du silence en ligne… mais personne n’en a entendu parler. 😂',
  'Mon Wi-Fi et moi, c’est compliqué : dès que j’ai vraiment besoin de lui, il prend ses distances. 😅',
]

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : undefined
}

function money(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
}

function splitPipe(value: string): string[] {
  return value.split('|').map((part) => part.trim()).filter(Boolean)
}

function stablePercent(left: string, right: string): number {
  const value = [left, right].sort().join('|')
  let hash = 0
  for (const char of value) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return 35 + (hash % 66)
}

async function requireTarget(ctx: CommandContext): Promise<string | undefined> {
  const target = ctx.targetUser()
  if (!target) await ctx.reply('Mentionne une personne ou réponds à son message.')
  return target
}

export const utilityCommands: BotCommand[] = [
  {
    name: 'calculmarge',
    aliases: ['margebenefice'],
    description: 'Calcule le bénéfice, la marge et le coefficient à partir du coût et du prix de vente.',
    usage: '<cout> <prixvente>',
    category: 'Entreprise',
    async execute(ctx) {
      const cost = parseNumber(ctx.args[0])
      const sale = parseNumber(ctx.args[1])
      if (cost === undefined || sale === undefined || cost < 0 || sale <= 0) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}calculmarge 5000 7500`))
      }
      const profit = sale - cost
      const margin = (profit / sale) * 100
      const markup = cost > 0 ? (profit / cost) * 100 : 0
      await ctx.reply(`💼 *CALCUL DE MARGE*\n\nCoût : *${money(cost)}*\nPrix de vente : *${money(sale)}*\nBénéfice : *${money(profit)}*\nMarge sur vente : *${margin.toFixed(1)} %*\nMajoration sur coût : *${markup.toFixed(1)} %*`)
    },
  },
  {
    name: 'prixvente',
    aliases: ['calculprixvente'],
    description: 'Calcule le prix de vente nécessaire pour obtenir une marge donnée.',
    usage: '<cout> <marge%>',
    category: 'Entreprise',
    async execute(ctx) {
      const cost = parseNumber(ctx.args[0])
      const margin = parseNumber(ctx.args[1])
      if (cost === undefined || margin === undefined || cost < 0 || margin < 0 || margin >= 100) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}prixvente 5000 30`))
      }
      const price = cost / (1 - margin / 100)
      await ctx.reply(`Pour un coût de *${money(cost)}* et une marge de *${margin.toFixed(1)} %*, le prix de vente conseillé est *${money(price)}*.`)
    },
  },
  {
    name: 'remise',
    aliases: ['calculremise'],
    description: 'Calcule rapidement un prix après réduction.',
    usage: '<prix> <pourcentage>',
    category: 'Entreprise',
    async execute(ctx) {
      const price = parseNumber(ctx.args[0])
      const percent = parseNumber(ctx.args[1])
      if (price === undefined || percent === undefined || price < 0 || percent < 0 || percent > 100) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}remise 20000 15`))
      }
      const discount = price * percent / 100
      await ctx.reply(`🏷️ Prix initial : *${money(price)}*\nRéduction : *${percent.toFixed(1)} %* (${money(discount)})\nPrix final : *${money(price - discount)}*`)
    },
  },
  {
    name: 'objectifvente',
    aliases: ['progressionvente'],
    description: 'Mesure l’avancement d’un objectif de chiffre d’affaires ou de ventes.',
    usage: '<objectif> <realise>',
    category: 'Entreprise',
    async execute(ctx) {
      const target = parseNumber(ctx.args[0])
      const done = parseNumber(ctx.args[1])
      if (target === undefined || done === undefined || target <= 0 || done < 0) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}objectifvente 500000 175000`))
      }
      const progress = Math.min(999.9, (done / target) * 100)
      const remaining = Math.max(0, target - done)
      await ctx.reply(`🎯 *OBJECTIF DE VENTE*\n\nObjectif : *${money(target)}*\nRéalisé : *${money(done)}*\nProgression : *${progress.toFixed(1)} %*\nReste : *${money(remaining)}*`)
    },
  },
  {
    name: 'relanceclient',
    aliases: ['rappelclient'],
    description: 'Prépare une relance client courte et professionnelle à copier.',
    usage: '<nom> | <produit/service> | [contexte]',
    category: 'Entreprise',
    async execute(ctx) {
      const [name, subject, context] = splitPipe(ctx.argText)
      if (!name || !subject) return void (await ctx.reply(`Utilisation : ${ctx.prefix}relanceclient Awa | création de site | devis envoyé hier`))
      await ctx.reply(`Bonjour ${name}, j’espère que vous allez bien. Je reviens vers vous concernant *${subject}*${context ? ` (${context})` : ''}. Avez-vous eu le temps de regarder ? Je reste disponible si vous avez une question ou si vous souhaitez qu’on avance ensemble. Merci.`)
    },
  },
  {
    name: 'ficheclient',
    aliases: ['resumeclient'],
    description: 'Transforme rapidement des informations client en fiche claire.',
    usage: '<nom> | <contact> | <besoin> | <budget> | [note]',
    category: 'Entreprise',
    async execute(ctx) {
      const [name, contact, need, budget, note] = splitPipe(ctx.argText)
      if (!name || !contact || !need) return void (await ctx.reply(`Utilisation : ${ctx.prefix}ficheclient Issa | +226... | boutique en ligne | 150000 | urgent`))
      await ctx.reply(`📋 *FICHE CLIENT*\n\nNom : *${name}*\nContact : *${contact}*\nBesoin : *${need}*\nBudget : *${budget ?? 'non précisé'}*${note ? `\nNote : *${note}*` : ''}`)
    },
  },
  {
    name: 'tiragemembre',
    aliases: ['membreauhasard'],
    description: 'Choisit au hasard un membre du groupe pour un jeu, un cadeau ou une animation.',
    category: 'Groupe',
    groupOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const participants = (ctx.groupMetadata?.participants ?? [])
        .map((participant) => participant.id)
        .filter((jid) => !sameUser(jid, ctx.sock.user?.id))
      if (!participants.length) return void (await ctx.reply('Aucun membre disponible pour le tirage.'))
      const target = participants[randomInt(0, participants.length)]!
      await ctx.reply(`🎉 Le tirage désigne ${jidToMention(target)} !`, [target])
    },
  },
  {
    name: 'choisirhasard',
    aliases: ['choixhasard'],
    description: 'Choisit une option au hasard parmi celles séparées par |.',
    usage: '<option 1> | <option 2> | <option 3>',
    category: 'Jeux',
    async execute(ctx) {
      const options = splitPipe(ctx.argText)
      if (options.length < 2) return void (await ctx.reply(`Utilisation : ${ctx.prefix}choisirhasard pizza | poulet | burger`))
      const selected = options[randomInt(0, Math.min(options.length, 50))]!
      await ctx.reply(`🎲 Je choisis : *${selected}*`)
    },
  },
  {
    name: 'questioncouple',
    aliases: ['questionamour'],
    description: 'Propose une question légère et amusante à poser en couple.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`💞 ${QUESTIONS_COUPLE[randomInt(0, QUESTIONS_COUPLE.length)]}`)
    },
  },
  {
    name: 'defirigolo',
    aliases: ['defiamusant'],
    description: 'Donne un petit défi drôle et sans danger pour animer une discussion.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`😄 *DÉFI*\n${DEFIS_RIGOLOS[randomInt(0, DEFIS_RIGOLOS.length)]}`)
    },
  },
  {
    name: 'verite',
    aliases: ['questionverite'],
    description: 'Donne une question pour jouer à vérité.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`🤭 *VÉRITÉ*\n${VERITES[randomInt(0, VERITES.length)]}`)
    },
  },
  {
    name: 'gage',
    aliases: ['petitgage'],
    description: 'Donne un gage amusant et sans danger.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`🎭 *GAGE*\n${GAGES[randomInt(0, GAGES.length)]}`)
    },
  },
  {
    name: 'compatibilite',
    aliases: ['compatibiliteamour'],
    description: 'Calcule un score de compatibilité purement ludique avec une personne.',
    usage: '@personne',
    category: 'Jeux',
    async execute(ctx) {
      const target = await requireTarget(ctx)
      if (!target) return
      const score = stablePercent(ctx.sender, target)
      await ctx.reply(`💘 Compatibilité entre ${jidToMention(ctx.sender)} et ${jidToMention(target)} : *${score} %*\n\nC’est juste pour s’amuser 😄`, [ctx.sender, target])
    },
  },
  {
    name: 'blague',
    aliases: ['blaguer'],
    description: 'Envoie une petite blague en français.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`😂 ${BLAGUES[randomInt(0, BLAGUES.length)]}`)
    },
  },
]
