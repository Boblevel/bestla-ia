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

const TU_PREFERES_COUPLE = [
  'Tu préfères une soirée tranquille à deux ou une sortie surprise préparée par l’autre ?',
  'Tu préfères recevoir un long message romantique ou un petit vocal spontané ?',
  'Tu préfères refaire votre premier rendez-vous ou découvrir un nouvel endroit ensemble ?',
  'Tu préfères préparer un repas à deux ou commander quelque chose et regarder un film ?',
  'Tu préfères une surprise matérielle ou une journée entièrement organisée pour vous deux ?',
  'Tu préfères parler pendant des heures le soir ou faire une activité ensemble sans téléphone ?',
]

const SOUVENIRS_COUPLE = [
  'Racontez chacun le premier détail que vous avez remarqué chez l’autre.',
  'Choisissez un souvenir où vous avez beaucoup ri et racontez-le chacun de votre côté.',
  'Quel moment simple passé ensemble aimeriez-vous refaire cette semaine ?',
  'Citez chacun une phrase de l’autre que vous n’avez jamais oubliée.',
  'Quel moment vous a fait comprendre que votre relation devenait importante ?',
  'Choisissez une photo de vous deux et racontez ce qui s’est passé juste avant ou juste après.',
]

const DEFIS_COUPLE = [
  'Envoyez-vous chacun un compliment précis que vous n’avez encore jamais formulé.',
  'Chacun choisit une chanson qui lui rappelle l’autre et explique pourquoi, sans citer les paroles.',
  'Pendant deux minutes, posez-vous uniquement des questions positives sur votre relation.',
  'Chacun propose une petite activité à faire ensemble cette semaine ; tirez-en une au hasard.',
  'Écrivez chacun trois mots qui décrivent votre couple puis comparez vos réponses.',
  'Faites chacun un vocal de 15 secondes pour raconter votre meilleur moment récent à deux.',
]

const QUIZ_COUPLE = [
  'Quel plat l’autre choisirait en premier s’il pouvait commander n’importe quoi maintenant ?',
  'Quelle activité l’autre choisirait pour une journée totalement libre ?',
  'Quel petit geste met le plus facilement l’autre de bonne humeur ?',
  'Quel voyage l’autre aimerait le plus faire à deux ?',
  'Quelle qualité l’autre pense-t-il que tu apprécies le plus chez lui ou elle ?',
  'Si l’autre devait choisir un cadeau simple aujourd’hui, que préférerait-il recevoir ?',
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

const ACTIONS = [
  'Envoie un vocal de 10 secondes en parlant comme un présentateur radio.',
  'Fais un compliment drôle mais sincère à la personne de ton choix dans le chat.',
  'Choisis trois emojis pour raconter ta journée et laisse les autres deviner.',
  'Écris une phrase romantique ou amicale sans utiliser la lettre « a ».',
  'Présente un objet près de toi comme si c’était un produit de luxe pendant 15 secondes.',
  'Fais un mini freestyle de 10 secondes sur un thème choisi par le chat.',
  'Écris un message très sérieux uniquement avec des emojis.',
  'Donne un surnom drôle et gentil à la personne de ton choix.',
  'Fais un vocal de 10 secondes avec une voix de commentateur de football.',
  'Écris trois qualités de la dernière personne qui t’a envoyé un message.',
]

const JE_NAI_JAMAIS = [
  'Je n’ai jamais envoyé un message puis fait semblant que ce n’était pas pour cette personne.',
  'Je n’ai jamais relu une ancienne conversation juste pour sourire.',
  'Je n’ai jamais menti sur l’heure à laquelle je me suis couché.',
  'Je n’ai jamais supprimé un message parce que je regrettais immédiatement de l’avoir envoyé.',
  'Je n’ai jamais inventé une excuse pour éviter une sortie.',
  'Je n’ai jamais regardé le statut de quelqu’un plusieurs fois dans la même journée.',
  'Je n’ai jamais ri dans un moment où je devais rester sérieux.',
  'Je n’ai jamais oublié l’anniversaire de quelqu’un d’important.',
  'Je n’ai jamais gardé une capture d’écran d’une conversation drôle.',
  'Je n’ai jamais fait semblant de ne pas avoir vu un message.',
]

const TU_PREFERES_AMIS = [
  'Tu préfères perdre ton téléphone pendant une semaine ou ne plus utiliser les réseaux sociaux pendant un mois ?',
  'Tu préfères avoir toujours 30 minutes d’avance ou toujours 10 minutes de retard ?',
  'Tu préfères voyager gratuitement partout ou manger gratuitement dans tous les restaurants ?',
  'Tu préfères savoir chanter parfaitement ou danser parfaitement ?',
  'Tu préfères recevoir 1 million maintenant ou 100 000 chaque année pendant 15 ans ?',
  'Tu préfères vivre sans musique ou sans films et séries ?',
  'Tu préfères pouvoir lire les pensées ou devenir invisible pendant une heure par jour ?',
  'Tu préfères une grande fête avec tous tes amis ou un voyage avec trois personnes proches ?',
]

const QUI_DE_NOUS = [
  'Qui de nous répond le plus vite aux messages ?',
  'Qui de nous peut le plus facilement oublier où il a posé son téléphone ?',
  'Qui de nous est le plus susceptible de devenir célèbre ?',
  'Qui de nous dépense le plus facilement son argent ?',
  'Qui de nous rigole le plus pour rien ?',
  'Qui de nous est le plus jaloux de son sommeil ?',
  'Qui de nous survivrait le mieux une semaine sans Internet ?',
  'Qui de nous ferait le meilleur animateur de soirée ?',
  'Qui de nous tomberait amoureux le plus vite ?',
  'Qui de nous garderait un secret le plus longtemps ?',
]

const CAP_OU_PAS_CAP = [
  'Cap ou pas cap d’envoyer un vocal de 10 secondes sans préparer ce que tu vas dire ?',
  'Cap ou pas cap de laisser le chat choisir ton prochain statut WhatsApp pendant 5 minutes ?',
  'Cap ou pas cap de faire un compliment à chaque personne qui joue ?',
  'Cap ou pas cap d’écrire ton prochain message les yeux fermés ?',
  'Cap ou pas cap de raconter ton moment le plus drôle de la semaine ?',
  'Cap ou pas cap de parler pendant 15 secondes sans utiliser le mot « je » ?',
  'Cap ou pas cap de décrire ton humeur actuelle avec seulement trois emojis ?',
  'Cap ou pas cap de donner une note sur 10 à ta journée et expliquer pourquoi ?',
]

const SEPT_SECONDES = [
  'Tu as 7 secondes : cite 3 pays africains.',
  'Tu as 7 secondes : cite 3 plats que tu pourrais manger maintenant.',
  'Tu as 7 secondes : cite 3 artistes que tu écoutes souvent.',
  'Tu as 7 secondes : cite 3 choses que tu emporterais en voyage.',
  'Tu as 7 secondes : cite 3 qualités que tu apprécies chez un ami.',
  'Tu as 7 secondes : cite 3 applications que tu utilises presque tous les jours.',
  'Tu as 7 secondes : cite 3 villes que tu aimerais visiter.',
  'Tu as 7 secondes : cite 3 choses qui peuvent te mettre de bonne humeur.',
]

const CHAISE_CHAUDE = [
  'Quel est ton plus grand objectif pour cette année ?',
  'Quelle qualité chez une personne te donne immédiatement confiance ?',
  'Quel souvenir te fait rire à chaque fois que tu y repenses ?',
  'Quelle chose aimerais-tu apprendre si tu avais tout le temps nécessaire ?',
  'Quel est le meilleur conseil qu’on t’ait donné ?',
  'Quel type de message te fait toujours plaisir à recevoir ?',
  'Si tu pouvais revivre une seule journée, laquelle choisirais-tu ?',
  'Quelle petite chose peut complètement améliorer ta journée ?',
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
    name: 'tupreferescouple',
    description: 'Lance une question Tu préfères spécialement pensée pour un couple.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`💞 *TU PRÉFÈRES - COUPLE*\n${TU_PREFERES_COUPLE[randomInt(0, TU_PREFERES_COUPLE.length)]}`)
    },
  },
  {
    name: 'souvenircouple',
    description: 'Propose un souvenir à raconter ou comparer à deux.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`📸 *SOUVENIR COUPLE*\n${SOUVENIRS_COUPLE[randomInt(0, SOUVENIRS_COUPLE.length)]}`)
    },
  },
  {
    name: 'deficouple',
    description: 'Donne un petit défi complice à faire à deux.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`💗 *DÉFI COUPLE*\n${DEFIS_COUPLE[randomInt(0, DEFIS_COUPLE.length)]}`)
    },
  },
  {
    name: 'quizcouple',
    description: 'Pose une question pour tester à quel point vous vous connaissez.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`🧩 *QUIZ COUPLE*\n${QUIZ_COUPLE[randomInt(0, QUIZ_COUPLE.length)]}`)
    },
  },
  {
    name: 'action',
    aliases: ['defiaction'],
    description: 'Donne une action amusante à réaliser avec sa copine ou ses amis.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`🔥 *ACTION*\n${ACTIONS[randomInt(0, ACTIONS.length)]}`)
    },
  },
  {
    name: 'actionouverite',
    aliases: ['aov'],
    description: 'Lance Action ou Vérité, au choix ou au hasard.',
    usage: '[action|verite]',
    category: 'Jeux',
    async execute(ctx) {
      const requested = ctx.args[0]?.toLowerCase()
      if (requested && requested !== 'action' && requested !== 'verite') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}actionouverite [action|verite]`))
      }
      const mode = requested ?? (randomInt(0, 2) === 0 ? 'action' : 'verite')
      if (mode === 'action') {
        return void (await ctx.reply(`🔥 *ACTION*\n${ACTIONS[randomInt(0, ACTIONS.length)]}`))
      }
      await ctx.reply(`🤭 *VÉRITÉ*\n${VERITES[randomInt(0, VERITES.length)]}`)
    },
  },
  {
    name: 'jenaijamais',
    aliases: ['jamais'],
    description: 'Lance une phrase Je n’ai jamais pour jouer en couple ou entre amis.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`🙈 *JE N’AI JAMAIS*\n${JE_NAI_JAMAIS[randomInt(0, JE_NAI_JAMAIS.length)]}`)
    },
  },
  {
    name: 'tupreferes',
    aliases: ['tupreferesamis'],
    description: 'Lance un dilemme Tu préfères pour jouer entre amis ou en couple.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`⚖️ *TU PRÉFÈRES*\n${TU_PREFERES_AMIS[randomInt(0, TU_PREFERES_AMIS.length)]}`)
    },
  },
  {
    name: 'quidenous',
    aliases: ['quideux'],
    description: 'Pose une question Qui de nous pour comparer les joueurs.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`👀 *QUI DE NOUS ?*\n${QUI_DE_NOUS[randomInt(0, QUI_DE_NOUS.length)]}`)
    },
  },
  {
    name: 'capoupascap',
    aliases: ['cap'],
    description: 'Lance un défi Cap ou pas cap léger et amusant.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`😎 *CAP OU PAS CAP ?*\n${CAP_OU_PAS_CAP[randomInt(0, CAP_OU_PAS_CAP.length)]}`)
    },
  },
  {
    name: 'septsecondes',
    aliases: ['7secondes'],
    description: 'Donne un défi à réaliser en sept secondes.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`⏱️ *7 SECONDES*\n${SEPT_SECONDES[randomInt(0, SEPT_SECONDES.length)]}`)
    },
  },
  {
    name: 'chaisechaude',
    aliases: ['chaise'],
    description: 'Pose une question de chaise chaude pour mieux connaître les joueurs.',
    category: 'Jeux',
    async execute(ctx) {
      await ctx.reply(`🔥🪑 *CHAISE CHAUDE*\n${CHAISE_CHAUDE[randomInt(0, CHAISE_CHAUDE.length)]}`)
    },
  },
  {
    name: 'bouteille',
    aliases: ['tournerbouteille'],
    description: 'Tourne la bouteille dans un groupe et désigne un membre avec une action ou une vérité.',
    category: 'Jeux',
    groupOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const participants = (ctx.groupMetadata?.participants ?? [])
        .map((participant) => participant.id)
        .filter((jid) => !sameUser(jid, ctx.sock.user?.id))
      if (!participants.length) return void (await ctx.reply('Aucun joueur disponible dans ce groupe.'))
      const target = participants[randomInt(0, participants.length)]!
      const isAction = randomInt(0, 2) === 0
      const prompt = isAction
        ? `🔥 *ACTION*\n${ACTIONS[randomInt(0, ACTIONS.length)]}`
        : `🤭 *VÉRITÉ*\n${VERITES[randomInt(0, VERITES.length)]}`
      await ctx.reply(`🍾 *LA BOUTEILLE A CHOISI* ${jidToMention(target)} !\n\n${prompt}`, [target])
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
