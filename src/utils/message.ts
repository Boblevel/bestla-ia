import {
  downloadContentFromMessage,
  downloadMediaMessage,
  type DownloadableMessage,
  type MediaType,
  type proto,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import { baileysLogger } from '../core/logger.js'
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
  // Quand une personne répond à un statut, WhatsApp conserve le vrai chat
  // d'origine dans contextInfo.remoteJid (= status@broadcast). Le préserver
  // permet ensuite à downloadMediaMessage de reconstruire une clé correcte.
  const remoteJid = context.remoteJid ?? message.key.remoteJid ?? null
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

export async function downloadMedia(message: WAMessage, maxBytes: number, sock?: WASocket): Promise<{
  buffer: Buffer
  type: MediaType
  mimetype: string
}> {
  const media = findMedia(message)
  if (!media) throw new Error('Aucun média trouvé.')

  // Avec le socket, Baileys peut demander à un autre appareil lié de réenvoyer
  // un média dont l'URL CDN WhatsApp a expiré. Cela améliore aussi les médias
  // éphémères encore récupérables par la session, sans conserver de copie locale.
  if (sock) {
    const downloadWithBaileys = async (): Promise<Buffer> => {
      const result = await downloadMediaMessage(
        message,
        'buffer',
        {},
        { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage },
      )
      return Buffer.isBuffer(result) ? result : Buffer.from(result as Uint8Array)
    }

    try {
      const buffer = await downloadWithBaileys()
      if (buffer.length > maxBytes) throw new Error('Le média dépasse la taille maximale autorisée.')
      return { buffer, type: media.type, mimetype: media.mimetype }
    } catch {
      // Baileys rc14 possède un défaut connu où l'appel automatique à reuploadRequest
      // peut ne pas être déclenché après un 410. On demande donc aussi la réémission
      // explicitement avant une seconde tentative. La méthode met à jour le message
      // reçu avec une nouvelle référence média lorsqu'un appareil lié possède encore le fichier.
      try {
        await sock.updateMediaMessage(message)
        const buffer = await downloadWithBaileys()
        if (buffer.length > maxBytes) throw new Error('Le média dépasse la taille maximale autorisée.')
        return { buffer, type: media.type, mimetype: media.mimetype }
      } catch {
        // Ne casse pas les commandes média déjà validées : dernier repli sur le flux CDN classique.
      }
    }
  }

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
