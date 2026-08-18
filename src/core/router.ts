import type { GroupMetadata, WAMessage } from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import type { CommandContext, IncomingWebhookPayload } from '../types.js'
import { signText } from '../utils/brand.js'
import { jidToMention, normalizeUserJid, phoneToJid, sameUser } from '../utils/jid.js'
import { mentionedJids, quotedAsMessage } from '../utils/message.js'
import { safeFetchBuffer } from '../utils/safe-fetch.js'
import { messageText, messageType, parseCommand } from '../utils/text.js'
import type { JsonDatabase } from './database.js'
import { AutomationService, isSiblingBestlaSession } from './automation.js'
import { logger } from './logger.js'
import { ModerationService } from './moderation.js'
import {
  clearPendingSocialDownload,
  downloadSocialAudio,
  downloadSocialVideo,
  getPendingSocialDownload,
  parseSocialDownloadChoice,
  qualityMenuLines,
  SocialDownloadError,
  videoChoiceAllowed,
} from './social-downloader.js'
import { CooldownManager } from './rate-limiter.js'
import type { CommandRegistry } from './registry.js'
import type { SessionRuntime } from './session-manager.js'
import { WebhookDispatcher } from './webhook.js'

function participantIsAdmin(metadata: GroupMetadata | undefined, jid: string): boolean {
  const participant = metadata?.participants.find((item) => {
    const candidate = item as typeof item & { phoneNumber?: string; lid?: string }
    return [candidate.id, candidate.phoneNumber, candidate.lid].some((value) => sameUser(value, jid))
  })
  return participant?.admin === 'admin' || participant?.admin === 'superadmin'
}

export class MessageRouter {
  private readonly moderation: ModerationService
  private readonly automation: AutomationService
  private readonly cooldowns = new CooldownManager()
  private readonly webhook: WebhookDispatcher
  private readonly contactNames = new Map<string, string>()

  constructor(
    private readonly config: AppConfig,
    private readonly db: JsonDatabase,
    private readonly registry: CommandRegistry,
  ) {
    this.moderation = new ModerationService(db, config)
    this.automation = new AutomationService(db, config)
    this.webhook = new WebhookDispatcher(config)
  }

  async handleMessage(runtime: SessionRuntime, message: WAMessage): Promise<void> {
    const chatId = message.key.remoteJid
    if (!chatId || !message.message) return
    if (chatId === 'status@broadcast' || chatId.endsWith('@newsletter')) return

    const fromMe = message.key.fromMe === true
    const isGroup = chatId.endsWith('@g.us')
    const incomingSender = isGroup
      ? (message.key.participantAlt ?? message.key.participant ?? chatId)
      : (message.key.remoteJidAlt ?? message.key.participantAlt ?? message.key.participant ?? chatId)
    const sender = normalizeUserJid(fromMe ? runtime.sock.user?.id : incomingSender)
    if (!sender) return
    const pushName = message.pushName?.trim()
    if (pushName && pushName.length <= 100) this.contactNames.set(sender, pushName)
    const body = messageText(message)

    logger.info(
      {
        session: runtime.name,
        chatId,
        remoteJidAlt: message.key.remoteJidAlt ?? null,
        sender,
        participant: message.key.participant ?? null,
        participantAlt: message.key.participantAlt ?? null,
        addressingMode: message.key.addressingMode ?? null,
        fromMe,
        isGroup,
        bodyLength: body.length,
        type: messageType(message),
      },
      'Message transmis au routeur Bestla',
    )
    const isOwner = fromMe || this.config.ownerNumbers.some((phone) => sameUser(sender, phoneToJid(phone)))

    this.webhook.dispatch({
      event: 'message',
      session: runtime.name,
      id: message.key.id ?? null,
      chatId,
      sender,
      isGroup,
      fromMe,
      pushName: message.pushName ?? null,
      timestamp: Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000)),
      type: messageType(message),
      text: body,
    } satisfies IncomingWebhookPayload)

    if (this.config.markRead && !fromMe) {
      await runtime.sock.readMessages([message.key]).catch(() => undefined)
    }

    const prefix = this.db.getPrefix(this.config.prefix)
    const parsed = parseCommand(body, prefix)
    let metadata: GroupMetadata | undefined
    if (isGroup && (parsed.isCommand || !fromMe)) {
      metadata = await runtime.sock.groupMetadata(chatId).catch((error) => {
        logger.warn({ err: error, groupId: chatId }, 'Métadonnées de groupe indisponibles')
        return undefined
      })
    }

    const isAdmin = isGroup && participantIsAdmin(metadata, sender)
    const isBotAdmin = isGroup && participantIsAdmin(metadata, normalizeUserJid(runtime.sock.user?.id))
    const quoted = quotedAsMessage(message)
    const send: CommandContext['send'] = (content, options) =>
      runtime.send(chatId, content, { ...options, quoted: options?.quoted ?? message })
    const reply: CommandContext['reply'] = (text, mentions = []) =>
      send({ text: signText(text, this.config), ...(mentions.length > 0 ? { mentions } : {}) })

    if (isGroup && !fromMe) {
      const blocked = await this.moderation.inspect({
        sock: runtime.sock,
        message,
        chatId,
        sender,
        body,
        isAdmin,
        isOwner,
        isBotAdmin,
        send: (text, mentions) => reply(text, mentions),
      })
      if (blocked) return
    }

    // Avec plusieurs numéros Bestla dans le même groupe, un message envoyé
    // par une session apparaît comme message entrant sur les autres sessions.
    // On laisse uniquement le module duo le traiter, puis on coupe ici afin
    // d'éviter qu'une commande soit exécutée deux fois par deux numéros.
    const siblingBestlaSession = !fromMe && isSiblingBestlaSession(this.config, runtime.name, sender)
    if (siblingBestlaSession) {
      const handledPeer = await this.automation.inspectPeer({
        sessionName: runtime.name,
        chatId,
        sender,
        body,
        isGroup,
        messageKey: message.key,
        reply: (text) => send({ text }),
        react: (emoji) => runtime.send(chatId, { react: { text: emoji, key: message.key } }),
        typing: (active) => runtime.sock.sendPresenceUpdate(active ? 'composing' : 'paused', chatId),
      })
      logger.info(
        { session: runtime.name, chatId, sender, handledPeer },
        'Message provenant d’une autre session Bestla traité',
      )
      return
    }

    if (!parsed.isCommand && this.config.commandsEnabled && (isOwner || this.db.getPublicMode(this.config.publicMode))) {
      const pending = getPendingSocialDownload(runtime.name, chatId, sender)
      const choice = pending ? parseSocialDownloadChoice(body) : undefined
      if (pending && choice) {
        if (!videoChoiceAllowed(pending, choice)) {
          await send({
            text: [
              'Cette qualité n’a pas été détectée pour ce lien.',
              ...qualityMenuLines(pending.qualities),
            ].join('\n'),
          })
          return
        }
        clearPendingSocialDownload(runtime.name, chatId, sender)
        try {
          if (choice.kind === 'video') {
            await send({ text: `Téléchargement en cours (${choice.quality === 'best' ? 'meilleure qualité disponible' : `${choice.quality}p`})…` })
            const media = await downloadSocialVideo(pending.url, choice.quality, this.config.maxMediaBytes)
            if (media.mimetype.startsWith('video/')) {
              await send({ video: media.buffer, mimetype: media.mimetype, caption: `${media.title}\n${media.qualityLabel}` })
            } else {
              await send({ document: media.buffer, mimetype: media.mimetype, fileName: media.fileName, caption: media.title })
            }
          } else {
            await send({ text: `Extraction audio en cours (${choice.bitrate} kb/s)…` })
            const media = await downloadSocialAudio(pending.url, choice.bitrate, this.config.maxMediaBytes)
            await send({ audio: media.buffer, mimetype: 'audio/mpeg', ptt: false })
          }
        } catch (error) {
          if (error instanceof SocialDownloadError) await send({ text: error.message })
          else throw error
        }
        return
      }

      // Aucun lien brut n'est traité automatiquement. Le téléchargement de médias
      // sociaux ou d'APK démarre uniquement après une commande explicite.
    }

    if (!parsed.isCommand && !fromMe && /https?:\/\/\S+/i.test(body)) {
      logger.info(
        { session: runtime.name, chatId, sender },
        'Lien reçu sans commande explicite : aucune analyse ni automatisation lancée',
      )
      return
    }

    if (!parsed.isCommand && !fromMe) {
      const handled = await this.automation.inspect({
        sessionName: runtime.name,
        chatId,
        sender,
        body,
        isGroup,
        messageKey: message.key,
        reply: (text) => send({ text }),
        react: (emoji) => runtime.send(chatId, { react: { text: emoji, key: message.key } }),
        typing: (active) => runtime.sock.sendPresenceUpdate(active ? 'composing' : 'paused', chatId),
      })
      logger.info(
        { session: runtime.name, chatId, sender, isGroup, handled },
        'Résultat de l’automatisation entrante',
      )
      return
    }

    if (!parsed.isCommand || !this.config.commandsEnabled) return
    const command = this.registry.get(parsed.name)
    if (!command) return
    if (command.name !== 'commande' && !this.db.isCommandEnabled(command.name)) {
      if (isOwner) await reply(`La commande *${prefix}${command.name}* est désactivée. Réactive-la avec *${prefix}commande activer ${command.name}*.`)
      return
    }
    if (!this.db.getPublicMode(this.config.publicMode) && !isOwner) return

    if (command.ownerOnly && !isOwner) return void (await reply('Cette commande est réservée au propriétaire.'))
    if (command.groupOnly && !isGroup) return void (await reply('Cette commande fonctionne uniquement dans un groupe.'))
    if (command.adminOnly && !isAdmin && !isOwner) {
      return void (await reply('Cette commande est réservée aux administrateurs du groupe.'))
    }
    if (command.botAdminRequired && !isBotAdmin) {
      return void (await reply('Je dois être administrateur du groupe pour exécuter cette commande.'))
    }

    const cooldown = this.cooldowns.consume(
      `${runtime.name}:${sender}:${command.name}`,
      command.cooldownSeconds ?? 2,
    )
    if (cooldown > 0 && !isOwner) {
      return void (await reply(`Patiente encore ${cooldown}s avant de réutiliser cette commande.`))
    }

    const context: CommandContext = {
      sock: runtime.sock,
      sessionName: runtime.name,
      message,
      chatId,
      sender,
      body,
      commandName: command.name,
      args: parsed.args,
      argText: parsed.argText,
      prefix,
      isGroup,
      isOwner,
      isAdmin,
      isBotAdmin,
      ...(metadata ? { groupMetadata: metadata } : {}),
      config: this.config,
      db: this.db,
      registry: this.registry,
      reply,
      send,
      react: async (emoji) => {
        await runtime.send(chatId, { react: { text: emoji, key: message.key } })
      },
      targetUser: () => {
        const mentioned = mentionedJids(message)[0]
        if (mentioned) return normalizeUserJid(mentioned)
        const quotedParticipant = quoted?.key.participant
        if (quotedParticipant) return normalizeUserJid(quotedParticipant)
        return phoneToJid(parsed.args[0] ?? '')
      },
      quotedMessage: () => quoted,
    }

    if (this.config.commandReactions) {
      await runtime.send(chatId, { react: { text: '⏳', key: message.key } }).catch(() => undefined)
    }
    const commandControlsPresence = command.name === 'presence'
    if (!commandControlsPresence) {
      await runtime.sock.sendPresenceUpdate('composing', chatId).catch(() => undefined)
    }
    let succeeded = false
    try {
      await command.execute(context)
      succeeded = true
    } catch (error) {
      logger.error(
        { err: error, command: command.name, session: runtime.name, chatId },
        'Erreur pendant une commande',
      )
      await reply('Une erreur est survenue pendant cette commande. Consulte les journaux du serveur.')
    } finally {
      if (!commandControlsPresence) {
        await runtime.sock.sendPresenceUpdate('paused', chatId).catch(() => undefined)
      }
      if (this.config.commandReactions) {
        await runtime.send(chatId, { react: { text: succeeded ? '✅' : '❌', key: message.key } }).catch(() => undefined)
      }
    }
  }

  async handleParticipants(
    runtime: SessionRuntime,
    event: { id: string; participants: string[]; action: string },
  ): Promise<void> {
    const settings = this.db.getGroup(event.id)
    const shouldWelcome = event.action === 'add' && settings.welcome
    const shouldSayGoodbye = event.action === 'remove' && settings.goodbye
    if (!shouldWelcome && !shouldSayGoodbye) return

    const metadata = await runtime.sock.groupMetadata(event.id).catch(() => undefined)
    const participants = event.participants.map(normalizeUserJid).filter(Boolean)
    const groupName = metadata?.subject ?? 'le groupe'
    const template = shouldWelcome ? settings.welcomeMessage : settings.goodbyeMessage
    const fallback = shouldWelcome
      ? `Bienvenue {nom} dans *{groupe}* ! 👋`
      : `Au revoir {nom}.`

    if (!shouldWelcome) {
      const mentions = participants.map(jidToMention).join(', ')
      const text = (template || fallback)
        .replaceAll('{nom}', mentions)
        .replaceAll('{groupe}', groupName)
        .replaceAll('{nombre}', String(participants.length))
      await runtime.send(event.id, { text: signText(text, this.config), mentions: participants })
      return
    }

    const totalMembers = metadata?.size ?? metadata?.participants.length ?? participants.length
    for (const participant of participants) {
      const mention = jidToMention(participant)
      const knownName = this.contactNames.get(participant)
      const welcomeText = (template || fallback)
        .replaceAll('{nom}', mention)
        .replaceAll('{groupe}', groupName)
        .replaceAll('{nombre}', String(totalMembers))
      const details = [
        welcomeText,
        '',
        '👤 *NOUVEAU MEMBRE*',
        `Nom : *${knownName ?? mention}*`,
        `Profil : ${mention}`,
        `Groupe : *${groupName}*`,
        `Membres : *${totalMembers}*`,
      ].join('\n')

      const profileUrl = await runtime.sock.profilePictureUrl(participant, 'image').catch(() => undefined)
      if (profileUrl) {
        const profile = await safeFetchBuffer(profileUrl, 5 * 1024 * 1024).catch(() => undefined)
        if (profile?.buffer.length) {
          await runtime.send(event.id, {
            image: profile.buffer,
            caption: signText(details, this.config),
            mentions: [participant],
          })
          continue
        }
      }
      await runtime.send(event.id, { text: signText(details, this.config), mentions: [participant] })
    }
  }
}
