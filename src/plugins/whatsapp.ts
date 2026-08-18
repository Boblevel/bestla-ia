import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BotCommand, CommandContext } from '../types.js'
import type { ScheduledJob } from '../core/database.js'
import { jidToMention, phoneToJid } from '../utils/jid.js'
import { safeFetchBuffer } from '../utils/safe-fetch.js'
import { pendingStatusCount, readRememberedStatuses, resolveRememberedStatusMessage } from '../core/status-viewer.js'
import { downloadMedia, findMedia } from '../utils/message.js'
import { messageText, messageType } from '../utils/text.js'

function safeContactName(value: string): string {
  return value.trim().replace(/[\r\n;:]/g, ' ').slice(0, 60) || 'Contact Bestla'
}

const STATUS_SCHEDULE_PREFIX = '__BESTLA_STATUS_V1__:'

interface ScheduledStatusPayload {
  kind: 'text' | 'image' | 'video'
  audience: string[]
  text?: string
  mimetype?: string
  filePath?: string
}

function shortId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 8)
}

function currentPrivateTarget(ctx: CommandContext): string {
  if (!ctx.isGroup && (ctx.chatId.endsWith('@s.whatsapp.net') || ctx.chatId.endsWith('@lid'))) return ctx.chatId
  return ctx.sender
}

function parseStatusSchedule(specification: string): { date: Date; repeat: ScheduledJob['repeat'] } | undefined {
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
  if (!absolute) return undefined
  const [, year, month, day, hour, minute] = absolute
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0)
  const exact =
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day) &&
    date.getHours() === Number(hour) &&
    date.getMinutes() === Number(minute)
  return exact && date.getTime() > Date.now() ? { date, repeat: 'aucune' } : undefined
}

function parseScheduledStatus(message: string): ScheduledStatusPayload | undefined {
  if (!message.startsWith(STATUS_SCHEDULE_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(message.slice(STATUS_SCHEDULE_PREFIX.length)) as ScheduledStatusPayload
    return parsed && Array.isArray(parsed.audience) ? parsed : undefined
  } catch {
    return undefined
  }
}


function selectedMediaMessage(ctx: CommandContext) {
  if (findMedia(ctx.message)) return ctx.message
  const quoted = ctx.quotedMessage()
  return quoted && findMedia(quoted) ? quoted : undefined
}

function fileExtension(mimetype: string): string {
  const known: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
    'application/pdf': 'pdf',
  }
  return known[mimetype.toLowerCase()] ?? mimetype.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') ?? 'bin'
}

async function deleteQuotedMessage(ctx: CommandContext): Promise<boolean> {
  const quoted = ctx.quotedMessage()
  if (!quoted?.key?.id) {
    await ctx.reply('Réponds au message que tu veux supprimer.')
    return false
  }
  try {
    await ctx.sock.sendMessage(ctx.chatId, { delete: quoted.key })
    return true
  } catch {
    await ctx.reply('WhatsApp a refusé la suppression. Selon le message, il faut être son auteur ou administrateur du groupe.')
    return false
  }
}

function statusAudience(ctx: CommandContext): string[] {
  if (ctx.isGroup) {
    return (ctx.groupMetadata?.participants ?? [])
      .map((participant) => participant.id)
      .filter((jid): jid is string => Boolean(jid) && jid !== ctx.sock.user?.id)
      .slice(0, 500)
  }
  return ctx.chatId.endsWith('@s.whatsapp.net') || ctx.chatId.endsWith('@lid') ? [ctx.chatId] : []
}

async function publishStatus(ctx: CommandContext, textOverride?: string): Promise<void> {
  const audience = statusAudience(ctx)
  if (!audience.length) {
    await ctx.reply('Aucun destinataire de statut n’a pu être déterminé depuis cette discussion.')
    return
  }
  const source = selectedMediaMessage(ctx)
  if (source) {
    const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
    const caption = textOverride?.trim() || messageText(source).slice(0, 700)
    if (media.type === 'image') {
      await ctx.sock.sendMessage('status@broadcast', { image: media.buffer, ...(caption ? { caption } : {}) }, { statusJidList: audience, broadcast: true })
      await ctx.reply(`Statut image publié pour ${audience.length} destinataire(s) lié(s) à cette discussion.`)
      return
    }
    if (media.type === 'video') {
      await ctx.sock.sendMessage('status@broadcast', { video: media.buffer, mimetype: media.mimetype, ...(caption ? { caption } : {}) }, { statusJidList: audience, broadcast: true })
      await ctx.reply(`Statut vidéo publié pour ${audience.length} destinataire(s) lié(s) à cette discussion.`)
      return
    }
  }
  const text = (textOverride ?? ctx.argText).trim().slice(0, 700)
  if (!text) {
    await ctx.reply(`Écris un texte ou réponds à une image/vidéo avec ${ctx.prefix}publierstatut.`)
    return
  }
  await ctx.sock.sendMessage('status@broadcast', { text }, { statusJidList: audience, broadcast: true })
  await ctx.reply(`Statut texte publié pour ${audience.length} destinataire(s) lié(s) à cette discussion.`)
}

export const whatsappCommands: BotCommand[] = [
  {
    name: 'reaction',
    aliases: ['reagir'],
    description: 'Réagit avec un emoji au message auquel tu réponds.',
    usage: '<emoji> (en réponse à un message)',
    category: 'WhatsApp',
    cooldownSeconds: 2,
    async execute(ctx) {
      const emoji = ctx.argText.trim()
      const quoted = ctx.quotedMessage()
      if (!quoted?.key?.id || !emoji || emoji.length > 16) return void (await ctx.reply(`Réponds à un message avec ${ctx.prefix}reaction ❤️`))
      await ctx.sock.sendMessage(ctx.chatId, { react: { text: emoji, key: quoted.key } })
    },
  },
  {
    name: 'photoprofil',
    aliases: ['photo-profil'],
    description: 'Envoie la photo de profil visible d’un contact ou de toi-même.',
    usage: '[@personne ou numéro]',
    category: 'WhatsApp',
    cooldownSeconds: 10,
    async execute(ctx) {
      const target = ctx.targetUser() ?? currentPrivateTarget(ctx)
      const url = await ctx.sock.profilePictureUrl(target, 'image').catch(() => undefined)
      if (!url) return void (await ctx.reply('Photo de profil indisponible : elle est peut-être protégée par les réglages de confidentialité.'))
      try {
        const media = await safeFetchBuffer(url, ctx.config.maxMediaBytes)
        await ctx.send({ image: media.buffer, caption: `Photo de profil de ${jidToMention(target)}.`, mentions: [target] })
      } catch {
        await ctx.reply('Impossible de récupérer cette photo de profil pour le moment.')
      }
    },
  },
  {
    name: 'envoyercontact',
    aliases: ['partagercontact'],
    description: 'Envoie une fiche contact vCard dans la discussion actuelle.',
    usage: '<numéro> | <nom>',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const separator = ctx.argText.indexOf('|')
      const number = separator === -1 ? '' : ctx.argText.slice(0, separator).trim().replace(/\D/g, '')
      const name = separator === -1 ? '' : safeContactName(ctx.argText.slice(separator + 1))
      const jid = phoneToJid(number)
      if (!jid || !name) return void (await ctx.reply(`Utilisation : ${ctx.prefix}envoyercontact 22670000000 | Contact`))
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${number}:${number}\nEND:VCARD`
      await ctx.send({ contacts: { displayName: name, contacts: [{ vcard }] } })
    },
  },
  {
    name: 'liremessage',
    aliases: ['marquerlu'],
    description: 'Marque le message actuel comme lu.',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 2,
    async execute(ctx) {
      await ctx.sock.readMessages([ctx.message.key])
      await ctx.react('👁️')
    },
  },
  {
    name: 'lirestatuts',
    aliases: ['voirstatuts', 'statutsvus'],
    description: 'Marque en une fois comme vus les statuts récents reçus par cette session.',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const before = pendingStatusCount(ctx.sock)
      if (before === 0) {
        return void (await ctx.reply('Aucun nouveau statut mémorisé pour cette session. Les prochains statuts reçus seront disponibles ici.'))
      }
      const result = await readRememberedStatuses(ctx.sock)
      if (result.failed === 0) {
        return void (await ctx.reply(`${result.read} statut${result.read > 1 ? 's' : ''} marqué${result.read > 1 ? 's' : ''} comme vu${result.read > 1 ? 's' : ''}.`))
      }
      await ctx.reply(`${result.read} statut(s) marqué(s) comme vus ; ${result.failed} n'ont pas pu être confirmés par WhatsApp.`)
    },
  },
  {
    name: 'autostatuts',
    aliases: ['autovuestatuts', 'statutsauto'],
    description: 'Active ou désactive la lecture automatique des nouveaux statuts WhatsApp.',
    usage: 'activer|desactiver|statut',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 2,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (!action || action === 'statut') {
        return void (await ctx.reply(`Lecture automatique des statuts : *${ctx.db.getAutoStatusView() ? 'ACTIVÉE' : 'DÉSACTIVÉE'}*.`))
      }
      if (action !== 'activer' && action !== 'desactiver') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}autostatuts activer|desactiver|statut`))
      }
      const enabled = action === 'activer'
      await ctx.db.setAutoStatusView(enabled)
      await ctx.reply(`Lecture automatique des nouveaux statuts *${enabled ? 'activée' : 'désactivée'}*.`)
    },
  },
  {
    name: 'presence',
    aliases: ['presencewa'],
    description: 'Change manuellement la présence WhatsApp du compte connecté.',
    usage: 'enligne|horsligne|ecriture|audio|pause',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 2,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const modes = {
        enligne: 'available',
        horsligne: 'unavailable',
        ecriture: 'composing',
        audio: 'recording',
        pause: 'paused',
      } as const
      const mode = action ? modes[action as keyof typeof modes] : undefined
      if (!mode) return void (await ctx.reply(`Utilisation : ${ctx.prefix}presence enligne|horsligne|ecriture|audio|pause`))
      if (mode === 'available' || mode === 'unavailable') await ctx.sock.sendPresenceUpdate(mode)
      else await ctx.sock.sendPresenceUpdate(mode, ctx.chatId)
      await ctx.reply(`Présence WhatsApp réglée sur *${action}*.`)
    },
  },
  {
    name: 'apropos',
    aliases: ['biowhatsapp', 'statutprofil'],
    description: 'Modifie le texte À propos du profil WhatsApp connecté.',
    usage: '<texte>',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const text = ctx.argText.trim().replace(/\s+/g, ' ').slice(0, 139)
      if (!text) return void (await ctx.reply(`Utilisation : ${ctx.prefix}apropos Disponible pour vos messages.`))
      await ctx.sock.updateProfileStatus(text)
      await ctx.reply('Texte À propos du profil WhatsApp mis à jour.')
    },
  },
  {
    name: 'confidentialite',
    description: 'Affiche les réglages de confidentialité visibles par Baileys.',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 10,
    async execute(ctx) {
      const settings = await ctx.sock.fetchPrivacySettings(true)
      const entries = Object.entries(settings).filter(([, value]) => typeof value === 'string')
      if (!entries.length) return void (await ctx.reply('WhatsApp n’a renvoyé aucun réglage de confidentialité exploitable.'))
      await ctx.reply(`*CONFIDENTIALITÉ WHATSAPP*\n\n${entries.map(([key, value]) => `${key} : *${String(value)}*`).join('\n')}`)
    },
  },
  {
    name: 'appel',
    description: 'Affiche le comportement des appels WhatsApp entrants du numéro Bestla.',
    category: 'WhatsApp',
    ownerOnly: true,
    async execute(ctx) {
      await ctx.reply(`Appels entrants : *${ctx.config.rejectCalls ? 'refus automatique activé' : 'refus automatique désactivé'}*.
Bestla ne lance pas d’appel sortant : cette fonction n’est pas exposée de façon fiable par Baileys.`)
    },
  },
  {
    name: 'legende',
    description: 'Réenvoie une image ou une vidéo avec une nouvelle légende.',
    usage: '<nouvelle légende> (en réponse à un média)',
    category: 'WhatsApp',
    cooldownSeconds: 5,
    async execute(ctx) {
      const source = selectedMediaMessage(ctx)
      if (!source) return void (await ctx.reply('Réponds à une image ou une vidéo.'))
      const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
      const caption = ctx.argText.trim().slice(0, 1_024)
      if (media.type === 'image') return void (await ctx.send({ image: media.buffer, caption }))
      if (media.type === 'video') return void (await ctx.send({ video: media.buffer, mimetype: media.mimetype, caption }))
      await ctx.reply('La commande légende accepte uniquement une image ou une vidéo.')
    },
  },
  {
    name: 'effacer',
    description: 'Supprime le message auquel tu réponds puis efface la commande quand WhatsApp l’autorise.',
    category: 'WhatsApp',
    ownerOnly: true,
    async execute(ctx) {
      if (!(await deleteQuotedMessage(ctx))) return
      if (ctx.message.key.fromMe) await ctx.sock.sendMessage(ctx.chatId, { delete: ctx.message.key }).catch(() => undefined)
    },
  },
  {
    name: 'contacts',
    description: 'Affiche les contacts du groupe actuel ou l’identifiant du contact en discussion privée.',
    category: 'WhatsApp',
    cooldownSeconds: 5,
    async execute(ctx) {
      if (!ctx.isGroup) {
        const target = ctx.chatId
        return void (await ctx.reply(`Contact actuel : ${jidToMention(target)}
JID : *${target}*`, [target]))
      }
      const jids = (ctx.groupMetadata?.participants ?? []).map((participant) => participant.id).filter((jid): jid is string => Boolean(jid)).slice(0, 100)
      await ctx.reply(`*CONTACTS DU GROUPE (${jids.length})*

${jids.map(jidToMention).join('\n')}`, jids)
    },
  },
  {
    name: 'supprimer',
    description: 'Supprime le message auquel tu réponds lorsque WhatsApp l’autorise.',
    category: 'WhatsApp',
    ownerOnly: true,
    async execute(ctx) {
      if (await deleteQuotedMessage(ctx)) await ctx.react('✅')
    },
  },
  {
    name: 'document',
    description: 'Réenvoie le média cité comme document WhatsApp.',
    usage: '(en réponse à un média)',
    category: 'WhatsApp',
    cooldownSeconds: 5,
    async execute(ctx) {
      const source = selectedMediaMessage(ctx)
      if (!source) return void (await ctx.reply('Réponds à une image, vidéo, audio, document ou autocollant.'))
      const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
      await ctx.send({ document: media.buffer, mimetype: media.mimetype, fileName: `bestla-media.${fileExtension(media.mimetype)}` })
    },
  },
  {
    name: 'enligne',
    description: 'Passe immédiatement le numéro Bestla en présence en ligne.',
    category: 'WhatsApp',
    ownerOnly: true,
    async execute(ctx) {
      await ctx.sock.sendPresenceUpdate('available')
      await ctx.reply('Présence WhatsApp réglée sur *en ligne*.')
    },
  },
  {
    name: 'sondagewhatsapp',
    description: 'Crée un sondage WhatsApp natif.',
    usage: '<question> | <choix 1> | <choix 2> [| choix 3...]',
    category: 'WhatsApp',
    cooldownSeconds: 5,
    async execute(ctx) {
      const parts = ctx.argText.split('|').map((part) => part.trim()).filter(Boolean)
      const question = parts.shift()
      if (!question || parts.length < 2) return void (await ctx.reply(`Utilisation : ${ctx.prefix}sondagewhatsapp Ton choix ? | Oui | Non`))
      await ctx.send({ poll: { name: question.slice(0, 250), values: parts.slice(0, 12).map((value) => value.slice(0, 100)), selectableCount: 1 } })
    },
  },
  {
    name: 'lire',
    description: 'Marque le message de commande comme lu.',
    category: 'WhatsApp',
    ownerOnly: true,
    async execute(ctx) {
      await ctx.sock.readMessages([ctx.message.key])
      await ctx.react('👁️')
    },
  },
  {
    name: 'programmerstatut',
    description: 'Programme un statut WhatsApp texte, image ou vidéo, avec liste et suppression.',
    usage: '10min | texte, ou 10min en réponse à un média ; liste ; supprimer <id>',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 4,
    async execute(ctx) {
      const first = ctx.args[0]?.toLowerCase()
      if (first === 'liste') {
        const jobs = ctx.db
          .listSchedules()
          .filter((job) => ['en_attente', 'en_cours'].includes(job.status) && parseScheduledStatus(job.message))
          .slice(0, 20)
        if (!jobs.length) return void (await ctx.reply('Aucun statut programmé actif.'))
        await ctx.reply(`*STATUTS PROGRAMMÉS*\n\n${jobs.map((job) => {
          const payload = parseScheduledStatus(job.message)
          const detail = payload?.kind === 'text' ? payload.text?.slice(0, 80) : payload?.kind === 'image' ? 'image' : 'vidéo'
          return `#${job.id} • ${new Date(job.nextRunAt).toLocaleString('fr-FR', { timeZone: ctx.config.timezone })} • ${job.repeat}\n↳ ${detail ?? 'statut'}`
        }).join('\n\n')}`)
        return
      }

      if (first === 'supprimer') {
        const id = ctx.args[1]
        if (!id) return void (await ctx.reply(`Utilisation : ${ctx.prefix}programmerstatut supprimer identifiant`))
        const job = ctx.db.listSchedules().find((entry) => entry.id === id && parseScheduledStatus(entry.message))
        if (!job) return void (await ctx.reply('Statut programmé introuvable.'))
        const payload = parseScheduledStatus(job.message)
        const cancelled = await ctx.db.cancelSchedule(id, ctx.sender, true)
        if (cancelled && payload?.filePath) await unlink(payload.filePath).catch(() => undefined)
        await ctx.reply(cancelled ? 'Statut programmé supprimé.' : 'Ce statut a déjà été exécuté ou annulé.')
        return
      }

      const separator = ctx.argText.indexOf('|')
      const specification = (separator === -1 ? ctx.argText : ctx.argText.slice(0, separator)).trim()
      const directText = separator === -1 ? '' : ctx.argText.slice(separator + 1).trim()
      const schedule = parseStatusSchedule(specification)
      if (!schedule) {
        return void (await ctx.reply(
          `Formats : ${ctx.prefix}programmerstatut 10min | Mon statut\n` +
          `${ctx.prefix}programmerstatut quotidien 08:00 | Bonjour\n` +
          `ou réponds à une image/vidéo/texte avec ${ctx.prefix}programmerstatut 2h.`,
        ))
      }

      const audience = statusAudience(ctx)
      if (!audience.length) return void (await ctx.reply('Aucun destinataire de statut n’a pu être déterminé depuis cette discussion.'))
      const id = shortId()
      const quoted = ctx.quotedMessage()
      const mediaSource = selectedMediaMessage(ctx)
      let payload: ScheduledStatusPayload

      if (mediaSource) {
        const media = await downloadMedia(mediaSource, ctx.config.maxMediaBytes, ctx.sock)
        if (media.type !== 'image' && media.type !== 'video') return void (await ctx.reply('La programmation de statut accepte un texte, une image ou une vidéo.'))
        const directory = path.join(ctx.config.dataDir, 'scheduled-status')
        await mkdir(directory, { recursive: true })
        const extension = fileExtension(media.mimetype)
        const filePath = path.join(directory, `${id}.${extension}`)
        await writeFile(filePath, media.buffer, { mode: 0o600 })
        payload = {
          kind: media.type,
          audience,
          mimetype: media.mimetype,
          filePath,
          ...(directText ? { text: directText.slice(0, 700) } : {}),
        }
      } else {
        const quotedText = quoted ? messageText(quoted) : ''
        const text = (directText || quotedText).trim().slice(0, 700)
        if (!text) return void (await ctx.reply('Ajoute le texte après | ou réponds à un texte, une image ou une vidéo.'))
        payload = { kind: 'text', audience, text }
      }

      const job: ScheduledJob = {
        id,
        sessionName: ctx.sessionName,
        chatId: 'status@broadcast',
        createdBy: ctx.sender,
        message: `${STATUS_SCHEDULE_PREFIX}${JSON.stringify(payload)}`,
        nextRunAt: schedule.date.toISOString(),
        repeat: schedule.repeat,
        status: 'en_attente',
        createdAt: new Date().toISOString(),
        claimedAt: null,
        lastError: null,
      }
      await ctx.db.addSchedule(job)
      await ctx.reply(
        `Statut *#${job.id}* programmé pour ${schedule.date.toLocaleString('fr-FR', { timeZone: ctx.config.timezone })}` +
        `${job.repeat === 'quotidien' ? ' puis chaque jour' : ''}.`,
      )
    },
  },
  {
    name: 'publierstatut',
    description: 'Publie un statut WhatsApp texte, image ou vidéo pour les personnes de la discussion actuelle.',
    usage: '[texte] (ou en réponse à une image/vidéo)',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 10,
    async execute(ctx) {
      await publishStatus(ctx)
    },
  },
  {
    name: 'statuts',
    description: 'Affiche le panneau des fonctions de statuts WhatsApp.',
    category: 'WhatsApp',
    async execute(ctx) {
      await ctx.reply(`*STATUTS WHATSAPP*

${ctx.prefix}lirestatuts
${ctx.prefix}autostatuts activer|desactiver|statut
${ctx.prefix}telechargerstatut (en réponse au statut)
${ctx.prefix}publierstatut <texte>
${ctx.prefix}publierstatut (en réponse à une image/vidéo)
${ctx.prefix}programmerstatut

Statuts mémorisés en attente : *${pendingStatusCount(ctx.sock)}*.`)
    },
  },
  {
    name: 'telechargerstatut',
    aliases: ['enregistrerstatut', 'sauverstatut'],
    description: 'Télécharge la photo, la vidéo ou l’audio d’un statut WhatsApp auquel tu réponds.',
    usage: '(en réponse au statut)',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 8,
    async execute(ctx) {
      const quoted = ctx.quotedMessage()
      if (!quoted) return void (await ctx.reply(`Réponds au statut avec ${ctx.prefix}telechargerstatut.`))

      // Dans une discussion privée, WhatsApp peut ne citer qu'un aperçu du statut.
      // On privilégie donc le message complet mémorisé lors de sa réception sur
      // status@broadcast, même si le statut a déjà été marqué comme vu.
      const sourceMessage = resolveRememberedStatusMessage(ctx.sock, quoted) ?? quoted
      const kind = findMedia(sourceMessage)?.type
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
        return void (await ctx.reply('Ce statut ne contient pas de photo, vidéo ou audio téléchargeable.'))
      }
      try {
        const media = await downloadMedia(sourceMessage, ctx.config.maxMediaBytes, ctx.sock)
        if (media.type === 'image') await ctx.send({ image: media.buffer })
        else if (media.type === 'video') await ctx.send({ video: media.buffer, mimetype: media.mimetype })
        else await ctx.send({ audio: media.buffer, mimetype: media.mimetype, ptt: false })
      } catch {
        await ctx.reply('Impossible de récupérer ce statut. Il peut être expiré, avoir été reçu avant le dernier redémarrage du bot ou ne plus être disponible sur WhatsApp.')
      }
    },
  },
  {
    name: 'recuperermedia',
    description: 'Récupère une photo, une vidéo ou un audio en vue unique ou expiré si WhatsApp peut encore le réenvoyer.',
    usage: '(en réponse au média)',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 8,
    async execute(ctx) {
      const source = selectedMediaMessage(ctx)
      if (!source) return void (await ctx.reply(`Réponds à la photo, vidéo ou audio avec ${ctx.prefix}recuperermedia.`))
      const kind = findMedia(source)?.type
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return void (await ctx.reply('Cette commande accepte uniquement les photos, vidéos et audios.'))
      try {
        const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)
        if (media.type === 'image') await ctx.send({ image: media.buffer, caption: 'Média récupéré par Bestla iA.' })
        else if (media.type === 'video') await ctx.send({ video: media.buffer, mimetype: media.mimetype, caption: 'Média récupéré par Bestla iA.' })
        else await ctx.send({ audio: media.buffer, mimetype: media.mimetype, ptt: false })
      } catch {
        await ctx.reply('Le média n’est plus récupérable. Bestla a demandé une réémission à WhatsApp, mais aucun appareil lié n’a pu fournir le fichier.')
      }
    },
  },
  {
    name: 'envoyervueunique',
    aliases: ['transfervueunique'],
    description: 'Envoie la photo, la vidéo ou l’audio cité à un numéro en vraie vue unique, sans texte ni mention chez le destinataire.',
    usage: '<numéro> (en réponse à une photo, vidéo ou audio)',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const source = selectedMediaMessage(ctx)
      if (!source) return void (await ctx.reply(`Réponds à une photo, vidéo ou audio avec ${ctx.prefix}envoyervueunique 22670000000.`))
      const kind = findMedia(source)?.type
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
        return void (await ctx.reply('Cette commande accepte uniquement une photo, une vidéo ou un audio.'))
      }

      const requestedTarget = phoneToJid(ctx.args[0] ?? '') ?? ctx.targetUser()
      if (!requestedTarget || requestedTarget.endsWith('@g.us')) {
        return void (await ctx.reply(`Indique le numéro du destinataire : ${ctx.prefix}envoyervueunique 22670000000`))
      }

      const lookup = (await ctx.sock.onWhatsApp(requestedTarget).catch(() => [])) ?? []
      const destination = lookup.find((entry) => entry.exists)?.jid ?? requestedTarget
      const media = await downloadMedia(source, ctx.config.maxMediaBytes, ctx.sock)

      if (media.type === 'image') {
        await ctx.sock.sendMessage(destination, { image: media.buffer, viewOnce: true })
      } else if (media.type === 'video') {
        await ctx.sock.sendMessage(destination, { video: media.buffer, mimetype: media.mimetype, viewOnce: true })
      } else {
        await ctx.sock.sendMessage(destination, { audio: media.buffer, mimetype: media.mimetype, ptt: false, viewOnce: true })
      }
    },
  },
  {
    name: 'ephemereauto',
    aliases: ['messagesephemeresauto'],
    description: 'Active automatiquement les messages éphémères 24 h pour toute personne qui écrit en privé.',
    usage: 'activer|desactiver|statut',
    category: 'WhatsApp',
    ownerOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'statut') {
        return void (await ctx.reply(`Messages éphémères automatiques 24 h : *${ctx.db.getAutoEphemeral24h() ? 'ACTIVÉS' : 'DÉSACTIVÉS'}*.`))
      }
      if (action !== 'activer' && action !== 'desactiver') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}ephemereauto activer|desactiver|statut`))
      }

      const enabled = action === 'activer'
      await ctx.db.setAutoEphemeral24h(enabled)
      await ctx.reply(enabled
        ? 'Messages éphémères automatiques activés : chaque discussion privée entrante sera réglée sur *24 h*.'
        : 'Messages éphémères automatiques désactivés pour les prochaines discussions entrantes.')
    },
  },
  {
    name: 'copiertexte',
    description: 'Copie le texte ou la légende du message auquel tu réponds.',
    usage: '(en réponse à un message texte, une image ou une vidéo avec légende)',
    category: 'WhatsApp',
    cooldownSeconds: 2,
    async execute(ctx) {
      const quoted = ctx.quotedMessage()
      if (!quoted) return void (await ctx.reply('Réponds au message dont tu veux copier le texte.'))
      const text = messageText(quoted)
      if (!text) return void (await ctx.reply('Ce message ne contient aucun texte ou légende récupérable.'))
      await ctx.reply(text.slice(0, 4_000))
    },
  },
  {
    name: 'infosmessage',
    description: 'Affiche les informations techniques utiles du message cité sans modifier la discussion.',
    usage: '(en réponse à un message)',
    category: 'WhatsApp',
    cooldownSeconds: 3,
    async execute(ctx) {
      const quoted = ctx.quotedMessage()
      if (!quoted) return void (await ctx.reply('Réponds au message à analyser.'))
      const media = findMedia(quoted)
      const sender = quoted.key.participant ?? quoted.key.remoteJid ?? 'inconnu'
      const timestamp = quoted.messageTimestamp ? Number(quoted.messageTimestamp) : 0
      const date = timestamp > 0 ? new Date(timestamp * 1000).toLocaleString('fr-FR', { timeZone: ctx.config.timezone }) : 'inconnue'
      await ctx.reply([
        '*INFORMATIONS DU MESSAGE*',
        `Type : *${messageType(quoted)}*`,
        `Expéditeur : *${sender}*`,
        `Identifiant : *${quoted.key.id ?? 'inconnu'}*`,
        `Date : *${date}*`,
        media ? `Média : *${media.type}* (${media.mimetype})` : 'Média : *non*',
      ].join('\n'))
    },
  },

]
