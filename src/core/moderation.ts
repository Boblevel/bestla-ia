import type { WAMessage, WASocket } from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import { jidToMention } from '../utils/jid.js'
import { normalizeWords } from '../utils/text.js'
import type { JsonDatabase } from './database.js'
import { logger } from './logger.js'
import { SpamDetector } from './rate-limiter.js'

const LINK_PATTERN = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/)[^\s]+/iu

function containsForbiddenLink(body: string, allowedDomains: string[]): boolean {
  const match = body.match(LINK_PATTERN)?.[0]?.toLowerCase()
  if (!match) return false
  return !allowedDomains.some((domain) => match.includes(domain.toLowerCase()))
}

interface ModerationInput {
  sock: WASocket
  message: WAMessage
  chatId: string
  sender: string
  body: string
  isAdmin: boolean
  isOwner: boolean
  isBotAdmin: boolean
  send(text: string, mentions?: string[]): Promise<unknown>
}

export class ModerationService {
  private readonly spamDetector = new SpamDetector()

  constructor(
    private readonly db: JsonDatabase,
    private readonly config: AppConfig,
  ) {}

  async inspect(input: ModerationInput): Promise<boolean> {
    if (input.isAdmin || input.isOwner) return false
    const settings = this.db.getGroup(input.chatId)
    let reason = ''

    if (settings.antilink && containsForbiddenLink(input.body, settings.allowedDomains)) {
      reason = 'lien non autorisé'
    }
    if (!reason && settings.badwords.length > 0) {
      const words = new Set(normalizeWords(input.body))
      if (settings.badwords.some((word) => words.has(word))) reason = 'mot interdit'
    }
    if (!reason && settings.antispam && this.spamDetector.isSpam(`${input.chatId}:${input.sender}`)) {
      reason = 'spam détecté'
    }

    if (!reason) return false

    if (input.isBotAdmin) {
      await input.sock.sendMessage(input.chatId, { delete: input.message.key }).catch((error) => {
        logger.warn({ err: error, groupId: input.chatId }, 'Impossible de supprimer le message modéré')
      })
    }

    const warning = await this.db.addWarning(input.chatId, input.sender, reason)
    const mention = jidToMention(input.sender)
    if (warning.count >= this.config.warnLimit && input.isBotAdmin) {
      await input.send(
        `${mention} a atteint ${warning.count}/${this.config.warnLimit} avertissements et va être retiré du groupe.`,
        [input.sender],
      )
      await input.sock.groupParticipantsUpdate(input.chatId, [input.sender], 'remove')
      await this.db.clearWarnings(input.chatId, input.sender)
    } else {
      await input.send(
        `${mention} : ${reason}. Avertissement ${warning.count}/${this.config.warnLimit}.`,
        [input.sender],
      )
    }
    return true
  }
}
