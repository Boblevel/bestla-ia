import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Boom } from '@hapi/boom'
import makeWASocket, {
  type AnyMessageContent,
  Browsers,
  DisconnectReason,
  proto,
  useMultiFileAuthState,
  type MiscMessageGenerationOptions,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import type { SessionStatus } from '../types.js'
import { normalizeUserJid } from '../utils/jid.js'
import { baileysLogger, logger } from './logger.js'
import { isWhatsAppStatusMessage, markStatusMessageRead, rememberStatusMessage } from './status-viewer.js'

export interface SessionRuntime {
  name: string
  sock: WASocket
  send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined>
}

interface ManagedSession {
  name: string
  sock: WASocket
  connected: boolean
  pairingRequested: boolean
  reconnectTimer?: NodeJS.Timeout
  generatedIds: Map<string, number>
  connectedAt: number
}

type MessageHandler = (runtime: SessionRuntime, message: WAMessage) => Promise<void>
type ParticipantsHandler = (
  runtime: SessionRuntime,
  event: { id: string; participants: string[]; action: string },
) => Promise<void>

type LinkingArtifactType = 'qr' | 'pairing'

interface LinkingArtifact {
  session: string
  type: LinkingArtifactType
  value: string
  createdAt: string
}

interface SessionRuntimeStatusArtifact {
  session: string
  linked: boolean
  connected: boolean
  jid: string | null
  updatedAt: string
}

async function saveSessionRuntimeStatus(
  dataDir: string,
  session: string,
  linked: boolean,
  connected: boolean,
  jid: string | null,
): Promise<void> {
  const directory = path.join(dataDir, 'session-status')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const status: SessionRuntimeStatusArtifact = {
    session,
    linked,
    connected,
    jid,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(path.join(directory, `${session}.json`), `${JSON.stringify(status)}
`, { mode: 0o600 })
}

async function saveLinkingArtifact(
  dataDir: string,
  session: string,
  type: LinkingArtifactType,
  value: string,
): Promise<void> {
  const directory = path.join(dataDir, 'linking')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const artifact: LinkingArtifact = {
    session,
    type,
    value,
    createdAt: new Date().toISOString(),
  }
  await writeFile(path.join(directory, `${session}.json`), `${JSON.stringify(artifact)}\n`, { mode: 0o600 })
}

async function clearLinkingArtifact(dataDir: string, session: string): Promise<void> {
  await rm(path.join(dataDir, 'linking', `${session}.json`), { force: true }).catch(() => undefined)
}

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>()
  private stopping = false

  constructor(
    private readonly config: AppConfig,
    private readonly onMessage: MessageHandler,
    private readonly onParticipants: ParticipantsHandler,
    private readonly shouldAutoReadStatuses: () => boolean = () => false,
  ) {}

  async start(): Promise<void> {
    await mkdir(path.join(this.config.dataDir, 'sessions'), { recursive: true })
    await mkdir(path.join(this.config.dataDir, 'linking'), { recursive: true, mode: 0o700 })
    await mkdir(path.join(this.config.dataDir, 'session-status'), { recursive: true, mode: 0o700 })
    await Promise.all(this.config.sessionNames.map((name) => this.connect(name)))
  }

  status(): SessionStatus[] {
    return this.config.sessionNames.map((name) => {
      const session = this.sessions.get(name)
      const jid = session?.sock.user?.id ? normalizeUserJid(session.sock.user.id) : null
      return {
        name,
        connected: session?.connected ?? false,
        jid,
        phone: jid?.split('@')[0]?.split(':')[0] ?? null,
      }
    })
  }

  get(name: string): SessionRuntime | undefined {
    const session = this.sessions.get(name)
    if (!session) return undefined
    return this.runtime(session)
  }

  async send(
    sessionName: string,
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined> {
    const session = this.sessions.get(sessionName)
    if (!session?.connected) throw new Error(`Session indisponible : ${sessionName}`)
    return this.sendTracked(session, jid, content, options)
  }

  async stop(): Promise<void> {
    this.stopping = true
    for (const session of this.sessions.values()) {
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
      session.sock.end(new Error('Arrêt demandé'))
    }
    this.sessions.clear()
  }

  private async connect(name: string): Promise<void> {
    if (this.stopping) return
    const authDirectory = path.join(this.config.dataDir, 'sessions', name)
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory)
    const sock = makeWASocket({
      auth: state,
      logger: baileysLogger,
      browser: Browsers.ubuntu(`${this.config.botName}-${name}`),
      markOnlineOnConnect: this.config.alwaysOnline,
      syncFullHistory: false,
      // Conserve les synchronisations essentielles (bootstrap, récent, mappings LID/PN)
      // tout en refusant l'historique complet.
      shouldSyncHistoryMessage: ({ syncType }) =>
        syncType !== proto.HistorySync.HistorySyncType.FULL,
      generateHighQualityLinkPreview: false,
    })

    const previous = this.sessions.get(name)
    if (previous?.reconnectTimer) clearTimeout(previous.reconnectTimer)
    const session: ManagedSession = {
      name,
      sock,
      connected: false,
      pairingRequested: false,
      generatedIds: previous?.generatedIds ?? new Map(),
      connectedAt: previous?.connectedAt ?? 0,
    }
    this.sessions.set(name, session)
    const runtime = this.runtime(session)

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && !state.creds.registered) {
        const authMode = this.config.sessionAuthModes.get(name) ?? this.config.authMode
        if (authMode === 'pairing') {
          const phone = this.config.sessionPhones.get(name)
          if (!phone) {
            logger.error({ session: name }, 'Numéro absent dans SESSION_PHONES pour le mode pairing')
          } else if (!session.pairingRequested) {
            session.pairingRequested = true
            try {
              const code = await sock.requestPairingCode(phone)
              await saveLinkingArtifact(this.config.dataDir, name, 'pairing', code)
              logger.info({ session: name }, 'Code de liaison WhatsApp prêt dans le panneau Numéros WhatsApp')
            } catch (error) {
              session.pairingRequested = false
              logger.error({ err: error, session: name }, 'Impossible de générer le code de liaison')
            }
          }
        } else {
          await saveLinkingArtifact(this.config.dataDir, name, 'qr', qr)
          logger.info({ session: name }, 'QR WhatsApp prêt dans le panneau Numéros WhatsApp')
        }
      }

      if (connection === 'open') {
        session.connected = true
        session.connectedAt = Date.now()
        session.pairingRequested = false
        await clearLinkingArtifact(this.config.dataDir, name)
        await saveSessionRuntimeStatus(
          this.config.dataDir,
          name,
          true,
          true,
          sock.user?.id ? normalizeUserJid(sock.user.id) : null,
        )
        logger.info({ session: name, jid: sock.user?.id }, 'Session WhatsApp connectée')
      }

      if (connection === 'close') {
        session.connected = false
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !this.stopping
        const linked = statusCode === DisconnectReason.loggedOut
          ? false
          : Boolean(state.creds.registered || sock.user?.id)
        await saveSessionRuntimeStatus(
          this.config.dataDir,
          name,
          linked,
          false,
          sock.user?.id ? normalizeUserJid(sock.user.id) : null,
        )
        logger.warn({ session: name, statusCode, shouldReconnect }, 'Session WhatsApp déconnectée')
        if (shouldReconnect) {
          session.reconnectTimer = setTimeout(() => void this.connect(name), 5_000)
        } else if (statusCode === DisconnectReason.loggedOut) {
          logger.error(
            { session: name, authDirectory },
            'Session révoquée. Ouvre le panneau « bestla », puis Numéros WhatsApp > Réinitialiser une liaison.',
          )
        }
      }
    })

    sock.ev.on('messages.upsert', async ({ type, messages }) => {
      logger.info(
        { session: name, upsertType: type, count: messages.length },
        'Événement messages.upsert reçu',
      )

      for (const message of messages) {
        const fromMe = message.key.fromMe === true
        const timestampMs = Number(message.messageTimestamp ?? 0) * 1000
        const ageMs = timestampMs > 0 ? Math.abs(Date.now() - timestampMs) : Number.POSITIVE_INFINITY
        const recentAppend =
          type === 'append' &&
          !fromMe &&
          session.connectedAt > 0 &&
          Date.now() - session.connectedAt > 5_000 &&
          ageMs <= 120_000

        logger.info(
          {
            session: name,
            upsertType: type,
            messageId: message.key.id ?? null,
            remoteJid: message.key.remoteJid ?? null,
            remoteJidAlt: message.key.remoteJidAlt ?? null,
            participant: message.key.participant ?? null,
            participantAlt: message.key.participantAlt ?? null,
            addressingMode: message.key.addressingMode ?? null,
            fromMe,
            hasMessage: Boolean(message.message),
            timestampAgeMs: Number.isFinite(ageMs) ? ageMs : null,
            recentAppend,
          },
          'Message WhatsApp reçu par Baileys',
        )

        if (isWhatsAppStatusMessage(message)) {
          const remembered = rememberStatusMessage(sock, message)
          if (!fromMe && remembered && this.shouldAutoReadStatuses()) {
            const read = await markStatusMessageRead(sock, message)
            logger.info(
              { session: name, messageId: message.key.id ?? null, read },
              'Statut WhatsApp traité automatiquement',
            )
          }
          // Les statuts ne sont jamais envoyés au routeur de commandes/Assistantauto.
          continue
        }

        // "notify" est le chemin normal des nouveaux messages. Certains flux récents
        // peuvent cependant arriver en "append" ; on ne les traite que s'ils sont
        // manifestement récents afin de ne jamais répondre à l'historique ancien.
        if (type !== 'notify' && !recentAppend) continue
        if (this.isGenerated(session, message.key.id)) continue

        await this.onMessage(runtime, message).catch((error) => {
          logger.error({ err: error, session: name }, 'Erreur de traitement d’un message')
        })
      }
    })

    sock.ev.on('group-participants.update', async (event) => {
      await this.onParticipants(runtime, {
        id: event.id,
        participants: event.participants
          .map((participant) => (typeof participant === 'string' ? participant : participant.id))
          .filter((participant): participant is string => Boolean(participant)),
        action: event.action,
      }).catch((error) => {
        logger.error({ err: error, session: name }, 'Erreur de traitement des participants')
      })
    })

    if (this.config.rejectCalls) {
      sock.ev.on('call', async (calls) => {
        for (const call of calls) {
          if (call.status !== 'offer') continue
          await sock.rejectCall(call.id, call.from).catch(() => undefined)
          await this.sendTracked(session, call.from, {
            text: 'Les appels sont désactivés sur ce numéro. Merci d’envoyer un message.',
          }).catch(() => undefined)
        }
      })
    }
  }

  private runtime(session: ManagedSession): SessionRuntime {
    return {
      name: session.name,
      sock: session.sock,
      send: (jid, content, options) => this.sendTracked(session, jid, content, options),
    }
  }

  private async sendTracked(
    session: ManagedSession,
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined> {
    const result = await session.sock.sendMessage(jid, content, options)
    if (result?.key.id) session.generatedIds.set(result.key.id, Date.now() + 120_000)
    if (session.generatedIds.size > 2_000) this.cleanupGenerated(session)
    return result
  }

  private isGenerated(session: ManagedSession, id: string | null | undefined): boolean {
    if (!id) return false
    const expiresAt = session.generatedIds.get(id)
    if (!expiresAt) return false
    session.generatedIds.delete(id)
    return expiresAt > Date.now()
  }

  private cleanupGenerated(session: ManagedSession): void {
    const now = Date.now()
    for (const [id, expiresAt] of session.generatedIds) {
      if (expiresAt <= now) session.generatedIds.delete(id)
    }
  }
}
