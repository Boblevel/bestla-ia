import 'dotenv/config'
import path from 'node:path'
import { z } from 'zod'

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() === 'true')

const schema = z.object({
  BOT_NAME: z.string().trim().min(1).default('Bestla iA'),
  BOT_SIGNATURE: z.string().trim().min(1).max(80).default('RHAFF SERVICE'),
  PREFIX: z.string().min(1).max(4).default('.'),
  OWNER_NUMBERS: z.string().default(''),
  PUBLIC_MODE: booleanFromEnv.default(true),
  SESSION_NAMES: z.string().default('main'),
  AUTH_MODE: z.enum(['qr', 'pairing']).default('qr'),
  SESSION_PHONES: z.string().default(''),
  SESSION_AUTH_MODES: z.string().default(''),
  DATA_DIR: z.string().default('./data'),
  COMMANDS_ENABLED: booleanFromEnv.default(true),
  COMMAND_REACTIONS: booleanFromEnv.default(true),
  MARK_READ: booleanFromEnv.default(false),
  ALWAYS_ONLINE: booleanFromEnv.default(false),
  REJECT_CALLS: booleanFromEnv.default(false),
  WARN_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
  MAX_MEDIA_MB: z.coerce.number().int().min(1).max(100).default(20),
  MAX_APK_MB: z.coerce.number().int().min(1).max(200).default(100),
  MEDIA_ARCHIVE_ENABLED: booleanFromEnv.default(true),
  MEDIA_ARCHIVE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  MEDIA_ARCHIVE_BACKFILL_DAYS: z.coerce.number().int().min(0).max(90).default(30),
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

  AI_PROVIDER: z.string().default('gemini'),
  AI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('gemini-3.6-flash'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(2_000).default(700),
  AI_PUBLIC: booleanFromEnv.default(false),

  MEDIA_AI_ENABLED: booleanFromEnv.default(true),
  MEDIA_AI_PUBLIC: booleanFromEnv.default(false),
  MEDIA_AI_PROVIDER: z.string().default('mixed'),
  MEDIA_AI_API_KEY: z.string().default(''),
  HF_TOKEN: z.string().default(''),
  MEDIA_AI_HF_TOKEN: z.string().default(''),
  MEDIA_AI_IMAGE_PROVIDER: z.enum(['cloudflare', 'gemini']).default('cloudflare'),
  MEDIA_AI_VIDEO_PROVIDER: z.enum(['huggingface']).default('huggingface'),
  MEDIA_AI_CLOUDFLARE_ACCOUNT_ID: z.string().default(''),
  MEDIA_AI_CLOUDFLARE_API_TOKEN: z.string().default(''),
  MEDIA_AI_IMAGE_MODEL: z.string().default('@cf/black-forest-labs/flux-1-schnell'),
  MEDIA_AI_IMAGE_EDIT_MODEL: z.string().default('gemini-3.1-flash-image'),
  MEDIA_AI_IMAGE_ASPECT_RATIO: z.string().default('1:1'),
  MEDIA_AI_IMAGE_SIZE: z.enum(['512px', '1K', '2K', '4K']).default('1K'),
  MEDIA_AI_VIDEO_MODEL: z.string().default('MiniMaxAI/MiniMax-H3'),
  MEDIA_AI_VIDEO_SPACE: z.string().default('https://multimodalart-minimax-h3.hf.space'),
  MEDIA_AI_VIDEO_API_NAME: z.string().default('/generate'),
  MEDIA_AI_VIDEO_ASPECT_RATIO: z.enum(['9:16', '16:9']).default('9:16'),
  MEDIA_AI_VIDEO_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(1_800).default(900),
}).superRefine((value, ctx) => {
  if (value.API_ENABLED && value.API_KEY.length < 24) {
    ctx.addIssue({ code: 'custom', path: ['API_KEY'], message: 'API_KEY doit contenir au moins 24 caractères lorsque API_ENABLED=true.' })
  }
  if (value.WEBHOOK_URL && !/^https?:\/\//i.test(value.WEBHOOK_URL)) {
    ctx.addIssue({ code: 'custom', path: ['WEBHOOK_URL'], message: 'WEBHOOK_URL doit commencer par http:// ou https://.' })
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
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) throw new Error(`Nom de session invalide : ${name}`)
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

const runtimeGeminiKey = env.AI_API_KEY.trim() || env.MEDIA_AI_API_KEY.trim()
const runtimeHfToken = env.MEDIA_AI_HF_TOKEN.trim() || env.HF_TOKEN.trim()

const LEGACY_GEMINI_TEXT_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.5-flash',
])

function normalizeGeminiTextModel(value: string): string {
  const model = value.trim()
  if (!model || LEGACY_GEMINI_TEXT_MODELS.has(model)) return 'gemini-3.6-flash'
  return model
}

function normalizeHuggingFaceVideoModel(value: string): string {
  const model = value.trim()
  if (!model || model === 'Lightricks/LTX-Video') return 'MiniMaxAI/MiniMax-H3'
  return model
}

function normalizeHuggingFaceSpaceUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, '')
  if (!url || url === 'https://lightricks-ltx-video-distilled.hf.space') return 'https://multimodalart-minimax-h3.hf.space'
  return url
}

function normalizeHuggingFaceApiName(value: string): string {
  const apiName = value.trim()
  if (!apiName || apiName === '/text_to_video' || apiName === 'text_to_video') return '/generate'
  return apiName.startsWith('/') ? apiName : `/${apiName}`
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
  maxApkBytes: number
  mediaArchive: { enabled: boolean; retentionDays: number; backfillDays: number }
  logLevel: string
  timezone: string
  api: { enabled: boolean; host: string; port: number; key: string; rateLimitPerMinute: number }
  webhook: { url: string; secret: string }
  ai: {
    provider: 'gemini'
    apiKey: string
    model: string
    maxOutputTokens: number
    publicAccess: boolean
  }
  mediaAi: {
    provider: 'mixed'
    enabled: boolean
    publicAccess: boolean
    apiKey: string
    imageProvider: 'cloudflare' | 'gemini'
    videoProvider: 'huggingface'
    imageAccountId: string
    imageApiToken: string
    videoAccessToken: string
    imageModel: string
    imageEditModel: string
    imageAspectRatio: string
    imageSize: '512px' | '1K' | '2K' | '4K'
    videoModel: string
    videoSpace: string
    videoApiName: string
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
  maxApkBytes: env.MAX_APK_MB * 1024 * 1024,
  mediaArchive: {
    enabled: env.MEDIA_ARCHIVE_ENABLED,
    retentionDays: env.MEDIA_ARCHIVE_RETENTION_DAYS,
    backfillDays: env.MEDIA_ARCHIVE_BACKFILL_DAYS,
  },
  logLevel: env.LOG_LEVEL,
  timezone: env.TIMEZONE,
  api: { enabled: env.API_ENABLED, host: env.API_HOST, port: env.API_PORT, key: env.API_KEY, rateLimitPerMinute: env.API_RATE_LIMIT_PER_MINUTE },
  webhook: { url: env.WEBHOOK_URL, secret: env.WEBHOOK_SECRET },
  ai: {
    provider: 'gemini',
    apiKey: runtimeGeminiKey,
    model: normalizeGeminiTextModel(env.AI_MODEL),
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    publicAccess: env.AI_PUBLIC,
  },
  mediaAi: {
    provider: 'mixed',
    enabled: env.MEDIA_AI_ENABLED,
    publicAccess: env.MEDIA_AI_PUBLIC,
    apiKey: runtimeGeminiKey,
    imageProvider: env.MEDIA_AI_IMAGE_PROVIDER,
    videoProvider: env.MEDIA_AI_VIDEO_PROVIDER,
    imageAccountId: env.MEDIA_AI_CLOUDFLARE_ACCOUNT_ID.trim(),
    imageApiToken: env.MEDIA_AI_CLOUDFLARE_API_TOKEN.trim(),
    videoAccessToken: runtimeHfToken,
    imageModel: env.MEDIA_AI_IMAGE_MODEL.trim() || '@cf/black-forest-labs/flux-1-schnell',
    imageEditModel: env.MEDIA_AI_IMAGE_EDIT_MODEL.trim() || 'gemini-3.1-flash-image',
    imageAspectRatio: env.MEDIA_AI_IMAGE_ASPECT_RATIO.trim(),
    imageSize: env.MEDIA_AI_IMAGE_SIZE,
    videoModel: normalizeHuggingFaceVideoModel(env.MEDIA_AI_VIDEO_MODEL),
    videoSpace: normalizeHuggingFaceSpaceUrl(env.MEDIA_AI_VIDEO_SPACE),
    videoApiName: normalizeHuggingFaceApiName(env.MEDIA_AI_VIDEO_API_NAME),
    videoAspectRatio: env.MEDIA_AI_VIDEO_ASPECT_RATIO,
    videoTimeoutSeconds: env.MEDIA_AI_VIDEO_TIMEOUT_SECONDS,
  },
  customPluginsDir: path.resolve(env.CUSTOM_PLUGINS_DIR),
}
