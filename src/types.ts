import type {
  AnyMessageContent,
  GroupMetadata,
  MiscMessageGenerationOptions,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys'
import type { AppConfig } from './config.js'
import type { JsonDatabase } from './core/database.js'
import type { CommandRegistry } from './core/registry.js'

export type CommandCategory =
  | 'Général'
  | 'IA'
  | 'Groupe'
  | 'Modération'
  | 'Média'
  | 'Audio & Vidéo'
  | 'Documents & Création'
  | 'Automatisation'
  | 'Budget'
  | 'Entreprise'
  | 'Jeux'
  | 'WhatsApp'
  | 'Propriétaire'

export interface CommandContext {
  sock: WASocket
  sessionName: string
  message: WAMessage
  chatId: string
  sender: string
  body: string
  commandName: string
  args: string[]
  argText: string
  prefix: string
  isGroup: boolean
  isOwner: boolean
  isAdmin: boolean
  isBotAdmin: boolean
  groupMetadata?: GroupMetadata
  config: AppConfig
  db: JsonDatabase
  registry: CommandRegistry
  reply(text: string, mentions?: string[]): Promise<WAMessage | undefined>
  send(content: AnyMessageContent, options?: MiscMessageGenerationOptions): Promise<WAMessage | undefined>
  react(emoji: string): Promise<void>
  targetUser(): string | undefined
  quotedMessage(): WAMessage | undefined
}

export interface BotCommand {
  name: string
  aliases?: string[]
  description: string
  usage?: string
  category: CommandCategory
  ownerOnly?: boolean
  groupOnly?: boolean
  adminOnly?: boolean
  botAdminRequired?: boolean
  cooldownSeconds?: number
  execute(ctx: CommandContext): Promise<void>
}

export interface SessionStatus {
  name: string
  connected: boolean
  jid: string | null
  phone: string | null
}

export interface IncomingWebhookPayload {
  event: 'message'
  session: string
  id: string | null
  chatId: string
  sender: string
  isGroup: boolean
  fromMe: boolean
  pushName: string | null
  timestamp: number
  type: string
  text: string
}
