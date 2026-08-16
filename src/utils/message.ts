import {
  downloadContentFromMessage,
  type DownloadableMessage,
  type MediaType,
  type proto,
  type WAMessage,
} from '@whiskeysockets/baileys'
import { unwrapMessage } from './text.js'

function contextInfoFromContent(content: proto.IMessage | undefined): proto.IContextInfo | undefined {
  if (!content) return undefined
  for (const value of Object.values(content)) {
    if (value && typeof value === 'object' && 'contextInfo' in value) {
      return (value as { contextInfo?: proto.IContextInfo }).contextInfo
    }
  }
  return undefined
}

export function contextInfo(message: WAMessage): proto.IContextInfo | undefined {
  return contextInfoFromContent(unwrapMessage(message.message))
}

export function mentionedJids(message: WAMessage): string[] {
  return (contextInfo(message)?.mentionedJid ?? []).filter((jid): jid is string => Boolean(jid))
}

export function quotedAsMessage(message: WAMessage): WAMessage | undefined {
  const context = contextInfo(message)
  if (!context?.quotedMessage) return undefined
  const remoteJid = message.key.remoteJid ?? null
  return {
    key: {
      remoteJid,
      ...(context.stanzaId ? { id: context.stanzaId } : {}),
      ...(context.participant ? { participant: context.participant } : {}),
      fromMe: false,
    },
    message: context.quotedMessage,
  }
}

type MediaNode = DownloadableMessage & { mimetype?: string | null }

export interface DownloadableMedia {
  node: MediaNode
  type: MediaType
  mimetype: string
}

export function findMedia(message: WAMessage): DownloadableMedia | undefined {
  const content = unwrapMessage(message.message)
  if (!content) return undefined

  const entries: Array<[keyof proto.IMessage, MediaType]> = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'document'],
    ['stickerMessage', 'sticker'],
  ]

  for (const [key, type] of entries) {
    const node = content[key] as MediaNode | null | undefined
    if (node) return { node, type, mimetype: node.mimetype ?? 'application/octet-stream' }
  }
  return undefined
}

export async function downloadMedia(message: WAMessage, maxBytes: number): Promise<{
  buffer: Buffer
  type: MediaType
  mimetype: string
}> {
  const media = findMedia(message)
  if (!media) throw new Error('Aucun média trouvé.')

  const stream = await downloadContentFromMessage(media.node, media.type)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('Le média dépasse la taille maximale autorisée.')
    chunks.push(buffer)
  }
  return { buffer: Buffer.concat(chunks), type: media.type, mimetype: media.mimetype }
}
