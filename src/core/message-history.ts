import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { proto, WAMessage, WASocket } from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import { findMedia } from '../utils/message.js'
import { messageText, messageType, unwrapMessage } from '../utils/text.js'
import { archiveMediaMessage, cleanupMediaArchive } from './media-archive.js'

export type MessageChangeKind = 'supprime' | 'modifie'

export interface MessageHistoryRecord {
  id: string
  chatId: string
  sender: string
  messageType: string
  originalText: string
  receivedAt: string
  hasMedia: boolean
  changeKind: MessageChangeKind | null
  changedAt: string | null
  editedText: string | null
}

type MessageKey = WAMessage['key']

export interface ProtocolMutation {
  kind: MessageChangeKind
  key: MessageKey
  editedMessage?: proto.IMessage
}

const MAX_RECORDS = 2_000
const queues = new Map<string, Promise<void>>()
const lastMediaCleanup = new Map<string, number>()

function historyDirectory(config: AppConfig, sessionName: string): string {
  return path.join(config.dataDir, 'message-history', sessionName)
}

function historyFile(config: AppConfig, sessionName: string): string {
  return path.join(historyDirectory(config, sessionName), 'history.json')
}

function senderOf(message: WAMessage): string {
  return message.key.participantAlt
    ?? message.key.participant
    ?? message.key.remoteJidAlt
    ?? message.key.remoteJid
    ?? 'inconnu'
}

async function readRecords(config: AppConfig, sessionName: string): Promise<MessageHistoryRecord[]> {
  try {
    const raw = await readFile(historyFile(config, sessionName), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is MessageHistoryRecord => {
      if (!entry || typeof entry !== 'object') return false
      const value = entry as Partial<MessageHistoryRecord>
      return typeof value.id === 'string' && typeof value.chatId === 'string' && typeof value.receivedAt === 'string'
    })
  } catch {
    return []
  }
}

async function mutateRecords(
  config: AppConfig,
  sessionName: string,
  mutator: (records: MessageHistoryRecord[]) => void,
): Promise<void> {
  const key = `${config.dataDir}:${sessionName}`
  const previous = queues.get(key) ?? Promise.resolve()
  const operation = previous.then(async () => {
    const records = await readRecords(config, sessionName)
    mutator(records)
    const trimmed = records.slice(-MAX_RECORDS)
    const directory = historyDirectory(config, sessionName)
    const file = historyFile(config, sessionName)
    const temporary = `${file}.tmp`
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(temporary, `${JSON.stringify(trimmed, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  })
  queues.set(key, operation.catch(() => undefined))
  await operation
}

function sameMessage(record: MessageHistoryRecord, key: MessageKey): boolean {
  if (!key.id || record.id !== key.id) return false
  if (!key.remoteJid) return true
  return record.chatId === key.remoteJid || record.chatId === key.remoteJidAlt
}

export async function captureIncomingMessage(
  config: AppConfig,
  sessionName: string,
  message: WAMessage,
  sock: WASocket,
): Promise<void> {
  const id = message.key.id
  const chatId = message.key.remoteJid
  if (!id || !chatId || !message.message) return

  const media = findMedia(message)
  if (media) {
    const archiveConfig: AppConfig = {
      ...config,
      mediaArchive: { ...config.mediaArchive, enabled: true },
    }
    await archiveMediaMessage(archiveConfig, sessionName, message, sock).catch(() => undefined)
    const cleanupKey = `${config.dataDir}:${sessionName}`
    const lastCleanup = lastMediaCleanup.get(cleanupKey) ?? 0
    if (Date.now() - lastCleanup >= 6 * 60 * 60_000) {
      lastMediaCleanup.set(cleanupKey, Date.now())
      await cleanupMediaArchive(config, sessionName).catch(() => undefined)
    }
  }

  await mutateRecords(config, sessionName, (records) => {
    if (records.some((record) => record.id === id && record.chatId === chatId)) return
    records.push({
      id,
      chatId,
      sender: senderOf(message),
      messageType: messageType(message),
      originalText: messageText(message).slice(0, 8_000),
      receivedAt: new Date(Number(message.messageTimestamp ?? 0) * 1000 || Date.now()).toISOString(),
      hasMedia: Boolean(media),
      changeKind: null,
      changedAt: null,
      editedText: null,
    })
  })
}

export async function markMessageDeleted(
  config: AppConfig,
  sessionName: string,
  key: MessageKey,
): Promise<void> {
  if (!key.id) return
  await mutateRecords(config, sessionName, (records) => {
    const record = [...records].reverse().find((entry) => sameMessage(entry, key))
    if (!record) return
    record.changeKind = 'supprime'
    record.changedAt = new Date().toISOString()
  })
}

export async function markMessageEdited(
  config: AppConfig,
  sessionName: string,
  key: MessageKey,
  editedMessage: proto.IMessage,
): Promise<void> {
  if (!key.id) return
  const editedText = messageText({ key, message: editedMessage }).slice(0, 8_000)
  await mutateRecords(config, sessionName, (records) => {
    const record = [...records].reverse().find((entry) => sameMessage(entry, key))
    if (!record || editedText === record.originalText) return
    record.changeKind = 'modifie'
    record.changedAt = new Date().toISOString()
    record.editedText = editedText
  })
}

export function protocolMutation(message: WAMessage): ProtocolMutation | undefined {
  const content = unwrapMessage(message.message)
  const protocol = content?.protocolMessage
  if (!protocol?.key) return undefined
  const key: MessageKey = {
    ...protocol.key,
    remoteJid: protocol.key.remoteJid ?? message.key.remoteJid,
  }
  if (protocol.editedMessage) return { kind: 'modifie', key, editedMessage: protocol.editedMessage }
  const type = protocol.type as unknown
  const revoked = type === 0 || String(type).toUpperCase().includes('REVOKE')
  return revoked ? { kind: 'supprime', key } : undefined
}

export async function recordProtocolMutation(
  config: AppConfig,
  sessionName: string,
  mutation: ProtocolMutation,
): Promise<void> {
  if (mutation.kind === 'supprime') {
    await markMessageDeleted(config, sessionName, mutation.key)
    return
  }
  if (mutation.editedMessage) await markMessageEdited(config, sessionName, mutation.key, mutation.editedMessage)
}

export async function recordDirectMessageUpdate(
  config: AppConfig,
  sessionName: string,
  key: MessageKey,
  update: unknown,
): Promise<void> {
  if (!update || typeof update !== 'object') return
  const message = (update as { message?: proto.IMessage | null }).message
  if (!message) return
  const wrapped: WAMessage = { key, message }
  const mutation = protocolMutation(wrapped)
  if (mutation) {
    await recordProtocolMutation(config, sessionName, mutation)
    return
  }
  await markMessageEdited(config, sessionName, key, message)
}

export async function changedMessages(
  config: AppConfig,
  sessionName: string,
  chatId: string,
  limit = 15,
): Promise<MessageHistoryRecord[]> {
  const records = await readRecords(config, sessionName)
  return records
    .filter((record) => record.chatId === chatId && record.changeKind !== null)
    .slice(-Math.max(1, Math.min(50, limit)))
    .reverse()
}
