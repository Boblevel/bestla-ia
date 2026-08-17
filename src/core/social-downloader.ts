import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export class SocialDownloadError extends Error {}

export type VideoQuality = 360 | 480 | 720 | 1080 | 'best'
export type AudioBitrate = 64 | 96 | 128 | 160 | 192 | 256 | 320

export interface SocialMediaInfo {
  title: string
  extractor: string
  duration: number | null
  qualities: number[]
  url: string
}

export interface SocialDownloadResult {
  buffer: Buffer
  mimetype: string
  fileName: string
  title: string
  extractor: string
  qualityLabel: string
}

interface ProcessResult {
  stdout: string
  stderr: string
}

type JsonRecord = Record<string, unknown>

const MAX_STDOUT_BYTES = 3 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 6 * 60_000

const TRUSTED_MEDIA_DOMAINS = [
  'youtube.com', 'youtu.be',
  'instagram.com',
  'facebook.com', 'fb.watch',
  'tiktok.com',
  'x.com', 'twitter.com',
  'threads.net',
  'vimeo.com',
  'dailymotion.com', 'dai.ly',
  'soundcloud.com',
  'twitch.tv',
  'reddit.com', 'redd.it',
  'pinterest.com', 'pin.it',
] as const

function trustedMediaHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return TRUSTED_MEDIA_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
]

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sanitizeFileName(value: string, fallback: string): string {
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return clean || fallback
}

function looksPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
  return PRIVATE_V4.some((pattern) => pattern.test(host))
}

export function normalizePublicMediaUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new SocialDownloadError('Lien invalide. Colle une adresse complète commençant par http:// ou https://.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SocialDownloadError('Seuls les liens publics http:// et https:// sont acceptés.')
  }
  if (parsed.username || parsed.password) throw new SocialDownloadError('Les liens contenant des identifiants sont refusés.')
  if (looksPrivateHostname(parsed.hostname)) throw new SocialDownloadError('Les adresses locales ou privées ne sont pas acceptées.')
  if (!trustedMediaHostname(parsed.hostname)) {
    throw new SocialDownloadError('Ce domaine n’est pas encore autorisé. Utilise un lien public YouTube, Instagram, Facebook, TikTok, X, Vimeo, Dailymotion, SoundCloud, Twitch, Reddit ou Pinterest.')
  }
  parsed.hash = ''
  return parsed.toString()
}

export function parseVideoQuality(value?: string): VideoQuality {
  const text = (value ?? '').trim().toLowerCase().replace(/p$/, '')
  if (!text || text === 'auto' || text === '720') return 720
  if (text === 'best' || text === 'max' || text === 'meilleure') return 'best'
  const number = Number(text)
  if ([360, 480, 720, 1080].includes(number)) return number as Exclude<VideoQuality, 'best'>
  throw new SocialDownloadError('Qualité invalide. Utilise 360p, 480p, 720p, 1080p ou best.')
}

export function parseAudioBitrate(value?: string): AudioBitrate {
  const text = (value ?? '').trim().toLowerCase().replace(/k(?:bps)?$/, '')
  if (!text) return 128
  const number = Number(text)
  if ([64, 96, 128, 160, 192, 256, 320].includes(number)) return number as AudioBitrate
  throw new SocialDownloadError('Qualité audio invalide. Utilise 64k, 96k, 128k, 160k, 192k, 256k ou 320k.')
}


export type SocialDownloadChoice =
  | { kind: 'video'; quality: VideoQuality }
  | { kind: 'audio'; bitrate: AudioBitrate }

export function parseSocialDownloadChoice(value: string): SocialDownloadChoice | undefined {
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return undefined
  if (/^(?:360|480|720|1080)p?$/.test(text) || ['best', 'max', 'meilleure'].includes(text)) {
    return { kind: 'video', quality: parseVideoQuality(text) }
  }
  const audio = text.match(/^(?:audio|mp3)(?:\s+([0-9]{2,3}k(?:bps)?))?$/)
  if (audio) return { kind: 'audio', bitrate: parseAudioBitrate(audio[1] ?? '128k') }
  return undefined
}

export function videoFormatSelector(quality: VideoQuality): string {
  if (quality === 'best') return 'bv*+ba/b'
  return `bv*[height<=?${quality}]+ba/b[height<=?${quality}]`
}

function baseArgs(): string[] {
  return [
    '--ignore-config',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--js-runtimes',
    'node',
  ]
}

function executableCandidates(): string[] {
  return [...new Set([
    process.env.BESTLA_YTDLP_PATH?.trim(),
    '/usr/local/bin/yt-dlp',
    path.join(homedir(), '.local', 'bin', 'yt-dlp'),
    'yt-dlp',
  ].filter((item): item is string => Boolean(item)))]
}

async function canExecute(candidate: string): Promise<boolean> {
  if (candidate.includes('/')) {
    await access(candidate).catch(() => undefined)
  }
  try {
    await runExecutable(candidate, ['--version'], process.cwd(), 8_000, 32_000)
    return true
  } catch {
    return false
  }
}

async function ensureYtDlp(): Promise<string> {
  for (const candidate of executableCandidates()) {
    if (await canExecute(candidate)) return candidate
  }

  const repairScript = path.resolve(process.cwd(), 'scripts', 'ensure-downloader.sh')
  try {
    await runExecutable('bash', [repairScript], process.cwd(), 190_000, 128_000)
  } catch {
    throw new SocialDownloadError('Le module de téléchargement n’a pas pu être installé automatiquement. Relance la mise à jour Bestla depuis le panel puis réessaie.')
  }

  for (const candidate of executableCandidates()) {
    if (await canExecute(candidate)) return candidate
  }
  throw new SocialDownloadError('yt-dlp reste indisponible après la réparation automatique.')
}

function runExecutable(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = MAX_STDOUT_BYTES,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    let stdout = ''
    let stderr = ''
    let overflow = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new SocialDownloadError('Le téléchargement a dépassé le délai autorisé.'))
    }, timeoutMs)
    timer.unref()

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > maxOutputBytes) {
        overflow = true
        child.kill('SIGKILL')
        return
      }
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(new SocialDownloadError('Le moteur de téléchargement est introuvable.'))
      else reject(new SocialDownloadError('Impossible de démarrer le moteur de téléchargement.'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (overflow) return reject(new SocialDownloadError('La réponse du site est anormalement volumineuse.'))
      if (code === 0) return resolve({ stdout, stderr })
      const detail = stderr.trim().split('\n').slice(-4).join(' ').replace(/\s+/g, ' ').slice(0, 500)
      if (/sign in|login|required|private|cookies/i.test(detail)) {
        return reject(new SocialDownloadError('Ce contenu demande une connexion ou n’est pas public. Bestla ne contourne pas les contenus privés ou protégés.'))
      }
      if (/unsupported url/i.test(detail)) return reject(new SocialDownloadError('Ce lien n’est pas pris en charge par le moteur de téléchargement actuel.'))
      if (/requested format is not available/i.test(detail)) return reject(new SocialDownloadError('Cette qualité n’est pas disponible pour ce lien. Essaie une qualité plus basse ou best.'))
      reject(new SocialDownloadError(detail || 'Le téléchargement a échoué.'))
    })
  })
}

async function metadata(url: string): Promise<{ raw: JsonRecord; executable: string }> {
  const executable = await ensureYtDlp()
  const result = await runExecutable(executable, [
    ...baseArgs(),
    '--skip-download',
    '--dump-single-json',
    '--',
    url,
  ], process.cwd(), 45_000)
  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new SocialDownloadError('Le site n’a pas renvoyé de métadonnées exploitables.')
  }
  const raw = record(parsed)
  if (!raw) throw new SocialDownloadError('Métadonnées du média invalides.')
  return { raw, executable }
}

export async function inspectSocialMedia(inputUrl: string): Promise<SocialMediaInfo> {
  const url = normalizePublicMediaUrl(inputUrl)
  const { raw } = await metadata(url)
  const formats = Array.isArray(raw.formats) ? raw.formats : []
  const qualities = [...new Set(
    formats
      .map((item) => asNumber(record(item)?.height))
      .filter((height): height is number => Boolean(height && height >= 144 && height <= 4320))
      .map((height) => Math.round(height)),
  )].sort((a, b) => a - b)
  return {
    title: asString(raw.title) ?? 'Média social',
    extractor: asString(raw.extractor_key) ?? asString(raw.extractor) ?? 'site',
    duration: asNumber(raw.duration) ?? null,
    qualities,
    url,
  }
}

function outputMime(extension: string, audioOnly: boolean): string {
  const ext = extension.toLowerCase()
  if (audioOnly) {
    if (ext === 'mp3') return 'audio/mpeg'
    if (ext === 'm4a') return 'audio/mp4'
    if (ext === 'ogg' || ext === 'opus') return 'audio/ogg'
  }
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mov') return 'video/quicktime'
  return audioOnly ? 'audio/mpeg' : 'application/octet-stream'
}

async function downloadedFile(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.part') && !entry.name.endsWith('.ytdl'))
    .map((entry) => path.join(directory, entry.name))
  if (!files.length) throw new SocialDownloadError('Le média a été traité mais aucun fichier final n’a été trouvé.')
  const sizes = await Promise.all(files.map(async (file) => ({ file, size: (await stat(file)).size })))
  sizes.sort((a, b) => b.size - a.size)
  return sizes[0]?.file ?? files[0]!
}

function maxFileSizeArg(maxBytes: number): string {
  return `${Math.max(1, Math.floor(maxBytes / (1024 * 1024)))}M`
}

export async function downloadSocialVideo(
  inputUrl: string,
  quality: VideoQuality,
  maxBytes: number,
): Promise<SocialDownloadResult> {
  const url = normalizePublicMediaUrl(inputUrl)
  const { raw, executable } = await metadata(url)
  const title = asString(raw.title) ?? 'video'
  const extractor = asString(raw.extractor_key) ?? asString(raw.extractor) ?? 'site'
  const duration = asNumber(raw.duration)
  if (duration && duration > 3 * 60 * 60) throw new SocialDownloadError('La vidéo dépasse 3 heures et n’est pas adaptée à un envoi WhatsApp.')

  const candidates: VideoQuality[] = quality === 'best'
    ? ['best', 1080, 720, 480, 360]
    : [quality, ...([1080, 720, 480, 360] as const).filter((item) => item < quality)]
  let lastError: unknown

  for (const candidate of candidates) {
    const directory = await mkdtemp(path.join(tmpdir(), 'bestla-social-'))
    try {
      await runExecutable(executable, [
        ...baseArgs(),
        '--max-filesize', maxFileSizeArg(maxBytes),
        '--format', videoFormatSelector(candidate),
        '--format-sort', candidate === 'best' ? 'vcodec:h264,acodec:aac' : `res:${candidate},vcodec:h264,acodec:aac`,
        '--merge-output-format', 'mp4',
        '--output', path.join(directory, 'bestla.%(ext)s'),
        '--',
        url,
      ], directory)
      const file = await downloadedFile(directory)
      const size = (await stat(file)).size
      if (size > maxBytes) throw new SocialDownloadError(`La vidéo fait ${(size / 1024 / 1024).toFixed(1)} Mo.`)
      const extension = path.extname(file).slice(1) || 'mp4'
      const downgraded = candidate !== quality
      return {
        buffer: await readFile(file),
        mimetype: outputMime(extension, false),
        fileName: `${sanitizeFileName(title, 'video')}.${extension}`,
        title,
        extractor,
        qualityLabel: candidate === 'best'
          ? 'meilleure disponible'
          : `${candidate}p max${downgraded ? ' (adapté automatiquement à la limite WhatsApp)' : ''}`,
      }
    } catch (error) {
      lastError = error
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  if (lastError instanceof SocialDownloadError && !/plus basse/i.test(lastError.message)) {
    throw new SocialDownloadError(`${lastError.message} Même 360p dépasse la limite média configurée ou n’est pas disponible.`)
  }
  throw lastError instanceof SocialDownloadError ? lastError : new SocialDownloadError('Aucune qualité vidéo compatible n’a pu être téléchargée.')
}

export async function downloadSocialAudio(
  inputUrl: string,
  bitrate: AudioBitrate,
  maxBytes: number,
): Promise<SocialDownloadResult> {
  const url = normalizePublicMediaUrl(inputUrl)
  const { raw, executable } = await metadata(url)
  const title = asString(raw.title) ?? 'audio'
  const extractor = asString(raw.extractor_key) ?? asString(raw.extractor) ?? 'site'
  const duration = asNumber(raw.duration)
  if (duration && duration > 6 * 60 * 60) throw new SocialDownloadError('L’audio dépasse 6 heures et n’est pas adapté à un envoi WhatsApp.')

  const candidates = ([320, 256, 192, 160, 128, 96, 64] as const).filter((item) => item <= bitrate)
  let lastError: unknown
  for (const candidate of candidates) {
    const directory = await mkdtemp(path.join(tmpdir(), 'bestla-social-audio-'))
    try {
      await runExecutable(executable, [
        ...baseArgs(),
        '--max-filesize', maxFileSizeArg(maxBytes),
        '--format', 'ba/b',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', `${candidate}K`,
        '--output', path.join(directory, 'bestla.%(ext)s'),
        '--',
        url,
      ], directory)
      const file = await downloadedFile(directory)
      const size = (await stat(file)).size
      if (size > maxBytes) throw new SocialDownloadError(`L’audio fait ${(size / 1024 / 1024).toFixed(1)} Mo.`)
      return {
        buffer: await readFile(file),
        mimetype: 'audio/mpeg',
        fileName: `${sanitizeFileName(title, 'audio')}.mp3`,
        title,
        extractor,
        qualityLabel: `${candidate} kb/s${candidate !== bitrate ? ' (adapté automatiquement à la limite WhatsApp)' : ''}`,
      }
    } catch (error) {
      lastError = error
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  throw lastError instanceof SocialDownloadError
    ? new SocialDownloadError(`${lastError.message} Même 64 kb/s dépasse la limite média configurée ou n’est pas disponible.`)
    : new SocialDownloadError('Aucune qualité audio compatible n’a pu être téléchargée.')
}

