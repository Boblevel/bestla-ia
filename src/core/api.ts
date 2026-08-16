import { timingSafeEqual } from 'node:crypto'
import type { Server } from 'node:http'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { z } from 'zod'
import type { AppConfig } from '../config.js'
import { normalizeDestination } from '../utils/jid.js'
import { safeFetchBuffer } from '../utils/safe-fetch.js'
import { logger } from './logger.js'
import type { CommandRegistry } from './registry.js'
import type { SessionManager } from './session-manager.js'

const sendSchema = z.discriminatedUnion('type', [
  z.object({
    session: z.string().min(1).default('main'),
    to: z.string().min(7).max(80),
    type: z.literal('text'),
    text: z.string().min(1).max(10_000),
  }),
  z.object({
    session: z.string().min(1).default('main'),
    to: z.string().min(7).max(80),
    type: z.enum(['image', 'video', 'audio', 'document']),
    url: z.url().max(2_000),
    caption: z.string().max(4_096).default(''),
    mimetype: z.string().max(100).optional(),
    fileName: z.string().max(255).optional(),
    ptt: z.boolean().default(false),
  }),
])

function constantTimeEqual(received: string, expected: string): boolean {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

class ApiRateLimiter {
  private readonly requests = new Map<string, number[]>()

  constructor(private readonly limit: number) {}

  allow(key: string): boolean {
    const now = Date.now()
    const recent = (this.requests.get(key) ?? []).filter((timestamp) => now - timestamp < 60_000)
    if (recent.length >= this.limit) {
      this.requests.set(key, recent)
      return false
    }
    recent.push(now)
    this.requests.set(key, recent)
    if (this.requests.size > 5_000) {
      for (const [entry, timestamps] of this.requests) {
        if (!timestamps.some((timestamp) => now - timestamp < 60_000)) this.requests.delete(entry)
      }
    }
    return true
  }
}

export function startApi(
  config: AppConfig,
  sessions: SessionManager,
  registry: CommandRegistry,
): Promise<Server | undefined> {
  if (!config.api.enabled) return Promise.resolve(undefined)
  const app = express()
  const limiter = new ApiRateLimiter(config.api.rateLimitPerMinute)
  app.disable('x-powered-by')
  app.set('trust proxy', false)
  app.use(helmet())
  app.use(express.json({ limit: '64kb' }))

  app.get('/health', (_request, response) => {
    const statuses = sessions.status()
    response.json({
      ok: true,
      service: 'bestla-ia-bot',
      sessions: statuses.length,
      connected: statuses.filter((status) => status.connected).length,
      uptimeSeconds: Math.floor(process.uptime()),
    })
  })

  app.use('/api', (request, response, next) => {
    const client = request.socket.remoteAddress ?? 'unknown'
    if (!limiter.allow(client)) return void response.status(429).json({ error: 'Trop de requêtes.' })
    const key = request.header('x-api-key') ?? ''
    if (!constantTimeEqual(key, config.api.key)) return void response.status(401).json({ error: 'Clé API invalide.' })
    next()
  })

  app.get('/api/sessions', (_request, response) => {
    response.json({ sessions: sessions.status() })
  })

  app.get('/api/commands', (_request, response) => {
    response.json({
      commands: registry.list().map(({ name, aliases, description, category }) => ({
        name,
        aliases: aliases ?? [],
        description,
        category,
      })),
    })
  })

  app.post('/api/send', async (request, response) => {
    const parsed = sendSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Corps invalide.', details: z.flattenError(parsed.error) })
      return
    }
    const payload = parsed.data
    const to = normalizeDestination(payload.to)
    if (!to) return void response.status(400).json({ error: 'Destinataire invalide.' })

    try {
      if (payload.type === 'text') {
        const result = await sessions.send(payload.session, to, { text: payload.text })
        response.status(201).json({ id: result?.key.id ?? null })
        return
      }

      const media = await safeFetchBuffer(payload.url, config.maxMediaBytes)
      const mimetype = payload.mimetype ?? media.contentType
      const common = { mimetype, caption: payload.caption }
      let result
      switch (payload.type) {
        case 'image':
          result = await sessions.send(payload.session, to, { image: media.buffer, ...common })
          break
        case 'video':
          result = await sessions.send(payload.session, to, { video: media.buffer, ...common })
          break
        case 'audio':
          result = await sessions.send(payload.session, to, {
            audio: media.buffer,
            mimetype,
            ptt: payload.ptt,
          })
          break
        case 'document':
          result = await sessions.send(payload.session, to, {
            document: media.buffer,
            mimetype,
            fileName: payload.fileName ?? 'document',
            caption: payload.caption,
          })
          break
      }
      response.status(201).json({ id: result?.key.id ?? null })
    } catch (error) {
      logger.warn({ err: error }, 'Échec de la route API /api/send')
      response.status(502).json({ error: error instanceof Error ? error.message : 'Envoi impossible.' })
    }
  })

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'Erreur API non gérée')
    response.status(500).json({ error: 'Erreur interne.' })
  })

  return new Promise((resolve, reject) => {
    const server = app.listen(config.api.port, config.api.host, () => {
      logger.info({ host: config.api.host, port: config.api.port }, 'API HTTP démarrée')
      resolve(server)
    })
    server.once('error', reject)
  })
}
