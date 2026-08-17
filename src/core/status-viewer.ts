import type { WAMessage, WAMessageKey, WASocket } from '@whiskeysockets/baileys'

const STATUS_TTL_MS = 26 * 60 * 60_000
const MAX_STATUS_KEYS = 600
const READ_BATCH_SIZE = 50

type StoredStatus = {
  key: WAMessageKey
  receivedAt: number
}

const statusStores = new WeakMap<WASocket, Map<string, StoredStatus>>()

function statusStore(sock: WASocket): Map<string, StoredStatus> {
  let store = statusStores.get(sock)
  if (!store) {
    store = new Map()
    statusStores.set(sock, store)
  }
  return store
}

function statusIdentity(key: WAMessageKey): string | undefined {
  if (!key.id || !key.remoteJid) return undefined
  return [key.remoteJid, key.participant ?? '', key.id].join('|')
}

function prune(store: Map<string, StoredStatus>, now = Date.now()): void {
  for (const [id, item] of store) {
    if (now - item.receivedAt > STATUS_TTL_MS) store.delete(id)
  }
  while (store.size > MAX_STATUS_KEYS) {
    const oldest = store.keys().next().value as string | undefined
    if (!oldest) break
    store.delete(oldest)
  }
}

/**
 * WhatsApp/Baileys v7 peut livrer les stories soit sur status@broadcast,
 * soit avec un JID numérique @broadcast accompagné des informations du participant.
 */
export function isWhatsAppStatusMessage(message: WAMessage): boolean {
  const remoteJid = message.key.remoteJid ?? ''
  if (remoteJid === 'status@broadcast') return true
  if (!/^\d+@broadcast$/i.test(remoteJid)) return false
  return Boolean(message.key.participant || message.key.participantAlt || message.key.remoteJidAlt)
}

export function rememberStatusMessage(sock: WASocket, message: WAMessage): boolean {
  if (message.key.fromMe === true || !isWhatsAppStatusMessage(message)) return false
  const id = statusIdentity(message.key)
  if (!id) return false
  const now = Date.now()
  const timestampMs = Number(message.messageTimestamp ?? 0) * 1000
  if (timestampMs > 0 && now - timestampMs > STATUS_TTL_MS) return false
  const store = statusStore(sock)
  prune(store, now)
  store.set(id, { key: { ...message.key }, receivedAt: timestampMs > 0 ? timestampMs : now })
  prune(store)
  return true
}

export function pendingStatusCount(sock: WASocket): number {
  const store = statusStore(sock)
  prune(store)
  return store.size
}

export async function markStatusMessageRead(sock: WASocket, message: WAMessage): Promise<boolean> {
  if (message.key.fromMe === true || !isWhatsAppStatusMessage(message) || !message.key.id) return false
  const id = statusIdentity(message.key)
  try {
    await sock.readMessages([message.key])
    if (id) statusStore(sock).delete(id)
    return true
  } catch {
    return false
  }
}

export async function readRememberedStatuses(
  sock: WASocket,
): Promise<{ read: number; failed: number; pendingBefore: number }> {
  const store = statusStore(sock)
  prune(store)
  const entries = [...store.entries()]
  const pendingBefore = entries.length
  let read = 0
  let failed = 0

  for (let offset = 0; offset < entries.length; offset += READ_BATCH_SIZE) {
    const chunk = entries.slice(offset, offset + READ_BATCH_SIZE)
    const keys = chunk.map(([, item]) => item.key)
    try {
      await sock.readMessages(keys)
      read += chunk.length
      for (const [id] of chunk) store.delete(id)
      continue
    } catch {
      // Certains serveurs WhatsApp peuvent refuser un lot contenant une clé devenue
      // obsolète. On retente alors chaque statut afin de ne pas perdre tout le lot.
    }

    for (const [id, item] of chunk) {
      try {
        await sock.readMessages([item.key])
        store.delete(id)
        read += 1
      } catch {
        failed += 1
      }
    }
  }

  return { read, failed, pendingBefore }
}
