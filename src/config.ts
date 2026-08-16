import 'dotenv/config'
import path from 'node:path'
import { z } from 'zod'

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() === 'true')

const schema = z
  .object({
    BOT_NAME: z.string().trim().min(1).default('Bestla iA'),
    BOT_SIGNATURE: z.string().trim().min(1).max(80).default('RHAFF SERVICE'),
    PREFIX: z.string().min(1).max(4).default('.'),
    OWNER_NUMBERS: z.string().default(''),
    PUBLIC_MODE: booleanFromEnv.default(true),
    SESSION_NAMES: z.string().default('main'),
    AUTH_MODE: z.enum(['qr', 'pairing']).default('qr'),
    SESSION_PHONES: z.string().default(''),
    // Facultatif : permet de choisir QR ou code de liaison pour chaque compte.
    // Exemple : main:qr,boutique:pairing
    SESSION_AUTH_MODES: z.string().default(''),
    DATA_DIR: z.string().default('./data'),
    COMMANDS_ENABLED: booleanFromEnv.default(true),
    COMMAND_REACTIONS: booleanFromEnv.default(true),
    MARK_READ: booleanFromEnv.default(false),
    ALWAYS_ONLINE: booleanFromEnv.default(false),
    REJECT_CALLS: booleanFromEnv.default(false),
    WARN_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
    MAX_MEDIA_MB: z.coerce.number().int().min(1).max(100).default(20),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TIMEZONE: z.string().default('Africa/Ouagadougou'),
    API_ENABLED: booleanFromEnv.default(false),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_KEY: z.string().default(''),
    API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),
    WEBHOOK_URL: z.string().default(''),
    WEBHOOK_SECRET: z.string().default(''),
    CUSTOM_PLUGINS_DIR: z.string().default('./custom-plugins'),
    // Assistant IA facultatif. Aucun appel externe n'est effectué tant que
    // AI_PROVIDER reste sur "none".
    AI_PROVIDER: z.enum(['none', 'openai-compatible', 'gemini']).default('none'),
    AI_API_KEY: z.string().default(''),
    AI_MODEL: z.string().default(''),
    AI_BASE_URL: z.string().default(''),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(2_000).default(700),
    AI_PUBLIC: booleanFromEnv.default(false),
    // Génération et modification de médias IA. Pollinations peut être autorisé
    // automatiquement depuis le panneau par OAuth device-flow, sans coller de clé.
    POLLINATIONS_API_KEY: z.string().default(''),
    POLLINATIONS_TEXT_MODEL: z.string().default('openai-fast'),
    MEDIA_AI_PROVIDER: z.enum(['pollinations', 'gemini']).default('pollinations'),
    MEDIA_AI_ENABLED: booleanFromEnv.default(false),
    MEDIA_AI_PUBLIC: booleanFromEnv.default(false),
    MEDIA_AI_API_KEY: z.string().default(''),
    MEDIA_AI_IMAGE_MODEL: z.string().default('flux'),
    MEDIA_AI_IMAGE_EDIT_MODEL: z.string().default('kontext'),
    MEDIA_AI_IMAGE_ASPECT_RATIO: z.string().default('1:1'),
    MEDIA_AI_IMAGE_SIZE: z.enum(['512px', '1K', '2K', '4K']).default('1K'),
    MEDIA_AI_VIDEO_MODEL: z.string().default('wan-fast'),
    MEDIA_AI_VIDEO_ASPECT_RATIO: z.enum(['9:16', '16:9']).default('9:16'),
    MEDIA_AI_VIDEO_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(1_800).default(600),
  })
  .superRefine((value, ctx) => {
    if (value.API_ENABLED && value.API_KEY.length < 24) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_KEY'],
        message: 'API_KEY doit contenir au moins 24 caractères lorsque API_ENABLED=true.',
      })
    }
    if (value.WEBHOOK_URL && !/^https?:\/\//i.test(value.WEBHOOK_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBHOOK_URL'],
        message: 'WEBHOOK_URL doit commencer par http:// ou https://.',
      })
    }
    if (value.AI_PROVIDER !== 'none' && value.AI_API_KEY.trim().length < 12) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_API_KEY'],
        message: 'AI_API_KEY doit être configurée lorsque AI_PROVIDER est activé.',
      })
    }
    if (value.AI_PROVIDER !== 'none' && !value.AI_MODEL.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_MODEL'],
        message: 'AI_MODEL doit être configuré lorsque AI_PROVIDER est activé.',
      })
    }
    if (value.MEDIA_AI_ENABLED && (value.MEDIA_AI_API_KEY.trim() || value.POLLINATIONS_API_KEY.trim() || value.AI_API_KEY.trim()).length < 12) {
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_AI_API_KEY'],
        message: 'Une clé média IA doit être configurée lorsque MEDIA_AI_ENABLED=true.',
      })
    }
    if (value.AI_BASE_URL && !/^https:\/\//i.test(value.AI_BASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_BASE_URL'],
        message: 'AI_BASE_URL doit commencer par https://.',
      })
    }
  })

const env = schema.parse(process.env)
process.env.TZ = env.TIMEZONE

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function parseSessionNames(value: string): string[] {
  const names = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
  if (names.length === 0) return ['main']
  for (const name of names) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
      throw new Error(`Nom de session invalide : ${name}`)
    }
  }
  return names
}

function parseSessionPhones(value: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const item of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = item.indexOf(':')
    if (separator === -1) continue
    const name = item.slice(0, separator).trim()
    const phone = digitsOnly(item.slice(separator + 1))
    if (name && phone) result.set(name, phone)
  }
  return result
}

function parseSessionAuthModes(value: string, sessionNames: string[]): Map<string, 'qr' | 'pairing'> {
  const result = new Map<string, 'qr' | 'pairing'>()
  for (const item of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = item.indexOf(':')
    if (separator === -1) throw new Error(`Mode de session invalide : ${item}`)
    const name = item.slice(0, separator).trim()
    const mode = item.slice(separator + 1).trim().toLowerCase()
    if (!sessionNames.includes(name)) throw new Error(`Mode défini pour une session inconnue : ${name}`)
    if (mode !== 'qr' && mode !== 'pairing') throw new Error(`Mode invalide pour ${name} : ${mode}`)
    result.set(name, mode)
  }
  return result
}

export interface AppConfig {
  botName: string
  signature: string
  prefix: string
  ownerNumbers: string[]
  publicMode: boolean
  sessionNames: string[]
  authMode: 'qr' | 'pairing'
  sessionPhones: Map<string, string>
  sessionAuthModes: Map<string, 'qr' | 'pairing'>
  dataDir: string
  commandsEnabled: boolean
  commandReactions: boolean
  markRead: boolean
  alwaysOnline: boolean
  rejectCalls: boolean
  warnLimit: number
  maxMediaBytes: number
  logLevel: string
  timezone: string
  api: {
    enabled: boolean
    host: string
    port: number
    key: string
    rateLimitPerMinute: number
  }
  webhook: {
    url: string
    secret: string
  }
  ai: {
    provider: 'none' | 'openai-compatible' | 'gemini'
    apiKey: string
    model: string
    baseUrl: string
    maxOutputTokens: number
    publicAccess: boolean
  }
  pollinations: {
    apiKey: string
    textModel: string
  }
  mediaAi: {
    provider: 'pollinations' | 'gemini'
    enabled: boolean
    publicAccess: boolean
    apiKey: string
    imageModel: string
    imageEditModel: string
    imageAspectRatio: string
    imageSize: '512px' | '1K' | '2K' | '4K'
    videoModel: string
    videoAspectRatio: '9:16' | '16:9'
    videoTimeoutSeconds: number
  }
  customPluginsDir: string
}

export const config: AppConfig = {
  botName: env.BOT_NAME,
  signature: env.BOT_SIGNATURE,
  prefix: env.PREFIX,
  ownerNumbers: env.OWNER_NUMBERS.split(',').map(digitsOnly).filter(Boolean),
  publicMode: env.PUBLIC_MODE,
  sessionNames: parseSessionNames(env.SESSION_NAMES),
  authMode: env.AUTH_MODE,
  sessionPhones: parseSessionPhones(env.SESSION_PHONES),
  sessionAuthModes: parseSessionAuthModes(env.SESSION_AUTH_MODES, parseSessionNames(env.SESSION_NAMES)),
  dataDir: path.resolve(env.DATA_DIR),
  commandsEnabled: env.COMMANDS_ENABLED,
  commandReactions: env.COMMAND_REACTIONS,
  markRead: env.MARK_READ,
  alwaysOnline: env.ALWAYS_ONLINE,
  rejectCalls: env.REJECT_CALLS,
  warnLimit: env.WARN_LIMIT,
  maxMediaBytes: env.MAX_MEDIA_MB * 1024 * 1024,
  logLevel: env.LOG_LEVEL,
  timezone: env.TIMEZONE,
  api: {
    enabled: env.API_ENABLED,
    host: env.API_HOST,
    port: env.API_PORT,
    key: env.API_KEY,
    rateLimitPerMinute: env.API_RATE_LIMIT_PER_MINUTE,
  },
  webhook: {
    url: env.WEBHOOK_URL,
    secret: env.WEBHOOK_SECRET,
  },
  ai: {
    provider: env.AI_PROVIDER,
    apiKey: env.AI_API_KEY.trim(),
    model: env.AI_MODEL.trim(),
    baseUrl: env.AI_BASE_URL.trim().replace(/\/$/, ''),
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    publicAccess: env.AI_PUBLIC,
  },
  pollinations: {
    apiKey: env.POLLINATIONS_API_KEY,
    textModel: env.POLLINATIONS_TEXT_MODEL,
  },
  mediaAi: {
    provider: env.MEDIA_AI_PROVIDER,
    enabled: env.MEDIA_AI_ENABLED,
    publicAccess: env.MEDIA_AI_PUBLIC,
    apiKey: (env.MEDIA_AI_API_KEY || env.POLLINATIONS_API_KEY || env.AI_API_KEY).trim(),
    imageModel: env.MEDIA_AI_IMAGE_MODEL.trim(),
    imageEditModel: env.MEDIA_AI_IMAGE_EDIT_MODEL.trim(),
    imageAspectRatio: env.MEDIA_AI_IMAGE_ASPECT_RATIO.trim(),
    imageSize: env.MEDIA_AI_IMAGE_SIZE,
    videoModel: env.MEDIA_AI_VIDEO_MODEL.trim(),
    videoAspectRatio: env.MEDIA_AI_VIDEO_ASPECT_RATIO,
    videoTimeoutSeconds: env.MEDIA_AI_VIDEO_TIMEOUT_SECONDS,
  },
  customPluginsDir: path.resolve(env.CUSTOM_PLUGINS_DIR),
}
