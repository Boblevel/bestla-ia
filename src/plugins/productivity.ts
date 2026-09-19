import { randomUUID } from 'node:crypto'
import type { Appointment, KnowledgeEntry } from '../core/database.js'
import { AiService, AiServiceError } from '../core/ai.js'
import { changedMessages, type MessageHistoryRecord } from '../core/message-history.js'
import { getArchivedMedia, readArchivedMedia } from '../core/media-archive.js'
import type { BotCommand, CommandContext } from '../types.js'
import { downloadMedia, findMedia } from '../utils/message.js'

function shortId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 8)
}

function splitParts(value: string): string[] {
  return value.split('|').map((part) => part.trim())
}

function parseAppointmentDate(value: string): Date | undefined {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (!match) return undefined
  const [, year, month, day, hour, minute] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0)
  const exact =
    date.getFullYear() === Number(year)
    && date.getMonth() === Number(month) - 1
    && date.getDate() === Number(day)
    && date.getHours() === Number(hour)
    && date.getMinutes() === Number(minute)
  return exact && date.getTime() > Date.now() ? date : undefined
}

function appointmentLine(appointment: Appointment, timezone: string): string {
  const when = new Date(appointment.scheduledAt).toLocaleString('fr-FR', { timeZone: timezone })
  return `#${appointment.id} • ${when}\n↳ ${appointment.contact} - ${appointment.title}`
}

function knowledgeText(entries: KnowledgeEntry[]): string {
  return entries
    .slice(-40)
    .map((entry) => `- ${entry.label}: ${entry.content}`)
    .join('\n')
    .slice(0, 12_000)
}

async function sendOriginalMedia(ctx: CommandContext, record: MessageHistoryRecord): Promise<boolean> {
  if (!record.hasMedia) return false
  const archived = await getArchivedMedia(ctx.config, ctx.sessionName, record.id)
  if (!archived) return false
  const buffer = await readArchivedMedia(archived)
  if (archived.type === 'image') {
    await ctx.send({ image: buffer, ...(record.originalText ? { caption: record.originalText } : {}) })
  } else if (archived.type === 'video') {
    await ctx.send({ video: buffer, mimetype: archived.mimetype, ...(record.originalText ? { caption: record.originalText } : {}) })
  } else if (archived.type === 'audio') {
    await ctx.send({ audio: buffer, mimetype: archived.mimetype })
    if (record.originalText) await ctx.reply(record.originalText)
  } else if (archived.type === 'sticker') {
    await ctx.send({ sticker: buffer })
  } else {
    await ctx.send({ document: buffer, mimetype: archived.mimetype, fileName: archived.fileName })
    if (record.originalText) await ctx.reply(record.originalText)
  }
  return true
}

function originalSummary(record: MessageHistoryRecord, timezone: string): string {
  const change = record.changeKind === 'supprime' ? 'SUPPRIMÉ' : 'MODIFIÉ'
  const when = new Date(record.changedAt ?? record.receivedAt).toLocaleString('fr-FR', { timeZone: timezone })
  const author = record.sender.split('@')[0]?.split(':')[0] ?? record.sender
  const original = record.originalText || (record.hasMedia ? `[${record.messageType}]` : '(contenu vide)')
  const edited = record.changeKind === 'modifie' ? `\nNouveau contenu : ${record.editedText || '(vide)'}` : ''
  return `*ORIGINAL ${change}*\n#${record.id.slice(0, 12)} • ${when}\nAuteur : ${author}\nOriginal : ${original}${edited}`
}

export const productivityCommands: BotCommand[] = [
  {
    name: 'rendezvous',
    description: 'Ajoute, liste ou supprime des rendez-vous WhatsApp avec rappel automatique.',
    usage: 'ajouter AAAA-MM-JJ HH:MM | contact | objet',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase() ?? 'liste'
      if (action === 'liste') {
        const items = ctx.db
          .listAppointments(ctx.sessionName)
          .filter((appointment) => appointment.status === 'en_attente' || appointment.status === 'en_cours')
          .slice(0, 25)
        return void (await ctx.reply(
          items.length
            ? `*RENDEZ-VOUS*\n${items.map((appointment) => appointmentLine(appointment, ctx.config.timezone)).join('\n\n')}`
            : 'Aucun rendez-vous actif.',
        ))
      }
      if (action === 'supprimer') {
        const id = ctx.args[1]
        if (!id) return void (await ctx.reply(`Utilisation : ${ctx.prefix}rendezvous supprimer identifiant`))
        const cancelled = await ctx.db.cancelAppointment(id, ctx.sessionName, ctx.sender, true)
        return void (await ctx.reply(cancelled ? 'Rendez-vous supprimé.' : 'Rendez-vous introuvable ou déjà exécuté.'))
      }
      if (action !== 'ajouter') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}rendezvous ajouter 2026-09-20 14:30 | Client X | Appel de suivi`))
      }

      const [rawDate = '', contact = '', title = ''] = splitParts(ctx.args.slice(1).join(' '))
      const scheduledAt = parseAppointmentDate(rawDate)
      if (!scheduledAt || !contact || !title) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}rendezvous ajouter 2026-09-20 14:30 | Client X | Appel de suivi`))
      }
      const appointment: Appointment = {
        id: shortId(),
        sessionName: ctx.sessionName,
        chatId: ctx.chatId,
        createdBy: ctx.sender,
        title: title.slice(0, 500),
        contact: contact.slice(0, 200),
        scheduledAt: scheduledAt.toISOString(),
        status: 'en_attente',
        createdAt: new Date().toISOString(),
        claimedAt: null,
        lastError: null,
      }
      await ctx.db.addAppointment(appointment)
      await ctx.reply(`Rendez-vous *#${appointment.id}* enregistré pour ${scheduledAt.toLocaleString('fr-FR', { timeZone: ctx.config.timezone })}.`)
    },
  },
  {
    name: 'secretaire',
    description: 'Active le secrétaire personnel IA et l’interroge avec le contexte de cette session.',
    usage: 'activer|desactiver|statut|demander <question>',
    category: 'Automatisation',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase() ?? 'statut'
      const settings = ctx.db.getSessionAutomation(ctx.sessionName)
      if (action === 'activer' || action === 'desactiver') {
        await ctx.db.mutateSessionAutomation(ctx.sessionName, (current) => {
          current.secretary.enabled = action === 'activer'
        })
        return void (await ctx.reply(`Mode secrétaire personnel *${action === 'activer' ? 'activé' : 'désactivé'}* pour ce numéro Bestla.`))
      }
      if (action === 'statut') {
        const appointments = ctx.db.listAppointments(ctx.sessionName).filter((item) => item.status === 'en_attente').length
        return void (await ctx.reply(
          `Secrétaire personnel : *${settings.secretary.enabled ? 'activé' : 'désactivé'}*\nRendez-vous actifs : *${appointments}*\nConnaissances IA : *${settings.knowledge.length}*`,
        ))
      }

      const question = (action === 'demander' ? ctx.args.slice(1) : ctx.args).join(' ').trim()
      if (!settings.secretary.enabled) return void (await ctx.reply(`Active d’abord le mode avec ${ctx.prefix}secretaire activer.`))
      if (!question) return void (await ctx.reply(`Utilisation : ${ctx.prefix}secretaire demander Quels sont mes prochains rendez-vous ?`))

      const ai = new AiService(ctx.config)
      if (!ai.isConfigured()) return void (await ctx.reply('L’assistant IA n’est pas configuré.'))
      const appointments = ctx.db
        .listAppointments(ctx.sessionName)
        .filter((item) => item.status === 'en_attente')
        .slice(0, 20)
        .map((item) => appointmentLine(item, ctx.config.timezone))
        .join('\n')
      try {
        const answer = await ai.complete(
          settings.secretary.instructions,
          `Question : ${question}\n\nRendez-vous :\n${appointments || 'Aucun.'}\n\nBase de connaissances :\n${knowledgeText(settings.knowledge) || 'Vide.'}`,
          { maxOutputTokens: 900 },
        )
        await ctx.reply(answer)
      } catch (error) {
        await ctx.reply(error instanceof AiServiceError ? error.message : 'Le secrétaire IA n’a pas pu répondre.')
      }
    },
  },
  {
    name: 'connaissance',
    description: 'Ajoute du texte ou un média à la base de connaissances utilisée par l’assistant IA de cette session.',
    usage: 'ajouter nom | texte ; media nom ; liste ; retirer identifiant',
    category: 'IA',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase() ?? 'liste'
      const settings = ctx.db.getSessionAutomation(ctx.sessionName)
      if (action === 'liste') {
        const entries = settings.knowledge.slice(-50)
        return void (await ctx.reply(
          entries.length
            ? `*BASE DE CONNAISSANCES IA*\n${entries.map((entry) => `#${entry.id} • ${entry.kind} • ${entry.label}`).join('\n')}`
            : 'La base de connaissances IA de ce numéro est vide.',
        ))
      }
      if (action === 'retirer') {
        const id = ctx.args[1]?.trim()
        if (!id) return void (await ctx.reply(`Utilisation : ${ctx.prefix}connaissance retirer identifiant`))
        let removed = false
        await ctx.db.mutateSessionAutomation(ctx.sessionName, (current) => {
          const before = current.knowledge.length
          current.knowledge = current.knowledge.filter((entry) => entry.id !== id)
          removed = current.knowledge.length < before
        })
        return void (await ctx.reply(removed ? 'Connaissance retirée.' : 'Identifiant introuvable.'))
      }
      if (settings.knowledge.length >= 100) {
        return void (await ctx.reply('La base contient déjà 100 éléments. Retire une ancienne connaissance avant d’en ajouter une nouvelle.'))
      }
      if (action === 'ajouter') {
        const parts = splitParts(ctx.args.slice(1).join(' '))
        const label = parts[0]?.slice(0, 120) ?? ''
        const content = parts.slice(1).join(' | ').trim().slice(0, 6_000)
        if (!label || !content) return void (await ctx.reply(`Utilisation : ${ctx.prefix}connaissance ajouter tarifs | Abonnement 1 mois : 5000 XOF`))
        const entry: KnowledgeEntry = {
          id: shortId(),
          kind: 'texte',
          label,
          content,
          mimetype: null,
          fileName: null,
          createdAt: new Date().toISOString(),
        }
        await ctx.db.mutateSessionAutomation(ctx.sessionName, (current) => current.knowledge.push(entry))
        return void (await ctx.reply(`Connaissance *#${entry.id}* ajoutée à l’assistant de ce numéro.`))
      }
      if (action === 'media') {
        const label = ctx.args.slice(1).join(' ').trim().slice(0, 120)
        if (!label) return void (await ctx.reply(`Réponds à un média avec : ${ctx.prefix}connaissance media catalogue`))
        const source = ctx.quotedMessage() ?? ctx.message
        const media = findMedia(source)
        if (!media) return void (await ctx.reply('Réponds à une photo, vidéo, audio ou document à analyser.'))
        const ai = new AiService(ctx.config)
        if (!ai.isConfigured()) return void (await ctx.reply('L’assistant IA n’est pas configuré.'))
        try {
          const downloaded = await downloadMedia(source, 12 * 1024 * 1024, ctx.sock)
          const extracted = await ai.extractKnowledgeFromMedia(downloaded.buffer, downloaded.mimetype, label)
          const node = media.node as { fileName?: string | null }
          const entry: KnowledgeEntry = {
            id: shortId(),
            kind: 'media',
            label,
            content: extracted,
            mimetype: downloaded.mimetype,
            fileName: node.fileName ?? null,
            createdAt: new Date().toISOString(),
          }
          await ctx.db.mutateSessionAutomation(ctx.sessionName, (current) => current.knowledge.push(entry))
          await ctx.reply(`Média analysé et ajouté à la base IA sous *#${entry.id}* (${label}).`)
        } catch (error) {
          await ctx.reply(error instanceof Error ? error.message : 'Impossible d’analyser ce média.')
        }
        return
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}connaissance ajouter nom | texte ; ${ctx.prefix}connaissance media nom ; ${ctx.prefix}connaissance liste`)
    },
  },
  {
    name: 'historique',
    description: 'Active ou désactive la conservation locale des originaux supprimés ou modifiés dans les chats privés et groupes.',
    usage: 'activer|desactiver|statut',
    category: 'WhatsApp',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase() ?? 'statut'
      if (action === 'statut') {
        const enabled = ctx.db.getSessionAutomation(ctx.sessionName).messageHistoryEnabled
        return void (await ctx.reply(`Historique des originaux : *${enabled ? 'activé' : 'désactivé'}* pour ce numéro Bestla.`))
      }
      if (action !== 'activer' && action !== 'desactiver') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}historique activer|desactiver|statut`))
      }
      await ctx.db.mutateSessionAutomation(ctx.sessionName, (settings) => {
        settings.messageHistoryEnabled = action === 'activer'
      })
      await ctx.reply(
        action === 'activer'
          ? `Historique activé. Bestla conserve désormais les originaux reçus à partir de maintenant. Utilise ${ctx.prefix}original après une suppression ou modification.`
          : 'Historique désactivé. Les nouveaux messages ne seront plus enregistrés par cette fonction.',
      )
    },
  },
  {
    name: 'original',
    description: 'Affiche le contenu original d’un message supprimé ou modifié depuis l’activation de l’historique.',
    usage: '[liste|identifiant]',
    category: 'WhatsApp',
    ownerOnly: true,
    async execute(ctx) {
      if (!ctx.db.getSessionAutomation(ctx.sessionName).messageHistoryEnabled) {
        return void (await ctx.reply(`Active d’abord la fonction avec ${ctx.prefix}historique activer.`))
      }
      const records = await changedMessages(ctx.config, ctx.sessionName, ctx.chatId, 50)
      if (!records.length) return void (await ctx.reply('Aucun message supprimé ou modifié enregistré dans cette discussion depuis l’activation.'))
      const requested = ctx.args[0]?.trim()
      if (requested?.toLowerCase() === 'liste') {
        const lines = records.slice(0, 15).map((record) => {
          const kind = record.changeKind === 'supprime' ? 'supprimé' : 'modifié'
          const preview = record.originalText || `[${record.messageType}]`
          return `#${record.id.slice(0, 12)} • ${kind} • ${preview.slice(0, 80)}`
        })
        return void (await ctx.reply(`*ORIGINAUX DISPONIBLES*\n${lines.join('\n')}`))
      }
      const record = requested
        ? records.find((entry) => entry.id === requested || entry.id.startsWith(requested))
        : records[0]
      if (!record) return void (await ctx.reply('Identifiant introuvable dans cette discussion.'))
      const mediaSent = await sendOriginalMedia(ctx, record).catch(() => false)
      if (!mediaSent || record.changeKind === 'modifie') await ctx.reply(originalSummary(record, ctx.config.timezone))
      else await ctx.reply(`Original ${record.changeKind === 'supprime' ? 'supprimé' : 'modifié'} restauré (#${record.id.slice(0, 12)}).`)
    },
  },
]
