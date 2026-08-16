import { randomUUID } from 'node:crypto'
import type { AutomationScope, ScheduledJob, SupportTicket, TicketPriority, TicketStatus } from '../core/database.js'
import { DEFAULT_AUTOMATION } from '../core/database.js'
import { AiService } from '../core/ai.js'
import type { BotCommand, CommandContext } from '../types.js'
import { brandedPanel, signText } from '../utils/brand.js'
import { normalizeWords } from '../utils/text.js'

const SCOPES = new Set<AutomationScope>(['prive', 'groupe', 'tous'])
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const TICKET_PRIORITIES = new Set<TicketPriority>(['basse', 'normale', 'haute', 'urgente'])

function shortId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 8)
}

function normalizeTrigger(value: string): string {
  return normalizeWords(value).join(' ')
}

function splitAtPipe(value: string): [string, string] | undefined {
  const separator = value.indexOf('|')
  if (separator === -1) return undefined
  const left = value.slice(0, separator).trim()
  const right = value.slice(separator + 1).trim()
  return left && right ? [left, right] : undefined
}

function canManageChatAutomation(ctx: CommandContext): boolean {
  return ctx.isOwner || (ctx.isGroup && ctx.isAdmin)
}

function ticketLabel(ticket: SupportTicket): string {
  const contact = ticket.createdBy.split('@')[0] ?? ticket.createdBy
  return `#${ticket.id} • ${ticket.priority} • ${ticket.status}\n↳ ${ticket.subject}\n↳ Client : ${contact}`
}

function parseSchedule(specification: string): { date: Date; repeat: ScheduledJob['repeat'] } | undefined {
  const daily = specification.match(/^quotidien\s+((?:[01]\d|2[0-3]):[0-5]\d)$/i)
  if (daily?.[1]) {
    const [hour = 0, minute = 0] = daily[1].split(':').map(Number)
    const date = new Date()
    date.setHours(hour, minute, 0, 0)
    if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1)
    return { date, repeat: 'quotidien' }
  }

  const delay = specification.match(/^(\d{1,5})(s|min|m|h|j)$/i)
  if (delay?.[1] && delay[2]) {
    const value = Number(delay[1])
    const unit = delay[2].toLowerCase()
    const factor = unit === 's' ? 1_000 : unit === 'min' || unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
    const milliseconds = value * factor
    if (milliseconds < 10_000 || milliseconds > 365 * 86_400_000) return undefined
    return { date: new Date(Date.now() + milliseconds), repeat: 'aucune' }
  }

  const absolute = specification.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (absolute) {
    const [, year, month, day, hour, minute] = absolute
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0)
    const exact =
      date.getFullYear() === Number(year) &&
      date.getMonth() === Number(month) - 1 &&
      date.getDate() === Number(day) &&
      date.getHours() === Number(hour) &&
      date.getMinutes() === Number(minute)
    if (exact && date.getTime() > Date.now()) return { date, repeat: 'aucune' }
  }
  return undefined
}

export const automationCommands: BotCommand[] = [
  {
    name: 'autoreponse',
    aliases: ['reponseauto'],
    description: 'Gère les réponses automatiques par mot-clé.',
    usage: 'activer|desactiver|ajouter|retirer|liste',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'activer' || action === 'desactiver') {
        await ctx.db.mutateAutomation((settings) => {
          settings.autoRepliesEnabled = action === 'activer'
        })
        await ctx.reply(`Réponses automatiques *${action === 'activer' ? 'activées' : 'désactivées'}*.`)
        return
      }
      if (action === 'liste') {
        const settings = ctx.db.getAutomation()
        const lines = settings.autoReplies.map(
          (rule) => `#${rule.id} • ${rule.scope} • ${rule.match} • “${rule.trigger}” → ${rule.response}`,
        )
        await ctx.reply(lines.length ? `*RÉPONSES AUTOMATIQUES*\n${lines.join('\n')}` : 'Aucune réponse automatique.')
        return
      }
      if (action === 'retirer') {
        const id = ctx.args[1]
        if (!id) return void (await ctx.reply(`Utilisation : ${ctx.prefix}autoreponse retirer identifiant`))
        let removed = false
        await ctx.db.mutateAutomation((settings) => {
          const before = settings.autoReplies.length
          settings.autoReplies = settings.autoReplies.filter((rule) => rule.id !== id)
          removed = settings.autoReplies.length < before
        })
        await ctx.reply(removed ? 'Réponse automatique retirée.' : 'Identifiant introuvable.')
        return
      }
      if (action === 'ajouter') {
        const pair = splitAtPipe(ctx.args.slice(1).join(' '))
        if (!pair) {
          return void (await ctx.reply(
            `Utilisation : ${ctx.prefix}autoreponse ajouter prive bonjour | Bonjour, comment puis-je vous aider ?`,
          ))
        }
        const [left, response] = pair
        const tokens = left.split(/\s+/)
        const scope = tokens.shift()?.toLowerCase() as AutomationScope | undefined
        let match: 'contient' | 'exact' = 'contient'
        if (tokens[0]?.toLowerCase() === 'exact') {
          match = 'exact'
          tokens.shift()
        }
        const trigger = normalizeTrigger(tokens.join(' '))
        if (!scope || !SCOPES.has(scope) || !trigger) {
          return void (await ctx.reply('Portée invalide. Utilise prive, groupe ou tous, puis un déclencheur.'))
        }
        const rule = { id: shortId(), scope, match, trigger, response: response.slice(0, 2_000) }
        await ctx.db.mutateAutomation((settings) => {
          settings.autoReplies.push(rule)
        })
        await ctx.reply(`Réponse automatique créée : *#${rule.id}*. Active le module avec ${ctx.prefix}autoreponse activer.`)
        return
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}autoreponse activer|desactiver|ajouter|retirer|liste`)
    },
  },
  {
    name: 'absence',
    description: 'Active un message automatique d’absence dans les conversations privées.',
    usage: 'activer [message]|desactiver|statut',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'statut') {
        const away = ctx.db.getAutomation().away
        await ctx.reply(`Absence : *${away.enabled ? 'activée' : 'désactivée'}*\nMessage : ${away.message}`)
        return
      }
      if (action === 'desactiver') {
        await ctx.db.mutateAutomation((settings) => {
          settings.away.enabled = false
        })
        await ctx.reply('Mode absence désactivé.')
        return
      }
      if (action === 'activer') {
        const message = ctx.args.slice(1).join(' ').trim()
        await ctx.db.mutateAutomation((settings) => {
          settings.away.enabled = true
          if (message) settings.away.message = message.slice(0, 2_000)
        })
        await ctx.reply('Mode absence activé. Un même contact reçoit le message au maximum une fois toutes les 12 heures.')
        return
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}absence activer Je reviens bientôt`)
    },
  },
  {
    name: 'horaires',
    aliases: ['heuresouverture'],
    description: 'Configure la réponse envoyée en dehors des heures d’ouverture.',
    usage: 'definir 08:00 18:00 | message',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const current = ctx.db.getAutomation().businessHours
      if (action === 'statut') {
        await ctx.reply(
          `Horaires automatiques : *${current.enabled ? 'activés' : 'désactivés'}*\nOuverture : ${current.start}\nFermeture : ${current.end}\nFuseau : ${ctx.config.timezone}\nMessage : ${current.message}`,
        )
        return
      }
      if (action === 'activer' || action === 'desactiver') {
        await ctx.db.mutateAutomation((settings) => {
          settings.businessHours.enabled = action === 'activer'
        })
        await ctx.reply(`Réponse hors horaires *${action === 'activer' ? 'activée' : 'désactivée'}*.`)
        return
      }
      if (action === 'definir') {
        const pair = splitAtPipe(ctx.args.slice(1).join(' '))
        const [times = '', message = ''] = pair ?? []
        const [start, end] = times.split(/\s+/)
        if (!start || !end || !TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || !message) {
          return void (await ctx.reply(
            `Utilisation : ${ctx.prefix}horaires definir 08:00 18:00 | Nous sommes fermés, à bientôt.`,
          ))
        }
        await ctx.db.mutateAutomation((settings) => {
          settings.businessHours.start = start
          settings.businessHours.end = end
          settings.businessHours.message = message.slice(0, 2_000)
        })
        await ctx.reply(`Horaires enregistrés : ${start} → ${end}. Lance ${ctx.prefix}horaires activer.`)
        return
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}horaires definir|activer|desactiver|statut`)
    },
  },
  {
    name: 'reactionauto',
    aliases: ['reactionautomatique'],
    description: 'Réagit automatiquement à certains mots.',
    usage: 'activer|desactiver|ajouter|retirer|liste',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'activer' || action === 'desactiver') {
        await ctx.db.mutateAutomation((settings) => {
          settings.autoReactionsEnabled = action === 'activer'
        })
        await ctx.reply(`Réactions automatiques *${action === 'activer' ? 'activées' : 'désactivées'}*.`)
        return
      }
      if (action === 'liste') {
        const rules = ctx.db.getAutomation().reactions
        await ctx.reply(
          rules.length
            ? rules.map((rule) => `#${rule.id} • ${rule.scope} • “${rule.trigger}” → ${rule.emoji}`).join('\n')
            : 'Aucune réaction automatique.',
        )
        return
      }
      if (action === 'retirer') {
        const id = ctx.args[1]
        let removed = false
        await ctx.db.mutateAutomation((settings) => {
          const before = settings.reactions.length
          settings.reactions = settings.reactions.filter((rule) => rule.id !== id)
          removed = settings.reactions.length < before
        })
        await ctx.reply(removed ? 'Réaction retirée.' : 'Identifiant introuvable.')
        return
      }
      if (action === 'ajouter') {
        const pair = splitAtPipe(ctx.args.slice(1).join(' '))
        if (!pair) {
          return void (await ctx.reply(`Utilisation : ${ctx.prefix}reactionauto ajouter tous merci | ❤️`))
        }
        const [left, emoji] = pair
        const tokens = left.split(/\s+/)
        const scope = tokens.shift()?.toLowerCase() as AutomationScope | undefined
        const trigger = normalizeTrigger(tokens.join(' '))
        if (!scope || !SCOPES.has(scope) || !trigger || emoji.length > 16) {
          return void (await ctx.reply('Portée, mot ou emoji invalide.'))
        }
        const rule = { id: shortId(), scope, trigger, emoji }
        await ctx.db.mutateAutomation((settings) => settings.reactions.push(rule))
        await ctx.reply(`Réaction automatique créée : *#${rule.id}*.`)
        return
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}reactionauto activer|desactiver|ajouter|retirer|liste`)
    },
  },
  {
    name: 'programmer',
    aliases: ['rappel'],
    description: 'Programme un message dans le chat actuel, une seule fois ou chaque jour.',
    usage: '10min | message',
    category: 'Automatisation',
    async execute(ctx) {
      if (!canManageChatAutomation(ctx)) {
        return void (await ctx.reply('Seul le propriétaire, ou un administrateur dans un groupe, peut programmer ici.'))
      }
      const pair = splitAtPipe(ctx.argText)
      if (!pair) {
        return void (await ctx.reply(
          `Exemples :\n${ctx.prefix}programmer 10min | Vérifier la commande\n${ctx.prefix}programmer quotidien 08:00 | Bonjour à tous`,
        ))
      }
      const [specification, message] = pair
      const schedule = parseSchedule(specification)
      if (!schedule) {
        return void (await ctx.reply('Date invalide. Formats : 10min, 2h, 1j, 2026-08-20 14:30 ou quotidien 08:00.'))
      }
      const pending = ctx.db
        .listSchedules(ctx.sender)
        .filter((job) => job.status === 'en_attente' || job.status === 'en_cours').length
      if (pending >= 20 && !ctx.isOwner) return void (await ctx.reply('Limite de 20 programmes actifs atteinte.'))
      const job: ScheduledJob = {
        id: shortId(),
        sessionName: ctx.sessionName,
        chatId: ctx.chatId,
        createdBy: ctx.sender,
        message: message.slice(0, 4_000),
        nextRunAt: schedule.date.toISOString(),
        repeat: schedule.repeat,
        status: 'en_attente',
        createdAt: new Date().toISOString(),
        claimedAt: null,
        lastError: null,
      }
      await ctx.db.addSchedule(job)
      await ctx.reply(
        `Programme *#${job.id}* créé pour ${schedule.date.toLocaleString('fr-FR', { timeZone: ctx.config.timezone })}${job.repeat === 'quotidien' ? ' puis chaque jour' : ''}.`,
      )
    },
  },
  {
    name: 'programmes',
    aliases: ['rappels'],
    description: 'Affiche les messages programmés.',
    category: 'Automatisation',
    async execute(ctx) {
      const jobs = ctx.db
        .listSchedules(ctx.isOwner ? undefined : ctx.sender)
        .filter((job) => ['en_attente', 'en_cours'].includes(job.status))
        .slice(0, 20)
      if (!jobs.length) return void (await ctx.reply('Aucun message programmé actif.'))
      await ctx.reply(
        `*MESSAGES PROGRAMMÉS*\n${jobs
          .map(
            (job) =>
              `#${job.id} • ${new Date(job.nextRunAt).toLocaleString('fr-FR', { timeZone: ctx.config.timezone })} • ${job.repeat}\n↳ ${job.message.slice(0, 100)}`,
          )
          .join('\n')}`,
      )
    },
  },
  {
    name: 'annulerprogramme',
    aliases: ['annulerrappel'],
    description: 'Annule un message programmé.',
    usage: '<identifiant>',
    category: 'Automatisation',
    async execute(ctx) {
      const id = ctx.args[0]
      if (!id) return void (await ctx.reply(`Utilisation : ${ctx.prefix}annulerprogramme identifiant`))
      const cancelled = await ctx.db.cancelSchedule(id, ctx.sender, ctx.isOwner)
      await ctx.reply(cancelled ? 'Programme annulé.' : 'Programme introuvable ou déjà exécuté.')
    },
  },
  {
    name: 'faq',
    aliases: ['questions'],
    description: 'Consulte ou administre la foire aux questions.',
    usage: 'liste|mot-clé',
    category: 'Automatisation',
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getAutomation()
      if (action === 'liste') {
        const keys = Object.keys(settings.faq)
        await ctx.reply(keys.length ? `Questions disponibles : ${keys.join(', ')}` : 'La FAQ est vide.')
        return
      }
      if (action === 'ajouter') {
        if (!ctx.isOwner) return void (await ctx.reply('Cette action est réservée au propriétaire.'))
        const pair = splitAtPipe(ctx.args.slice(1).join(' '))
        if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}faq ajouter livraison | Livraison sous 24 h.`))
        const [rawKey, response] = pair
        const key = normalizeTrigger(rawKey)
        if (!key) return void (await ctx.reply('Mot-clé invalide.'))
        await ctx.db.mutateAutomation((automation) => {
          automation.faq[key] = response.slice(0, 2_000)
        })
        await ctx.reply(`Entrée FAQ *${key}* enregistrée.`)
        return
      }
      if (action === 'retirer') {
        if (!ctx.isOwner) return void (await ctx.reply('Cette action est réservée au propriétaire.'))
        const key = normalizeTrigger(ctx.args.slice(1).join(' '))
        await ctx.db.mutateAutomation((automation) => {
          delete automation.faq[key]
        })
        await ctx.reply(`Entrée FAQ *${key}* retirée.`)
        return
      }
      const key = normalizeTrigger(ctx.argText)
      const answer = settings.faq[key]
      await ctx.reply(answer ?? `Question introuvable. Tape ${ctx.prefix}faq liste.`)
    },
  },
  {
    name: 'note',
    aliases: ['blocnotes'],
    description: 'Enregistre des notes privées du propriétaire.',
    usage: 'ajouter nom | texte',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getAutomation()
      if (action === 'liste') {
        const names = Object.keys(settings.notes)
        await ctx.reply(names.length ? `Notes : ${names.join(', ')}` : 'Aucune note enregistrée.')
        return
      }
      if (action === 'ajouter') {
        const pair = splitAtPipe(ctx.args.slice(1).join(' '))
        if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}note ajouter stock | Vérifier lundi`))
        const [rawName, text] = pair
        const name = normalizeTrigger(rawName)
        await ctx.db.mutateAutomation((automation) => {
          automation.notes[name] = text.slice(0, 4_000)
        })
        await ctx.reply(`Note *${name}* enregistrée.`)
        return
      }
      if (action === 'retirer') {
        const name = normalizeTrigger(ctx.args.slice(1).join(' '))
        await ctx.db.mutateAutomation((automation) => delete automation.notes[name])
        await ctx.reply(`Note *${name}* retirée.`)
        return
      }
      const name = normalizeTrigger(ctx.argText)
      await ctx.reply(settings.notes[name] ?? `Note introuvable. Tape ${ctx.prefix}note liste.`)
    },
  },
  {
    name: 'raccourci',
    aliases: ['reponserapide'],
    description: 'Enregistre et envoie des réponses rapides.',
    usage: 'ajouter nom | réponse',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getAutomation()
      if (action === 'liste') {
        const names = Object.keys(settings.shortcuts)
        await ctx.reply(names.length ? `Raccourcis : ${names.join(', ')}` : 'Aucun raccourci enregistré.')
        return
      }
      if (action === 'ajouter') {
        const pair = splitAtPipe(ctx.args.slice(1).join(' '))
        if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}raccourci ajouter prix | Voici nos tarifs…`))
        const [rawName, text] = pair
        const name = normalizeTrigger(rawName)
        await ctx.db.mutateAutomation((automation) => {
          automation.shortcuts[name] = text.slice(0, 4_000)
        })
        await ctx.reply(`Raccourci *${name}* enregistré.`)
        return
      }
      if (action === 'retirer') {
        const name = normalizeTrigger(ctx.args.slice(1).join(' '))
        await ctx.db.mutateAutomation((automation) => delete automation.shortcuts[name])
        await ctx.reply(`Raccourci *${name}* retiré.`)
        return
      }
      const name = normalizeTrigger(ctx.argText)
      await ctx.reply(settings.shortcuts[name] ?? `Raccourci introuvable. Tape ${ctx.prefix}raccourci liste.`)
    },
  },
  {
    name: 'annonce',
    description: 'Publie une annonce mise en forme dans le groupe.',
    usage: '<texte>',
    category: 'Automatisation',
    groupOnly: true,
    adminOnly: true,
    cooldownSeconds: 10,
    async execute(ctx) {
      if (!ctx.argText) return void (await ctx.reply(`Utilisation : ${ctx.prefix}annonce Réunion demain à 10 h`))
      await ctx.send({ text: brandedPanel('ANNONCE OFFICIELLE', ctx.argText.split('\n'), ctx.config) })
    },
  },
  {
    name: 'sondage',
    description: 'Crée un sondage WhatsApp dans le groupe.',
    usage: 'Question | Choix 1 | Choix 2',
    category: 'Automatisation',
    groupOnly: true,
    adminOnly: true,
    cooldownSeconds: 15,
    async execute(ctx) {
      const parts = ctx.argText.split('|').map((part) => part.trim()).filter(Boolean)
      const [question, ...choices] = parts
      if (!question || choices.length < 2 || choices.length > 12) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}sondage On se réunit quand ? | Lundi | Mardi`))
      }
      await ctx.send({ poll: { name: `${question}\n\n✦ BY ${ctx.config.signature}`, values: choices, selectableCount: 1 } })
    },
  },
  {
    name: 'serviceclientia',
    aliases: ['reponseclientia', 'clientia'],
    description: 'Active ou configure les réponses IA automatiques aux clients privés.',
    usage: 'activer|desactiver|statut|consigne <texte>|reinitialiser',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'statut') {
        const settings = ctx.db.getAutomation().customerAi
        const ai = new AiService(ctx.config).status()
        return void (await ctx.reply(
          `Service client IA : *${settings.enabled ? 'activé' : 'désactivé'}*\nFournisseur texte : *${ai.configured ? 'configuré' : 'non configuré'}* (${ai.provider} / ${ai.model})\nConsigne : ${settings.instructions}`,
        ))
      }
      if (action === 'activer') {
        if (!new AiService(ctx.config).isConfigured()) {
          return void (await ctx.reply('L’assistant IA n’est pas configuré. Vérifie la configuration IA de Bestla, puis réessaie.'))
        }
        await ctx.db.mutateAutomation((settings) => { settings.customerAi.enabled = true })
        return void (await ctx.reply('Service client IA *activé*. Il répond automatiquement, poliment et uniquement dans les conversations privées.'))
      }
      if (action === 'desactiver') {
        await ctx.db.mutateAutomation((settings) => { settings.customerAi.enabled = false })
        return void (await ctx.reply('Service client IA *désactivé*.'))
      }
      if (action === 'consigne') {
        const instructions = ctx.args.slice(1).join(' ').trim()
        if (!instructions) return void (await ctx.reply(`Utilisation : ${ctx.prefix}serviceclientia consigne Réponds avec un ton professionnel et chaleureux.`))
        await ctx.db.mutateAutomation((settings) => { settings.customerAi.instructions = instructions.slice(0, 2_000) })
        return void (await ctx.reply('Consigne du service client IA mise à jour.'))
      }
      if (action === 'reinitialiser') {
        await ctx.db.mutateAutomation((settings) => { settings.customerAi.instructions = DEFAULT_AUTOMATION.customerAi.instructions })
        return void (await ctx.reply('Consigne du service client IA réinitialisée.'))
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}serviceclientia activer|desactiver|statut|consigne|reinitialiser`)
    },
  },
  {
    name: 'assistantauto',
    aliases: ['iaauto', 'assistantclient'],
    description: 'Active ou désactive l’assistant IA automatique pour les messages privés entrants.',
    usage: 'activer|desactiver|statut|consigne <texte>|reinitialiser',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getAutomation().customerAi
      if (action === 'statut') {
        const ai = new AiService(ctx.config).status()
        return void (await ctx.reply(
          `Assistant IA automatique : *${settings.enabled ? 'activé' : 'désactivé'}*
Réponses : *messages privés entrants d’autres personnes uniquement*
Fournisseur : *${ai.configured ? 'configuré' : 'non configuré'}* (${ai.provider} / ${ai.model})
Protection : *messages privés entrants uniquement • 1 réponse toutes les 20 s • transfert humain automatique*
Consigne : ${settings.instructions}`,
        ))
      }
      if (action === 'activer') {
        if (!new AiService(ctx.config).isConfigured()) {
          return void (await ctx.reply('L’assistant IA n’est pas configuré. Vérifie la configuration IA de Bestla, puis réessaie.'))
        }
        await ctx.db.mutateAutomation((automation) => { automation.customerAi.enabled = true })
        return void (await ctx.reply(
          `🤖 Assistant IA automatique *activé*.
Il répond aux personnes qui t’écrivent en privé, sans démarchage, sans envoi massif et sans intervenir dans les groupes.
Pour tester : fais écrire le bot par un autre numéro en message privé. Tes propres messages et les groupes sont ignorés volontairement.`,
        ))
      }
      if (action === 'desactiver') {
        await ctx.db.mutateAutomation((automation) => { automation.customerAi.enabled = false })
        return void (await ctx.reply('🤖 Assistant IA automatique *désactivé*.'))
      }
      if (action === 'consigne') {
        const instructions = ctx.args.slice(1).join(' ').trim()
        if (!instructions) {
          return void (await ctx.reply(`Utilisation : ${ctx.prefix}assistantauto consigne Réponds poliment, brièvement et professionnellement.`))
        }
        await ctx.db.mutateAutomation((automation) => { automation.customerAi.instructions = instructions.slice(0, 2_000) })
        return void (await ctx.reply('✅ Consigne de l’assistant automatique mise à jour.'))
      }
      if (action === 'reinitialiser') {
        await ctx.db.mutateAutomation((automation) => { automation.customerAi.instructions = DEFAULT_AUTOMATION.customerAi.instructions })
        return void (await ctx.reply('✅ Consigne de l’assistant automatique réinitialisée.'))
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}assistantauto activer|desactiver|statut|consigne <texte>|reinitialiser`)
    },
  },
  {
    name: 'attentes',
    aliases: ['clientsattente', 'fileattente'],
    description: 'Liste les clients transmis automatiquement au propriétaire par l’assistant IA.',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      if (ctx.isGroup) return void (await ctx.reply('Consulte la file d’attente dans une conversation privée avec Bestla iA.'))
      const tickets = ctx.db
        .listTickets({ status: 'ouvert' })
        .filter((ticket) => ticket.subject.startsWith('[IA] '))
        .slice(0, 25)
      await ctx.reply(
        tickets.length
          ? `*CLIENTS EN ATTENTE*\n\n${tickets.map(ticketLabel).join('\n\n')}\n\nPour reprendre : ${ctx.prefix}reprendreclient ID | message`
          : 'Aucun client n’est actuellement en attente de reprise humaine.',
      )
    },
  },
  {
    name: 'reprendreclient',
    aliases: ['repriseclient', 'repondreattente'],
    description: 'Répond à un client mis en attente par l’assistant IA puis clôture son attente.',
    usage: '<id> | <message>',
    category: 'Automatisation',
    ownerOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      if (ctx.isGroup) return void (await ctx.reply('Reprends un client depuis une conversation privée avec Bestla iA.'))
      const pair = splitAtPipe(ctx.argText)
      if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}reprendreclient tk12345678 | Bonjour, je reprends personnellement votre demande.`))
      const [id, response] = pair
      const ticket = ctx.db.getTicket(id)
      if (!ticket || !ticket.subject.startsWith('[IA] ')) return void (await ctx.reply('Client en attente introuvable.'))
      if (ticket.status !== 'ouvert') return void (await ctx.reply('Cette attente est déjà clôturée.'))
      if (ticket.sessionName !== ctx.sessionName) {
        return void (await ctx.reply(`Cette attente appartient à la session *${ticket.sessionName}*. Utilise cette session pour répondre.`))
      }
      await ctx.sock.sendMessage(ticket.chatId, {
        text: signText(`👤 Le responsable reprend maintenant la conversation.\n\n${response.slice(0, 3_500)}`, ctx.config),
      })
      await ctx.db.updateTicket(ticket.id, { status: 'ferme' })
      await ctx.reply(`✅ Client repris et attente *#${ticket.id}* clôturée.`)
    },
  },
  {
    name: 'etatautomatisation',
    aliases: ['tableauautomatisation'],
    description: 'Affiche un résumé de toutes les automatisations.',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const settings = ctx.db.getAutomation()
      const pending = ctx.db.listSchedules().filter((job) => job.status === 'en_attente').length
      const openTickets = ctx.db.listTickets({ status: 'ouvert' }).length
      await ctx.reply(
        brandedPanel(
          'TABLEAU D’AUTOMATISATION',
          [
            `Réponses automatiques : ${settings.autoRepliesEnabled ? '✅' : '❌'} (${settings.autoReplies.length})`,
            `Absence : ${settings.away.enabled ? '✅' : '❌'}`,
            `Hors horaires : ${settings.businessHours.enabled ? '✅' : '❌'}`,
            `Réactions : ${settings.autoReactionsEnabled ? '✅' : '❌'} (${settings.reactions.length})`,
            `Service client IA : ${settings.customerAi.enabled ? '✅' : '❌'}`,
            `FAQ : ${Object.keys(settings.faq).length}`,
            `Notes : ${Object.keys(settings.notes).length}`,
            `Raccourcis : ${Object.keys(settings.shortcuts).length}`,
            `Programmes actifs : ${pending}`,
            `Tickets ouverts : ${openTickets}`,
          ],
          ctx.config,
        ),
      )
    },
  },
  {
    name: 'ticket',
    aliases: ['support'],
    description: 'Ouvre et suit une demande d’assistance privée.',
    usage: 'ouvrir <sujet>|mes|voir <id>|fermer <id>',
    category: 'Automatisation',
    cooldownSeconds: 5,
    async execute(ctx) {
      if (ctx.isGroup) {
        return void (await ctx.reply('Pour protéger tes informations, utilise les tickets dans une conversation privée avec Bestla iA.'))
      }
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'ouvrir') {
        const subject = ctx.args.slice(1).join(' ').trim().slice(0, 500)
        if (!subject) return void (await ctx.reply(`Utilisation : ${ctx.prefix}ticket ouvrir Je souhaite un devis pour…`))
        const openTickets = ctx.db.listTickets({ createdBy: ctx.sender, status: 'ouvert' })
        if (openTickets.length >= 5) return void (await ctx.reply('Tu as déjà 5 tickets ouverts. Ferme-en un avant d’en créer un autre.'))
        const now = new Date().toISOString()
        const ticket: SupportTicket = {
          id: `tk${shortId()}`,
          sessionName: ctx.sessionName,
          chatId: ctx.chatId,
          createdBy: ctx.sender,
          subject,
          status: 'ouvert',
          priority: 'normale',
          createdAt: now,
          updatedAt: now,
        }
        await ctx.db.addTicket(ticket)
        await ctx.reply(`🎫 Ticket *#${ticket.id}* ouvert.\nSujet : ${ticket.subject}\n\nTu peux suivre tes demandes avec ${ctx.prefix}ticket mes.`)
        return
      }
      if (action === 'mes') {
        const tickets = ctx.db.listTickets({ createdBy: ctx.sender }).slice(0, 10)
        return void (await ctx.reply(tickets.length ? `*TES TICKETS*\n\n${tickets.map(ticketLabel).join('\n\n')}` : 'Tu n’as pas encore créé de ticket.'))
      }
      if (action === 'voir') {
        const id = ctx.args[1]
        const ticket = id ? ctx.db.getTicket(id) : undefined
        if (!ticket || ticket.createdBy !== ctx.sender) return void (await ctx.reply('Ticket introuvable.'))
        return void (await ctx.reply(`🎫 *TICKET #${ticket.id}*\n\nStatut : *${ticket.status}*\nPriorité : *${ticket.priority}*\nCréé : ${new Date(ticket.createdAt).toLocaleString('fr-FR', { timeZone: ctx.config.timezone })}\nSujet : ${ticket.subject}`))
      }
      if (action === 'fermer') {
        const id = ctx.args[1]
        const ticket = id ? ctx.db.getTicket(id) : undefined
        if (!ticket || ticket.createdBy !== ctx.sender) return void (await ctx.reply('Ticket introuvable.'))
        if (ticket.status === 'ferme') return void (await ctx.reply('Ce ticket est déjà fermé.'))
        await ctx.db.updateTicket(ticket.id, { status: 'ferme' })
        return void (await ctx.reply(`Ticket *#${ticket.id}* fermé. Merci pour ton retour.`))
      }
      await ctx.reply(`Utilisation :\n${ctx.prefix}ticket ouvrir Je souhaite un devis\n${ctx.prefix}ticket mes\n${ctx.prefix}ticket voir tk12345678\n${ctx.prefix}ticket fermer tk12345678`)
    },
  },
  {
    name: 'tickets',
    aliases: ['listetickets'],
    description: 'Affiche les tickets clients ouverts ou fermés.',
    usage: '[ouverts|fermes|tous]',
    category: 'Automatisation',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      if (ctx.isGroup) return void (await ctx.reply('Pour protéger les clients, consulte les tickets dans une conversation privée.'))
      const choice = ctx.args[0]?.toLowerCase() ?? 'ouverts'
      const status: TicketStatus | undefined = choice === 'ouverts' ? 'ouvert' : choice === 'fermes' ? 'ferme' : choice === 'tous' ? undefined : undefined
      if (!['ouverts', 'fermes', 'tous'].includes(choice)) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}tickets ouverts|fermes|tous`))
      }
      const tickets = ctx.db.listTickets(status ? { status } : {}).slice(0, 25)
      await ctx.reply(tickets.length ? `*TICKETS ${choice.toUpperCase()}*\n\n${tickets.map(ticketLabel).join('\n\n')}` : 'Aucun ticket correspondant.')
    },
  },
  {
    name: 'repondreticket',
    aliases: ['reponsesupport'],
    description: 'Envoie une réponse au client ayant ouvert un ticket.',
    usage: '<id> | <message>',
    category: 'Automatisation',
    ownerOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      if (ctx.isGroup) return void (await ctx.reply('Réponds aux tickets depuis une conversation privée avec Bestla iA.'))
      const pair = splitAtPipe(ctx.argText)
      if (!pair) return void (await ctx.reply(`Utilisation : ${ctx.prefix}repondreticket tk12345678 | Bonjour, votre devis est prêt.`))
      const [id, response] = pair
      const ticket = ctx.db.getTicket(id)
      if (!ticket) return void (await ctx.reply('Ticket introuvable.'))
      if (ticket.status !== 'ouvert') return void (await ctx.reply('Ce ticket est fermé. Rouvre un nouveau ticket si nécessaire.'))
      if (ticket.sessionName !== ctx.sessionName) {
        return void (await ctx.reply(`Ce ticket a été créé sur la session *${ticket.sessionName}*. Utilise cette session pour répondre.`))
      }
      await ctx.sock.sendMessage(ticket.chatId, {
        text: signText(`🎫 Réponse à ton ticket #${ticket.id}\n\n${response.slice(0, 3_500)}`, ctx.config),
      })
      await ctx.db.updateTicket(ticket.id, {})
      await ctx.reply(`Réponse envoyée pour le ticket *#${ticket.id}*.`)
    },
  },
  {
    name: 'prioriteticket',
    aliases: ['urgenceticket'],
    description: 'Change la priorité d’un ticket client.',
    usage: '<id> basse|normale|haute|urgente',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      if (ctx.isGroup) return void (await ctx.reply('Gère les tickets depuis une conversation privée.'))
      const id = ctx.args[0]
      const priority = ctx.args[1]?.toLowerCase() as TicketPriority | undefined
      if (!id || !priority || !TICKET_PRIORITIES.has(priority)) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}prioriteticket tk12345678 haute`))
      }
      const ticket = await ctx.db.updateTicket(id, { priority })
      await ctx.reply(ticket ? `Priorité du ticket *#${ticket.id}* : *${priority}*.` : 'Ticket introuvable.')
    },
  },
]
