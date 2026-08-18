import type { WAMessage, WAMessageKey, WASocket } from '@whiskeysockets/baileys'

const STATUS_TTL_MS = 26 * 60 * 60_000
const MAX_STATUS_KEYS = 600
const READ_BATCH_SIZE = 50

type StoredStatus = {
  key: WAMessageKey
  message: WAMessage
  receivedAt: number
  read: boolean
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
  const previous = store.get(id)
  store.set(id, {
    key: { ...message.key },
    message,
    receivedAt: timestampMs > 0 ? timestampMs : now,
    read: previous?.read ?? false,
  })
  prune(store)
  return true
}

export function pendingStatusCount(sock: WASocket): number {
  const store = statusStore(sock)
  prune(store)
  return [...store.values()].filter((item) => !item.read).length
}

/**
 * Retrouve le message de statut complet mémorisé à partir de la référence citée
 * dans une discussion privée. WhatsApp peut n'inclure qu'un aperçu du statut
 * dans quotedMessage ; le stanzaId reste alors la clé fiable pour retrouver le
 * vrai message média reçu auparavant sur status@broadcast.
 */
export function resolveRememberedStatusMessage(sock: WASocket, reference: WAMessage): WAMessage | undefined {
  const id = reference.key.id
  if (!id) return undefined
  const store = statusStore(sock)
  prune(store)

  const exact = statusIdentity(reference.key)
  if (exact) {
    const found = store.get(exact)
    if (found) return found.message
  }

  const participant = reference.key.participant ?? reference.key.participantAlt ?? reference.key.remoteJidAlt
  for (const item of store.values()) {
    if (item.key.id !== id) continue
    const storedParticipant = item.key.participant ?? item.key.participantAlt ?? item.key.remoteJidAlt
    if (!participant || !storedParticipant || participant === storedParticipant) return item.message
  }

  // Les identifiants de message WhatsApp sont suffisamment spécifiques pour
  // servir de dernier repli lorsque le client a converti le participant JID/LID.
  for (const item of store.values()) {
    if (item.key.id === id) return item.message
  }
  return undefined
}

export async function markStatusMessageRead(sock: WASocket, message: WAMessage): Promise<boolean> {
  if (message.key.fromMe === true || !isWhatsAppStatusMessage(message) || !message.key.id) return false
  const id = statusIdentity(message.key)
  try {
    await sock.readMessages([message.key])
    if (id) {
      const store = statusStore(sock)
      const item = store.get(id)
      if (item) item.read = true
    }
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
  const entries = [...store.entries()].filter(([, item]) => !item.read)
  const pendingBefore = entries.length
  let read = 0
  let failed = 0

  for (let offset = 0; offset < entries.length; offset += READ_BATCH_SIZE) {
    const chunk = entries.slice(offset, offset + READ_BATCH_SIZE)
    const keys = chunk.map(([, item]) => item.key)
    try {
      await sock.readMessages(keys)
      read += chunk.length
      for (const [, item] of chunk) item.read = true
      continue
    } catch {
      // Certains serveurs WhatsApp peuvent refuser un lot contenant une clé devenue
      // obsolète. On retente alors chaque statut afin de ne pas perdre tout le lot.
    }

    for (const [id, item] of chunk) {
      try {
        await sock.readMessages([item.key])
        item.read = true
        read += 1
      } catch {
        failed += 1
      }
    }
  }

  return { read, failed, pendingBefore }
}
