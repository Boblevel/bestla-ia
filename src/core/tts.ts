import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export class TtsError extends Error {}

export type TtsGender = 'Male' | 'Female'

export interface TtsVoice {
  name: string
  gender: TtsGender
  locale: string
  friendlyName?: string
}

export interface TtsPreference {
  locale: string
  voice: string
  gender: TtsGender
  rate: string
  pitch: string
}

interface PreferenceDocument {
  version: 1
  users: Record<string, TtsPreference>
}

interface LanguagePreset {
  locale: string
  label: string
  aliases: readonly string[]
  male: string
  female: string
}

const DEFAULT_PREFERENCE: TtsPreference = {
  locale: 'fr-FR',
  voice: 'fr-FR-HenriNeural',
  gender: 'Male',
  rate: '+0%',
  pitch: '+0Hz',
}

export const TTS_LANGUAGE_PRESETS: readonly LanguagePreset[] = [
  { locale: 'fr-FR', label: 'Français', aliases: ['fr', 'francais', 'français', 'fr-fr'], male: 'fr-FR-HenriNeural', female: 'fr-FR-DeniseNeural' },
  { locale: 'en-NG', label: 'Anglais Nigeria', aliases: ['en-ng', 'ng', 'nigeria'], male: 'en-NG-AbeoNeural', female: 'en-NG-EzinneNeural' },
  { locale: 'en-GB', label: 'Anglais Royaume-Uni', aliases: ['en', 'anglais', 'en-gb'], male: 'en-GB-RyanNeural', female: 'en-GB-SoniaNeural' },
  { locale: 'en-US', label: 'Anglais USA', aliases: ['en-us', 'us', 'usa'], male: 'en-US-GuyNeural', female: 'en-US-JennyNeural' },
  { locale: 'sw-KE', label: 'Swahili Kenya', aliases: ['sw', 'swahili', 'sw-ke'], male: 'sw-KE-RafikiNeural', female: 'sw-KE-ZuriNeural' },
  { locale: 'ar-EG', label: 'Arabe', aliases: ['ar', 'arabe', 'ar-eg'], male: 'ar-EG-ShakirNeural', female: 'ar-EG-SalmaNeural' },
  { locale: 'es-ES', label: 'Espagnol', aliases: ['es', 'espagnol', 'es-es'], male: 'es-ES-AlvaroNeural', female: 'es-ES-ElviraNeural' },
  { locale: 'pt-BR', label: 'Portugais Brésil', aliases: ['pt', 'portugais', 'pt-br'], male: 'pt-BR-AntonioNeural', female: 'pt-BR-FranciscaNeural' },
  { locale: 'de-DE', label: 'Allemand', aliases: ['de', 'allemand', 'de-de'], male: 'de-DE-ConradNeural', female: 'de-DE-KatjaNeural' },
  { locale: 'it-IT', label: 'Italien', aliases: ['it', 'italien', 'it-it'], male: 'it-IT-DiegoNeural', female: 'it-IT-ElsaNeural' },
  { locale: 'tr-TR', label: 'Turc', aliases: ['tr', 'turc', 'tr-tr'], male: 'tr-TR-AhmetNeural', female: 'tr-TR-EmelNeural' },
  { locale: 'hi-IN', label: 'Hindi', aliases: ['hi', 'hindi', 'hi-in'], male: 'hi-IN-MadhurNeural', female: 'hi-IN-SwaraNeural' },
  { locale: 'af-ZA', label: 'Afrikaans', aliases: ['af', 'afrikaans', 'af-za'], male: 'af-ZA-WillemNeural', female: 'af-ZA-AdriNeural' },
]

let cachedVoices: { at: number; values: TtsVoice[] } | undefined
const VOICE_CACHE_MS = 6 * 60 * 60_000

function defaultDocument(): PreferenceDocument {
  return { version: 1, users: {} }
}

function cleanSender(value: string): string {
  return value.trim().slice(0, 160)
}

function sanitizePreference(value: Partial<TtsPreference> | undefined): TtsPreference {
  const gender: TtsGender = value?.gender === 'Female' ? 'Female' : 'Male'
  const locale = typeof value?.locale === 'string' && /^[a-z]{2,3}-[A-Z]{2}$/u.test(value.locale) ? value.locale : DEFAULT_PREFERENCE.locale
  const voice = typeof value?.voice === 'string' && /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]+Neural$/u.test(value.voice)
    ? value.voice
    : DEFAULT_PREFERENCE.voice
  const rate = typeof value?.rate === 'string' && /^[+-]\d{1,2}%$/u.test(value.rate) ? value.rate : '+0%'
  const pitch = typeof value?.pitch === 'string' && /^[+-]\d{1,3}Hz$/u.test(value.pitch) ? value.pitch : '+0Hz'
  return { locale, voice, gender, rate, pitch }
}

function normalizedAlias(value: string): string {
  return value.trim().toLocaleLowerCase('fr-FR').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function resolveLanguagePreset(value: string): LanguagePreset | undefined {
  const target = normalizedAlias(value)
  return TTS_LANGUAGE_PRESETS.find((preset) =>
    normalizedAlias(preset.locale) === target || preset.aliases.some((alias) => normalizedAlias(alias) === target),
  )
}

export function parseRate(value: string): string | undefined {
  const match = value.trim().match(/^([+-]?)(\d{1,2})%?$/u)
  if (!match?.[2]) return undefined
  const amount = Number(match[2])
  if (!Number.isInteger(amount) || amount > 50) return undefined
  const sign = match[1] === '-' ? '-' : '+'
  return `${sign}${amount}%`
}

function voiceFromUnknown(value: unknown): TtsVoice | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const name = typeof raw.ShortName === 'string' ? raw.ShortName : typeof raw.Name === 'string' ? raw.Name : ''
  const gender = raw.Gender === 'Female' ? 'Female' : raw.Gender === 'Male' ? 'Male' : undefined
  const locale = typeof raw.Locale === 'string' ? raw.Locale : name.match(/^([a-z]{2,3}-[A-Z]{2})-/u)?.[1]
  if (!name || !gender || !locale) return undefined
  return {
    name,
    gender,
    locale,
    ...(typeof raw.FriendlyName === 'string' ? { friendlyName: raw.FriendlyName } : {}),
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      if (!settled) {
        settled = true
        reject(new TtsError('Le moteur vocal a dépassé le délai autorisé.'))
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 2_000_000) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 100_000) stderr += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code === 0) resolve({ stdout, stderr })
      else reject(new TtsError(stderr.trim().slice(-500) || `Le moteur vocal a quitté avec le code ${code ?? 'inconnu'}.`))
    })
  })
}

export class TtsService {
  private readonly preferencesPath: string
  private readonly appDirectory: string

  constructor(private readonly dataDir: string) {
    this.preferencesPath = path.join(dataDir, 'tts-preferences.json')
    this.appDirectory = path.resolve(process.cwd())
  }

  async isRuntimeReady(): Promise<boolean> {
    return Boolean(await this.edgeTtsBinary()) && Boolean(await this.ffmpegBinary())
  }

  async getPreference(sender: string): Promise<TtsPreference> {
    const document = await this.readPreferences()
    return sanitizePreference(document.users[cleanSender(sender)])
  }

  async resetPreference(sender: string): Promise<TtsPreference> {
    const document = await this.readPreferences()
    delete document.users[cleanSender(sender)]
    await this.writePreferences(document)
    return { ...DEFAULT_PREFERENCE }
  }

  async setLanguage(sender: string, language: string): Promise<TtsPreference> {
    const preset = resolveLanguagePreset(language)
    if (!preset) throw new TtsError(`Langue inconnue. Choix rapides : ${TTS_LANGUAGE_PRESETS.map((item) => item.aliases[0]).join(', ')}.`)
    const current = await this.getPreference(sender)
    const voice = current.gender === 'Female' ? preset.female : preset.male
    return this.savePreference(sender, { ...current, locale: preset.locale, voice })
  }

  async setGender(sender: string, gender: TtsGender): Promise<TtsPreference> {
    const current = await this.getPreference(sender)
    const preset = resolveLanguagePreset(current.locale) ?? TTS_LANGUAGE_PRESETS[0]
    if (!preset) return current
    const voice = gender === 'Female' ? preset.female : preset.male
    return this.savePreference(sender, { ...current, gender, voice, locale: preset.locale })
  }

  async setRate(sender: string, rawRate: string): Promise<TtsPreference> {
    const rate = parseRate(rawRate)
    if (!rate) throw new TtsError('Vitesse invalide. Utilise une valeur entre -50% et +50%, par exemple +10%.')
    const current = await this.getPreference(sender)
    return this.savePreference(sender, { ...current, rate })
  }

  async setVoice(sender: string, voiceName: string): Promise<TtsPreference> {
    const voices = await this.listVoices()
    const voice = voices.find((item) => item.name.toLowerCase() === voiceName.trim().toLowerCase())
    if (!voice) throw new TtsError('Voix introuvable. Utilise .voix liste fr pour voir les voix disponibles.')
    const current = await this.getPreference(sender)
    return this.savePreference(sender, { ...current, voice: voice.name, locale: voice.locale, gender: voice.gender })
  }

  async listVoices(language?: string): Promise<TtsVoice[]> {
    let voices = cachedVoices && Date.now() - cachedVoices.at < VOICE_CACHE_MS ? cachedVoices.values : undefined
    if (!voices) {
      voices = await this.fetchVoices().catch(() => this.curatedVoices())
      cachedVoices = { at: Date.now(), values: voices }
    }

    if (!language?.trim()) return voices
    const preset = resolveLanguagePreset(language)
    const locale = preset?.locale ?? language.trim()
    const normalized = locale.toLowerCase()
    const exact = voices.filter((voice) => voice.locale.toLowerCase() === normalized)
    if (exact.length) return exact
    const languageCode = normalized.split('-')[0]
    return voices.filter((voice) => voice.locale.toLowerCase().startsWith(`${languageCode}-`))
  }

  async synthesize(sender: string, rawText: string): Promise<{ buffer: Buffer; voice: string; locale: string }> {
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, 1_500)
    if (!text) throw new TtsError('Le texte à transformer en vocal est vide.')

    await this.ensureRuntime()
    const edgeTts = await this.edgeTtsBinary()
    const ffmpeg = await this.ffmpegBinary()
    if (!edgeTts || !ffmpeg) {
      throw new TtsError('Le moteur vocal Bestla n’a pas pu se préparer automatiquement. Réessaie un peu plus tard.')
    }

    const preference = await this.getPreference(sender)
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bestla-tts-'))
    const mp3 = path.join(directory, 'speech.mp3')
    const ogg = path.join(directory, 'speech.ogg')

    try {
      let voice = preference.voice
      try {
        await this.generateEdgeAudio(edgeTts, voice, preference, text, mp3)
      } catch (firstError) {
        // Un second essai absorbe les petites coupures du service Edge TTS.
        await new Promise((resolve) => setTimeout(resolve, 450))
        try {
          await this.generateEdgeAudio(edgeTts, voice, preference, text, mp3)
        } catch {
          const preset = resolveLanguagePreset(preference.locale) ?? TTS_LANGUAGE_PRESETS[0]
          const fallbackVoice = preference.gender === 'Female' ? preset?.female : preset?.male
          if (!fallbackVoice || fallbackVoice === voice) throw firstError
          voice = fallbackVoice
          await this.generateEdgeAudio(edgeTts, voice, preference, text, mp3)
        }
      }

      await runCommand(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', mp3,
        '-vn', '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'voip', ogg,
      ], 45_000)
      const buffer = await readFile(ogg)
      if (buffer.length === 0) throw new TtsError('Le moteur vocal a produit un fichier vide.')
      return { buffer, voice, locale: preference.locale }
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }


  private async ensureRuntime(): Promise<void> {
    if ((await this.edgeTtsBinary()) && (await this.ffmpegBinary())) return
    const installer = path.join(this.appDirectory, 'scripts', 'ensure-tts.sh')
    if (!(await exists(installer))) return
    try {
      await runCommand('bash', [installer], 180_000)
    } catch {
      // La commande utilisateur affichera ensuite une erreur propre si le moteur
      // est toujours indisponible. Aucun réglage manuel n'est demandé.
    }
  }

  private async generateEdgeAudio(
    edgeTts: string,
    voice: string,
    preference: TtsPreference,
    text: string,
    output: string,
  ): Promise<void> {
    await runCommand(edgeTts, [
      '--voice', voice,
      '--rate', preference.rate,
      '--pitch', preference.pitch,
      '--text', text,
      '--write-media', output,
    ], 60_000)
    if (!(await exists(output))) throw new TtsError('Aucun fichier vocal n’a été produit.')
  }

  private async fetchVoices(): Promise<TtsVoice[]> {
    const python = await this.venvPython()
    if (!python) throw new TtsError('Moteur vocal absent.')
    const script = [
      'import asyncio,json,edge_tts',
      'print(json.dumps(asyncio.run(edge_tts.list_voices()), ensure_ascii=False))',
    ].join(';')
    const result = await runCommand(python, ['-c', script], 30_000)
    const parsed = JSON.parse(result.stdout) as unknown
    if (!Array.isArray(parsed)) throw new TtsError('Liste de voix invalide.')
    const voices = parsed.map(voiceFromUnknown).filter((voice): voice is TtsVoice => Boolean(voice))
    if (!voices.length) throw new TtsError('Aucune voix disponible.')
    return voices
  }

  private curatedVoices(): TtsVoice[] {
    return TTS_LANGUAGE_PRESETS.flatMap((preset) => [
      { name: preset.male, gender: 'Male' as const, locale: preset.locale },
      { name: preset.female, gender: 'Female' as const, locale: preset.locale },
    ])
  }

  private async edgeTtsBinary(): Promise<string | undefined> {
    const local = path.join(this.appDirectory, '.venv-tts', 'bin', 'edge-tts')
    if (await exists(local)) return local
    return this.commandFromPath('edge-tts')
  }

  private async venvPython(): Promise<string | undefined> {
    const local = path.join(this.appDirectory, '.venv-tts', 'bin', 'python')
    if (await exists(local)) return local
    return this.commandFromPath('python3')
  }

  private async ffmpegBinary(): Promise<string | undefined> {
    return this.commandFromPath('ffmpeg')
  }

  private async commandFromPath(command: string): Promise<string | undefined> {
    try {
      const result = await runCommand('/usr/bin/env', ['sh', '-c', `command -v ${command}`], 5_000)
      const resolved = result.stdout.trim().split(/\r?\n/u)[0]
      return resolved || undefined
    } catch {
      return undefined
    }
  }

  private async readPreferences(): Promise<PreferenceDocument> {
    try {
      const payload = JSON.parse(await readFile(this.preferencesPath, 'utf8')) as unknown
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return defaultDocument()
      const root = payload as Record<string, unknown>
      if (!root.users || typeof root.users !== 'object' || Array.isArray(root.users)) return defaultDocument()
      return { version: 1, users: root.users as Record<string, TtsPreference> }
    } catch {
      return defaultDocument()
    }
  }

  private async savePreference(sender: string, preference: TtsPreference): Promise<TtsPreference> {
    const document = await this.readPreferences()
    const clean = sanitizePreference(preference)
    document.users[cleanSender(sender)] = clean
    await this.writePreferences(document)
    return clean
  }

  private async writePreferences(document: PreferenceDocument): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    const temporary = `${this.preferencesPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.preferencesPath)
  }
}
