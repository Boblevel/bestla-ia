import type { GroupMetadata, WAMessage } from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import type { CommandContext, IncomingWebhookPayload } from '../types.js'
import { signText } from '../utils/brand.js'
import { jidToMention, normalizeUserJid, phoneToJid, sameUser } from '../utils/jid.js'
import { mentionedJids, quotedAsMessage } from '../utils/message.js'
import { messageText, messageType, parseCommand } from '../utils/text.js'
import type { JsonDatabase } from './database.js'
import { AutomationService } from './automation.js'
import { logger } from './logger.js'
import { ModerationService } from './moderation.js'
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
    const sender = normalizeUserJid(fromMe ? runtime.sock.user?.id : (message.key.participant ?? chatId))
    if (!sender) return
    const body = messageText(message)
    const isGroup = chatId.endsWith('@g.us')
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

    if (!parsed.isCommand && !fromMe) {
      await this.automation.inspect({
        sessionName: runtime.name,
        chatId,
        sender,
        body,
        isGroup,
        messageKey: message.key,
        reply: (text) => send({ text }),
        react: (emoji) => runtime.send(chatId, { react: { text: emoji, key: message.key } }),
      })
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
    await runtime.sock.sendPresenceUpdate('composing', chatId).catch(() => undefined)
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
      await runtime.sock.sendPresenceUpdate('paused', chatId).catch(() => undefined)
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
    const participants = event.participants.map(normalizeUserJid)
    const mentions = participants.map(jidToMention).join(', ')
    const groupName = metadata?.subject ?? 'le groupe'
    const template = shouldWelcome ? settings.welcomeMessage : settings.goodbyeMessage
    const fallback = shouldWelcome
      ? `Bienvenue {nom} dans *{groupe}* ! 👋`
      : `Au revoir {nom}.`
    const text = (template || fallback)
      .replaceAll('{nom}', mentions)
      .replaceAll('{groupe}', groupName)
      .replaceAll('{nombre}', String(participants.length))
    await runtime.send(event.id, { text: signText(text, this.config), mentions: participants })
  }
}
