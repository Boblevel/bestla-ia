import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Boom } from '@hapi/boom'
import makeWASocket, {
  type AnyMessageContent,
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  type MiscMessageGenerationOptions,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import type { AppConfig } from '../config.js'
import type { SessionStatus } from '../types.js'
import { normalizeUserJid } from '../utils/jid.js'
import { baileysLogger, logger } from './logger.js'

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
}

type MessageHandler = (runtime: SessionRuntime, message: WAMessage) => Promise<void>
type ParticipantsHandler = (
  runtime: SessionRuntime,
  event: { id: string; participants: string[]; action: string },
) => Promise<void>

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>()
  private stopping = false

  constructor(
    private readonly config: AppConfig,
    private readonly onMessage: MessageHandler,
    private readonly onParticipants: ParticipantsHandler,
  ) {}

  async start(): Promise<void> {
    await mkdir(path.join(this.config.dataDir, 'sessions'), { recursive: true })
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
      shouldSyncHistoryMessage: () => false,
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
              logger.info({ session: name }, 'Code de liaison WhatsApp généré')
              process.stdout.write(`\n[${name}] CODE DE LIAISON : ${code}\n\n`)
            } catch (error) {
              session.pairingRequested = false
              logger.error({ err: error, session: name }, 'Impossible de générer le code de liaison')
            }
          }
        } else {
          process.stdout.write(`\n[${name}] Scanne ce QR dans WhatsApp > Appareils connectés :\n`)
          qrcode.generate(qr, { small: true })
        }
      }

      if (connection === 'open') {
        session.connected = true
        session.pairingRequested = false
        logger.info({ session: name, jid: sock.user?.id }, 'Session WhatsApp connectée')
      }

      if (connection === 'close') {
        session.connected = false
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !this.stopping
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
      if (type !== 'notify') return
      for (const message of messages) {
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
