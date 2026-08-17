import { existsSync } from 'node:fs'
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export class SocialDownloadError extends Error {}

export type VideoQuality = 240 | 360 | 480 | 720 | 1080 | 1440 | 2160 | 'best'
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
  'snapchat.com',
  'streamable.com',
  'tumblr.com',
  'flickr.com',
  'imgur.com',
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
    throw new SocialDownloadError('Ce domaine n’est pas encore autorisé. Utilise un lien public YouTube, Instagram, Facebook, TikTok, X, Vimeo, Dailymotion, SoundCloud, Twitch, Reddit, Pinterest, Snapchat, Streamable, Tumblr, Flickr ou Imgur.')
  }
  parsed.hash = ''
  return parsed.toString()
}

export function parseVideoQuality(value?: string): VideoQuality {
  const text = (value ?? '').trim().toLowerCase().replace(/p$/, '')
  if (!text || text === 'auto' || text === '720') return 720
  if (text === 'best' || text === 'max' || text === 'meilleure') return 'best'
  const number = Number(text)
  if ([240, 360, 480, 720, 1080, 1440, 2160].includes(number)) return number as Exclude<VideoQuality, 'best'>
  throw new SocialDownloadError('Qualité invalide. Utilise 240p, 360p, 480p, 720p, 1080p, 1440p, 2160p ou best.')
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
  if (/^(?:240|360|480|720|1080|1440|2160)p?$/.test(text) || ['best', 'max', 'meilleure'].includes(text)) {
    return { kind: 'video', quality: parseVideoQuality(text) }
  }
  const audio = text.match(/^(?:audio|mp3)(?:\s+([0-9]{2,3}k(?:bps)?))?$/)
  if (audio) return { kind: 'audio', bitrate: parseAudioBitrate(audio[1] ?? '128k') }
  return undefined
}

export interface PendingSocialDownload {
  url: string
  qualities: VideoQuality[]
  expiresAt: number
}

const pendingSocialDownloads = new Map<string, PendingSocialDownload>()

function pendingSocialDownloadKey(sessionName: string, chatId: string, sender: string): string {
  return `${sessionName}:${chatId}:${sender}`
}

export function availableVideoChoices(qualities: number[]): VideoQuality[] {
  const standards = [240, 360, 480, 720, 1080, 1440, 2160] as const
  const detected = standards.filter((height) =>
    qualities.some((actual) => Math.abs(actual - height) <= Math.max(12, Math.round(height * 0.035))),
  )
  const base: VideoQuality[] = detected.length > 0 ? [...detected] : [360, 480, 720, 1080]
  if (!base.includes('best')) base.push('best')
  return base
}

export function setPendingSocialDownload(
  sessionName: string,
  chatId: string,
  sender: string,
  url: string,
  qualities: VideoQuality[],
  ttlMs = 10 * 60_000,
): void {
  pendingSocialDownloads.set(pendingSocialDownloadKey(sessionName, chatId, sender), {
    url,
    qualities,
    expiresAt: Date.now() + ttlMs,
  })
}

export function getPendingSocialDownload(
  sessionName: string,
  chatId: string,
  sender: string,
): PendingSocialDownload | undefined {
  const key = pendingSocialDownloadKey(sessionName, chatId, sender)
  const pending = pendingSocialDownloads.get(key)
  if (!pending) return undefined
  if (pending.expiresAt <= Date.now()) {
    pendingSocialDownloads.delete(key)
    return undefined
  }
  return pending
}

export function clearPendingSocialDownload(sessionName: string, chatId: string, sender: string): void {
  pendingSocialDownloads.delete(pendingSocialDownloadKey(sessionName, chatId, sender))
}

export function videoChoiceAllowed(pending: PendingSocialDownload, choice: SocialDownloadChoice): boolean {
  return choice.kind === 'audio' || pending.qualities.includes(choice.quality)
}

export function qualityMenuLines(qualities: VideoQuality[]): string[] {
  const video = qualities.map((quality) => quality === 'best' ? 'best' : `${quality}p`).join(' • ')
  return [
    `Vidéo : ${video}`,
    'Audio : audio 96k • audio 128k • audio 192k • audio 320k',
  ]
}

export function videoFormatSelector(quality: VideoQuality): string {
  if (quality === 'best') return 'bv*+ba/b'
  return `bv*[height<=?${quality}]+ba/b[height<=?${quality}]`
}

export function youtubePotProviderArgs(home = homedir()): string[] {
  const root = process.env.BESTLA_POT_PROVIDER_HOME?.trim() || path.join(home, '.bestla', 'bgutil-ytdlp-pot-provider')
  const serverHome = path.join(root, 'server')
  const generator = path.join(serverHome, 'build', 'generate_once.js')
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  const pluginPackage = path.join(xdg, 'yt-dlp', 'plugins', 'bgutil-ytdlp-pot-provider')
  const pluginNamespace = path.join(pluginPackage, 'yt_dlp_plugins')
  const port = Number(process.env.BESTLA_POT_PROVIDER_PORT ?? 4416)

  if (!existsSync(generator) || !existsSync(pluginNamespace)) return []
  return [
    '--plugin-dirs',
    pluginPackage,
    '--extractor-args',
    `youtubepot-bgutilhttp:base_url=http://127.0.0.1:${Number.isFinite(port) ? port : 4416}`,
    '--extractor-args',
    `youtubepot-bgutilscript:script_path=${generator}`,
  ]
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

type PlatformKind = 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'x' | 'other'

function platformKind(url: string): PlatformKind {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube'
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram'
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return 'facebook'
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok'
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x'
  return 'other'
}

interface YtDlpProfile {
  label: string
  args: string[]
}

const impersonationCache = new Map<string, Promise<boolean>>()

async function canImpersonateChrome(executable: string): Promise<boolean> {
  let cached = impersonationCache.get(executable)
  if (!cached) {
    cached = runExecutable(executable, ['--list-impersonate-targets'], process.cwd(), 12_000, 128_000)
      .then(({ stdout }) => /^Chrome\s+.*curl_cffi(?!.*unavailable)/mi.test(stdout))
      .catch(() => false)
    impersonationCache.set(executable, cached)
  }
  return cached
}

async function platformProfiles(executable: string, url: string): Promise<YtDlpProfile[]> {
  const platform = platformKind(url)
  if (platform === 'youtube') {
    const provider = youtubePotProviderArgs()
    return [
      { label: 'youtube-mweb-pot', args: [...provider, '--extractor-args', 'youtube:player-client=mweb'] },
      { label: 'youtube-web-safari', args: ['--extractor-args', 'youtube:player-client=web_safari'] },
      { label: 'youtube-default', args: [] },
    ]
  }

  const profiles: YtDlpProfile[] = [{ label: `${platform}-standard`, args: [] }]
  if (platform === 'instagram') {
    profiles.push({ label: 'instagram-ios', args: ['--extractor-args', 'instagram:app_id=ios'] })
  }
  if (await canImpersonateChrome(executable)) {
    profiles.push({ label: `${platform}-browser`, args: ['--impersonate', 'chrome'] })
  }
  return profiles
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

let downloaderPreparation: Promise<void> | undefined

async function prepareDownloader(force = false): Promise<void> {
  const repairScript = path.resolve(process.cwd(), 'scripts', 'ensure-downloader.sh')
  if (force) downloaderPreparation = undefined
  if (!downloaderPreparation) {
    downloaderPreparation = runExecutable('bash', [repairScript], process.cwd(), 360_000, 256_000).then(() => undefined)
  }
  await downloaderPreparation
}

async function ensureYtDlp(): Promise<string> {
  // Le postinstall prépare déjà yt-dlp. Ce contrôle au premier usage répare aussi
  // automatiquement le provider PO Token si un VPS a été migré ou nettoyé.
  try {
    await prepareDownloader()
  } catch {
    // Si yt-dlp existe déjà, les plateformes ne nécessitant pas le provider
    // YouTube restent utilisables. On ne bloque donc pas avant de le vérifier.
  }

  for (const candidate of executableCandidates()) {
    if (await canExecute(candidate)) return candidate
  }
  throw new SocialDownloadError('Le module de téléchargement n’a pas pu être installé automatiquement. Relance la mise à jour Bestla depuis le panel puis réessaie.')
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
      if (/confirm (?:you(?:'|’)re|you are) not a bot|po token|proof.of.origin|bot check/i.test(detail)) {
        return reject(new SocialDownloadError('Protection anti-bot ou PO Token détectée par le site.'))
      }
      if (/private video|members.only|age.restricted/i.test(detail)) {
        return reject(new SocialDownloadError('Ce contenu est privé, réservé aux membres ou protégé. Bestla ne contourne pas ces restrictions.'))
      }
      if (/sign in|login required|cookies required|authentication required/i.test(detail)) {
        return reject(new SocialDownloadError('Le site demande une session ou une connexion pour cette tentative.'))
      }
      if (/http error (?:403|429)|forbidden|captcha|challenge required|anti.bot/i.test(detail)) {
        return reject(new SocialDownloadError('Le site a déclenché une protection temporaire anti-bot ou anti-abus.'))
      }
      if (/unsupported url/i.test(detail)) return reject(new SocialDownloadError('Ce lien n’est pas pris en charge par le moteur de téléchargement actuel.'))
      if (/requested format is not available/i.test(detail)) return reject(new SocialDownloadError('Cette qualité n’est pas disponible pour ce lien. Essaie une qualité plus basse ou best.'))
      reject(new SocialDownloadError(detail || 'Le téléchargement a échoué.'))
    })
  })
}

function definitiveDownloadError(error: SocialDownloadError): boolean {
  return /contenu est privé|réservé aux membres|protégé|n’est pas pris en charge|schéma|lien invalide|adresses locales|domaine n’est pas encore autorisé/i.test(error.message)
}

function protectionError(error: SocialDownloadError): boolean {
  return /anti-bot|anti-abus|po token|403|429|forbidden|captcha|challenge/i.test(error.message)
}

async function runYtDlp(
  executable: string,
  url: string,
  commandArgs: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProcessResult> {
  let profiles = await platformProfiles(executable, url)
  let lastError: SocialDownloadError | undefined
  const platform = platformKind(url)

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index]!
    const attempts = platform === 'youtube' && index === 0 ? 2 : 1
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await runExecutable(executable, [
          ...baseArgs(),
          ...profile.args,
          ...commandArgs,
          '--',
          url,
        ], cwd, timeoutMs)
      } catch (error) {
        if (!(error instanceof SocialDownloadError)) throw error
        lastError = error
        if (definitiveDownloadError(error)) throw error
        if (platform === 'youtube' && index === 0 && attempt === 0 && protectionError(error)) {
          await prepareDownloader(true).catch(() => undefined)
          profiles = await platformProfiles(executable, url)
          continue
        }
        break
      }
    }
  }

  if (platform === 'youtube' && lastError && protectionError(lastError)) {
    throw new SocialDownloadError(
      'YouTube bloque encore cette requête depuis l’IP du serveur malgré les secours automatiques PO Token, mweb et web_safari. Le lien peut être public ; réessaie plus tard ou teste un autre contenu public.',
    )
  }
  if (lastError && protectionError(lastError)) {
    throw new SocialDownloadError(
      'Ce réseau social a déclenché une protection temporaire. Bestla a déjà essayé automatiquement son profil normal et son profil navigateur lorsqu’il est disponible.',
    )
  }
  if (lastError && /session ou une connexion/i.test(lastError.message)) {
    throw new SocialDownloadError(
      'Ce réseau social exige toujours une connexion pour ce contenu après les profils automatiques de Bestla. Les contenus privés ou nécessitant une session ne sont pas contournés.',
    )
  }
  throw lastError ?? new SocialDownloadError('Le téléchargement a échoué après les tentatives automatiques de secours.')
}

async function metadata(url: string): Promise<{ raw: JsonRecord; executable: string }> {
  const executable = await ensureYtDlp()
  const result = await runYtDlp(executable, url, [
    '--skip-download',
    '--dump-single-json',
  ], process.cwd(), 60_000)
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
    ? ['best', 2160, 1440, 1080, 720, 480, 360, 240]
    : [quality, ...([2160, 1440, 1080, 720, 480, 360, 240] as const).filter((item) => item < quality)]
  let lastError: unknown

  for (const candidate of candidates) {
    const directory = await mkdtemp(path.join(tmpdir(), 'bestla-social-'))
    try {
      await runYtDlp(executable, url, [
        '--max-filesize', maxFileSizeArg(maxBytes),
        '--format', videoFormatSelector(candidate),
        '--format-sort', candidate === 'best' ? 'vcodec:h264,acodec:aac' : `res:${candidate},vcodec:h264,acodec:aac`,
        '--merge-output-format', 'mp4',
        '--output', path.join(directory, 'bestla.%(ext)s'),
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
    throw new SocialDownloadError(`${lastError.message} Même 240p dépasse la limite média configurée ou n’est pas disponible.`)
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
      await runYtDlp(executable, url, [
        '--max-filesize', maxFileSizeArg(maxBytes),
        '--format', 'ba/b',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', `${candidate}K`,
        '--output', path.join(directory, 'bestla.%(ext)s'),
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

