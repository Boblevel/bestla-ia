import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppConfig } from '../config.js'
import { CENTRAL_CLOUDFLARE_IMAGE_WORKERS, type CentralCloudflareImageWorker } from './cloudflare-pool.js'

export class MediaAiError extends Error {}

type JsonRecord = Record<string, unknown>
type VideoOutput = { data?: string; uri?: string; mimetype: string }

const cloudflareCooldowns = new Map<string, number>()

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function providerMessage(payload: unknown): string | undefined {
  const root = record(payload)
  const nested = record(root?.error)
  const result = record(root?.result)
  const errors = Array.isArray(root?.errors) ? root.errors : []
  const firstError = record(errors[0])
  return (
    stringValue(nested?.message)
    ?? stringValue(root?.message)
    ?? stringValue(result?.message)
    ?? stringValue(firstError?.message)
    ?? stringValue(firstError?.error)
  )
}

function mediaError(provider: string, status: number, payload: unknown): MediaAiError {
  const message = providerMessage(payload)
  const label = provider === 'cloudflare' ? 'Cloudflare' : provider === 'huggingface' ? 'Hugging Face' : 'Gemini'
  if (provider === 'huggingface' && status === 429) {
    return new MediaAiError('Hugging Face a temporairement bloqué la génération vidéo (quota gratuit atteint ou file saturée). Réessaie plus tard ou configure un HF_TOKEN gratuit.')
  }
  return new MediaAiError(
    message
      ? `${label} a refusé la demande média (${status}) : ${message.slice(0, 240)}`
      : `${label} a refusé la demande média (${status}).`,
  )
}

function normalizeImageMime(value: string): string {
  const mime = value.toLowerCase()
  if (mime === 'image/jpg') return 'image/jpeg'
  return mime.startsWith('image/') ? mime : 'image/png'
}

async function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({})) as Promise<unknown>
}

async function responseBuffer(response: Response, maxBytes = 100 * 1024 * 1024): Promise<{ buffer: Buffer; mimetype: string }> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > maxBytes) throw new MediaAiError('Le fichier généré dépasse la taille maximale de sécurité (100 Mo).')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxBytes) throw new MediaAiError('Le fichier généré dépasse la taille maximale de sécurité (100 Mo).')
  return { buffer, mimetype: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' }
}

function normalizedApiSegment(value: string): string {
  return value.replace(/^\/+/, '')
}

function isVideoLikeFileHint(value: string): boolean {
  return /\.(mp4|webm|mov|mkv)(?:[?#].*)?$/i.test(value)
}

function gradioFileUrl(baseUrl: string, filePath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/gradio_api/file=${filePath}`
}

type SseEventBlock = { event?: string; data: string[] }

function parseSseEventBlocks(payload: string): SseEventBlock[] {
  const blocks: SseEventBlock[] = []
  let current: SseEventBlock = { data: [] }
  for (const rawLine of payload.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line) {
      if (current.event || current.data.length) blocks.push(current)
      current = { data: [] }
      continue
    }
    if (line.startsWith('event:')) {
      current.event = line.slice(6).trim().toLowerCase()
      continue
    }
    if (line.startsWith('data:')) {
      current.data.push(line.slice(5).trim())
    }
  }
  if (current.event || current.data.length) blocks.push(current)
  return blocks
}

function extractHuggingFaceVideoFile(value: unknown, baseUrl: string): { url: string; mimetype: string } | undefined {
  if (typeof value === 'string') {
    const direct = value.trim()
    if (!direct) return undefined
    if (/^https?:\/\//i.test(direct) && isVideoLikeFileHint(direct)) return { url: direct, mimetype: 'video/mp4' }
    if (direct.startsWith('/tmp/') && isVideoLikeFileHint(direct)) return { url: gradioFileUrl(baseUrl, direct), mimetype: 'video/mp4' }
    return undefined
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractHuggingFaceVideoFile(item, baseUrl)
      if (found) return found
    }
    return undefined
  }
  const item = record(value)
  if (!item) return undefined
  const url = stringValue(item.url)
  const path = stringValue(item.path)
  const mimetype = stringValue(item.mime_type) ?? stringValue(item.mimeType) ?? 'video/mp4'
  if ((url && (mimetype.startsWith('video/') || isVideoLikeFileHint(url))) || (path && (mimetype.startsWith('video/') || isVideoLikeFileHint(path)))) {
    return { url: url ?? gradioFileUrl(baseUrl, path!), mimetype }
  }
  for (const nestedKey of ['video', 'file', 'files', 'output', 'outputs', 'data', 'value', 'result']) {
    const found = extractHuggingFaceVideoFile(item[nestedKey], baseUrl)
    if (found) return found
  }
  for (const nested of Object.values(item)) {
    const found = extractHuggingFaceVideoFile(nested, baseUrl)
    if (found) return found
  }
  return undefined
}


function extractGeminiImage(payload: unknown): { data: string; mimetype: string } | undefined {
  const root = record(payload)
  for (const key of ['output_image', 'outputImage']) {
    const image = record(root?.[key])
    const data = stringValue(image?.data)
    if (data) return { data, mimetype: stringValue(image?.mime_type) ?? stringValue(image?.mimeType) ?? 'image/png' }
  }
  const steps = Array.isArray(root?.steps) ? root.steps : []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = record(steps[index])
    if (stringValue(step?.type)?.toLowerCase() !== 'model_output') continue
    const content = Array.isArray(step?.content) ? step.content : []
    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const item = record(content[contentIndex])
      if (stringValue(item?.type)?.toLowerCase() !== 'image') continue
      const data = stringValue(item?.data)
      if (data) return { data, mimetype: stringValue(item?.mime_type) ?? stringValue(item?.mimeType) ?? 'image/png' }
    }
  }
  return undefined
}

function extractGeminiVideo(payload: unknown): VideoOutput | undefined {
  const root = record(payload)
  for (const key of ['output_video', 'outputVideo']) {
    const video = record(root?.[key])
    const data = stringValue(video?.data)
    const uri = stringValue(video?.uri)
    if (data || uri) {
      return {
        ...(data ? { data } : {}),
        ...(uri ? { uri } : {}),
        mimetype: stringValue(video?.mime_type) ?? stringValue(video?.mimeType) ?? 'video/mp4',
      }
    }
  }
  const steps = Array.isArray(root?.steps) ? root.steps : []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = record(steps[index])
    if (stringValue(step?.type)?.toLowerCase() !== 'model_output') continue
    const content = Array.isArray(step?.content) ? step.content : []
    for (const raw of content) {
      const item = record(raw)
      if (stringValue(item?.type)?.toLowerCase() !== 'video') continue
      const data = stringValue(item?.data)
      const uri = stringValue(item?.uri)
      if (data || uri) {
        return {
          ...(data ? { data } : {}),
          ...(uri ? { uri } : {}),
          mimetype: stringValue(item?.mime_type) ?? stringValue(item?.mimeType) ?? 'video/mp4',
        }
      }
    }
  }
  return undefined
}

function extractVeoVideo(payload: unknown): VideoOutput | undefined {
  const root = record(payload)
  const response = record(root?.response)
  const generateVideoResponse = record(response?.generateVideoResponse)
  const samples = Array.isArray(generateVideoResponse?.generatedSamples) ? generateVideoResponse.generatedSamples : []
  const sample = record(samples[0])
  const video = record(sample?.video)
  const uri = stringValue(video?.uri)
  const data = stringValue(video?.videoBytes) ?? stringValue(video?.data)
  if (!uri && !data) return undefined
  return {
    ...(uri ? { uri } : {}),
    ...(data ? { data } : {}),
    mimetype: stringValue(video?.mimeType) ?? stringValue(video?.mime_type) ?? 'video/mp4',
  }
}

function extractCloudflareImage(payload: unknown): { data: string; mimetype: string } | undefined {
  const root = record(payload)
  const result = record(root?.result)
  const target = result ?? root
  const data = stringValue(target?.image)
  if (!data) return undefined
  return { data, mimetype: stringValue(target?.mime_type) ?? stringValue(target?.mimeType) ?? 'image/jpeg' }
}

function fileIdFromUri(uri: string): string | undefined {
  const match = uri.match(/\/files\/([^/:?]+)/i)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

async function downloadGemini(url: string, apiKey: string, maxBytes = 100 * 1024 * 1024): Promise<{ buffer: Buffer; mimetype: string }> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new MediaAiError('Gemini a renvoyé une URL vidéo non sécurisée.')
  const response = await fetch(parsed, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!response.ok) throw new MediaAiError(`Téléchargement de la vidéo Gemini impossible (${response.status}).`)
  return responseBuffer(response, maxBytes)
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new MediaAiError(stderr.trim().slice(-500) || 'FFmpeg n’a pas pu créer la courte vidéo.'))
    })
  })
}

async function runFfmpegCapture(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new MediaAiError(stderr.trim().slice(-500) || 'FFmpeg n’a pas pu analyser la vidéo générée.'))
    })
  })
}

async function firstFrame(video: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bestla-video-'))
  const input = path.join(directory, video.mimetype.includes('webm') ? 'source.webm' : 'source.mp4')
  const output = path.join(directory, 'frame.jpg')
  try {
    await writeFile(input, video.buffer)
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1', '-q:v', '2', output])
    return { buffer: await readFile(output), mimetype: 'image/jpeg' }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

function cloudflarePool(): CentralCloudflareImageWorker[] {
  return [...CENTRAL_CLOUDFLARE_IMAGE_WORKERS]
}

function nextUtcReset(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 2, 0, 0)
}

function cloudflareCooldownMs(status: number, payload: unknown): number {
  const message = (providerMessage(payload) ?? '').toLowerCase()
  if (status === 429 && /(quota|neuron|daily|allocation|limit|exceed)/i.test(message)) {
    return Math.max(60_000, nextUtcReset() - Date.now())
  }
  if (status === 401 || status === 403) return 60 * 60_000
  if (status === 429) return 10 * 60_000
  if (status >= 500) return 90_000
  return 0
}

function shouldTryNextCloudflareAccount(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 408 || status === 425 || status === 429 || status >= 500
}

export class MediaAiService {
  private readonly geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return this.config.mediaAi.enabled && (this.imageConfigured() || this.videoConfigured() || this.videoFallbackConfigured() || this.imageEditConfigured())
  }

  status(): {
    enabled: boolean
    configured: boolean
    provider: string
    imageProvider: string
    imageConfigured: boolean
    imageAccounts: number
    imageEditConfigured: boolean
    videoProvider: string
    videoConfigured: boolean
    videoFallback: boolean
    imageModel: string
    imageEditModel: string
    videoModel: string
  } {
    return {
      enabled: this.config.mediaAi.enabled,
      configured: this.isConfigured(),
      provider: this.config.mediaAi.provider,
      imageProvider: this.config.mediaAi.imageProvider,
      imageConfigured: this.imageConfigured(),
      imageAccounts: cloudflarePool().length,
      imageEditConfigured: this.imageEditConfigured(),
      videoProvider: this.config.mediaAi.videoProvider,
      videoConfigured: this.videoConfigured(),
      videoFallback: this.videoFallbackConfigured(),
      imageModel: this.config.mediaAi.imageModel,
      imageEditModel: this.config.mediaAi.imageEditModel,
      videoModel: this.config.mediaAi.videoModel,
    }
  }

  async generateImage(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.config.mediaAi.enabled) {
      throw new MediaAiError('La génération média IA est désactivée.')
    }
    if (this.config.mediaAi.imageProvider === 'cloudflare') return this.cloudflareImageRequest(prompt)
    if (this.config.mediaAi.imageProvider === 'gemini') return this.geminiImageRequest(prompt, undefined, this.config.mediaAi.imageModel)
    throw new MediaAiError('Aucun fournisseur image valide n’est configuré.')
  }

  async editImage(prompt: string, image: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.config.mediaAi.enabled) throw new MediaAiError('La modification d’image IA est désactivée.')
    if (this.imageEditConfigured()) return this.geminiImageRequest(prompt, image, this.config.mediaAi.imageEditModel)
    throw new MediaAiError('La retouche d’image avancée nécessite encore Gemini. La génération simple d’images Cloudflare reste disponible.')
  }

  async generateVideo(prompt: string, image?: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.config.mediaAi.enabled) throw new MediaAiError('La génération média IA est désactivée.')

    // Pour le texte -> vidéo, on exige désormais une vraie génération vidéo IA.
    // Aucun secours image + zoom FFmpeg n’est utilisé : une erreur fournisseur est
    // renvoyée telle quelle au lieu de présenter une image animée comme une vidéo IA.
    if (!image) {
      if (!this.videoConfigured()) {
        throw new MediaAiError('La vraie génération vidéo IA nécessite Hugging Face ZeroGPU activé. Ajoute si possible un HF_TOKEN gratuit pour profiter du quota journalier.')
      }
      return this.ensureVideoHasMotion(await this.huggingFaceTextVideoRequest(prompt), 'Hugging Face')
    }

    // L'animation d'image locale reste disponible sans dépendre du quota vidéo distant.
    return this.animateImageLocally(image)
  }

  async editVideo(prompt: string, video: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.config.mediaAi.enabled) throw new MediaAiError('La modification vidéo IA est désactivée.')
    return this.animateImageLocally(await firstFrame(video))
  }

  private hasGeminiMediaKey(): boolean {
    return this.config.mediaAi.apiKey.length >= 12
  }

  private imageConfigured(): boolean {
    if (!this.config.mediaAi.enabled) return false
    if (this.config.mediaAi.imageProvider === 'cloudflare') return cloudflarePool().length > 0
    return this.hasGeminiMediaKey()
  }

  private imageEditConfigured(): boolean {
    return this.config.mediaAi.enabled && this.hasGeminiMediaKey()
  }

  private videoConfigured(): boolean {
    return this.config.mediaAi.enabled
      && this.config.mediaAi.videoProvider === 'huggingface'
      && this.config.mediaAi.videoSpace.length >= 12
      && this.config.mediaAi.videoApiName.length >= 2
  }

  private videoFallbackConfigured(): boolean {
    return this.config.mediaAi.enabled
  }

  private async ensureVideoHasMotion(
    video: { buffer: Buffer; mimetype: string },
    providerLabel: string,
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bestla-motion-check-'))
    const input = path.join(directory, video.mimetype.includes('webm') ? 'source.webm' : 'source.mp4')
    try {
      await writeFile(input, video.buffer)
      const report = await runFfmpegCapture([
        '-hide_banner', '-loglevel', 'error',
        '-i', input,
        '-vf', 'fps=3,scale=96:96:force_original_aspect_ratio=decrease,format=gray',
        '-an', '-f', 'framemd5', '-',
      ])
      const hashes = new Set(
        report
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith('#'))
          .map((line) => line.trim().split(/\s+/).pop() ?? '')
          .filter(Boolean),
      )
      if (hashes.size < 2) {
        throw new MediaAiError(`${providerLabel} a renvoyé une vidéo statique sans vrai mouvement. Aucun faux MP4 n’a été envoyé.`)
      }
      return video
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async animateImageLocally(image: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bestla-local-video-'))
    const input = path.join(directory, image.mimetype.includes('png') ? 'source.png' : 'source.jpg')
    const output = path.join(directory, 'bestla.mp4')
    const portrait = this.config.mediaAi.videoAspectRatio === '9:16'
    const width = portrait ? 720 : 1280
    const height = portrait ? 1280 : 720
    const frames = 5 * 25
    try {
      await writeFile(input, image.buffer)
      const filter = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        `zoompan=z='min(zoom+0.0015,1.12)':d=${frames}:s=${width}x${height}:fps=25`,
        'format=yuv420p',
      ].join(',')
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-loop', '1', '-i', input,
        '-vf', filter,
        '-t', '5', '-r', '25',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', output,
      ])
      return { buffer: await readFile(output), mimetype: 'video/mp4' }
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async geminiImageRequest(
    prompt: string,
    image?: { buffer: Buffer; mimetype: string },
    model = this.config.mediaAi.imageEditModel,
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.hasGeminiMediaKey()) throw new MediaAiError('Gemini média n’est pas configuré.')
    const text = prompt.trim().slice(0, 8_000)
    if (!text) throw new MediaAiError('Le prompt de génération est vide.')
    const input: Array<Record<string, string>> = [{ type: 'text', text }]
    if (image) input.push({ type: 'image', mime_type: normalizeImageMime(image.mimetype), data: image.buffer.toString('base64') })
    const response = await fetch(`${this.geminiBaseUrl}/interactions`, {
      method: 'POST',
      signal: AbortSignal.timeout(180_000),
      headers: { 'x-goog-api-key': this.config.mediaAi.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        input,
        response_format: {
          type: 'image',
          aspect_ratio: this.config.mediaAi.imageAspectRatio,
          image_size: this.config.mediaAi.imageSize,
        },
      }),
    })
    const payload = await responseJson(response)
    if (!response.ok) throw mediaError('gemini', response.status, payload)
    const output = extractGeminiImage(payload)
    if (!output) throw new MediaAiError('Gemini n’a pas renvoyé d’image exploitable.')
    return { buffer: Buffer.from(output.data, 'base64'), mimetype: normalizeImageMime(output.mimetype) }
  }

  private async cloudflareImageRequest(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const text = prompt.trim().slice(0, 2_048)
    if (!text) throw new MediaAiError('Le prompt de génération est vide.')

    const workers = cloudflarePool()
    if (workers.length === 0) throw new MediaAiError('Aucun Worker Cloudflare image n’est disponible.')

    let lastError: MediaAiError | undefined
    let attempted = 0

    for (const worker of workers) {
      const blockedUntil = cloudflareCooldowns.get(worker.url) ?? 0
      if (blockedUntil > Date.now()) continue
      attempted += 1

      try {
        const response = await fetch(worker.url, {
          method: 'POST',
          signal: AbortSignal.timeout(90_000),
          headers: {
            'content-type': 'application/json',
            accept: 'image/*, application/json',
          },
          body: JSON.stringify({ prompt: text, steps: 4 }),
        })

        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        if (response.ok && contentType.startsWith('image/')) {
          cloudflareCooldowns.delete(worker.url)
          return responseBuffer(response)
        }

        const payload = await responseJson(response)
        if (!response.ok) {
          lastError = mediaError('cloudflare', response.status, payload)
          if (!shouldTryNextCloudflareAccount(response.status)) throw lastError

          const cooldownMs = cloudflareCooldownMs(response.status, payload)
          if (cooldownMs > 0) cloudflareCooldowns.set(worker.url, Date.now() + cooldownMs)
          continue
        }

        const output = extractCloudflareImage(payload)
        if (!output) {
          lastError = new MediaAiError(`Le Worker Cloudflare ${worker.label} n’a pas renvoyé d’image exploitable.`)
          continue
        }
        cloudflareCooldowns.delete(worker.url)
        return { buffer: Buffer.from(output.data, 'base64'), mimetype: normalizeImageMime(output.mimetype) }
      } catch (error) {
        if (error instanceof MediaAiError) {
          lastError = error
          continue
        }
        cloudflareCooldowns.set(worker.url, Date.now() + 90_000)
        lastError = new MediaAiError(`Connexion temporairement impossible avec le Worker Cloudflare ${worker.label}.`)
      }
    }

    if (attempted === 0) {
      throw new MediaAiError('Les Workers Cloudflare image sont temporairement en attente après une limite de quota. Réessaie un peu plus tard.')
    }
    throw lastError ?? new MediaAiError('Tous les Workers Cloudflare image sont temporairement indisponibles.')
  }

  private huggingFaceHeaders(json = true): Record<string, string> {
    const headers: Record<string, string> = {}
    if (json) headers['content-type'] = 'application/json'
    if (this.config.mediaAi.videoAccessToken) headers.authorization = `Bearer ${this.config.mediaAi.videoAccessToken}`
    return headers
  }

  private videoDimensions(): { height: number; width: number } {
    return this.config.mediaAi.videoAspectRatio === '9:16'
      ? { height: 704, width: 512 }
      : { height: 512, width: 704 }
  }

  private buildHuggingFaceVideoPayload(schema: unknown, prompt: string): unknown[] {
    const endpoint = record(schema)
    const parameters = Array.isArray(endpoint?.parameters) ? endpoint.parameters : []
    const { height, width } = this.videoDimensions()
    const negativePrompt = 'worst quality, inconsistent motion, blurry, jittery, distorted, watermark, text, subtitles'

    // Ordre officiel actuel de LTX Video Fast /text_to_video :
    // prompt, negative_prompt, image, video, height, width, mode, duration,
    // frames_to_use, seed, randomize_seed, guidance_scale, improve_texture.
    const fallback: unknown[] = [
      prompt,
      negativePrompt,
      null,
      null,
      height,
      width,
      'text-to-video',
      5,
      9,
      42,
      true,
      3,
      false,
    ]
    if (parameters.length === 0) return fallback

    return parameters.map((raw, index) => {
      const parameter = record(raw)
      const name = (
        stringValue(parameter?.parameter_name)
        ?? stringValue(parameter?.name)
        ?? stringValue(parameter?.label)
        ?? ''
      ).toLowerCase()
      const label = (stringValue(parameter?.label) ?? '').toLowerCase()
      const hint = `${name} ${label}`

      if (hint.includes('negative')) return negativePrompt
      if (hint.includes('image')) return null
      if (hint.includes('video') && !hint.includes('duration')) return null
      if (hint.includes('prompt')) return prompt
      if (hint.includes('height')) return height
      if (hint.includes('width')) return width
      if (hint.includes('mode') || hint.includes('task')) return 'text-to-video'
      if (hint.includes('duration')) return 5
      if (hint.includes('frames_to_use') || hint.includes('frames to use')) return 9
      if (hint.includes('randomize')) return true
      if (hint.includes('seed')) return 42
      if (hint.includes('guidance')) return 3
      if (hint.includes('improve_texture') || hint.includes('improve texture')) return false

      const parameterDefault = parameter?.parameter_default
      const defaultValue = parameterDefault !== undefined
        ? parameterDefault
        : parameter
          ? (parameter['default'] ?? record(parameter.props)?.value ?? record(parameter.component_props)?.value)
          : undefined
      const unusableDefault = typeof defaultValue === 'string' && /parameter has no default/i.test(defaultValue)
      return defaultValue !== undefined && !unusableDefault ? defaultValue : fallback[index] ?? null
    })
  }

  private async huggingFaceSpaceInfo(): Promise<unknown> {
    try {
      const response = await fetch(`${this.config.mediaAi.videoSpace}/gradio_api/info`, {
        signal: AbortSignal.timeout(120_000),
        headers: this.huggingFaceHeaders(false),
      })
      const payload = await responseJson(response)
      if (!response.ok) throw mediaError('huggingface', response.status, payload)
      return payload
    } catch (error) {
      if (error instanceof MediaAiError) throw error
      throw new MediaAiError('Connexion au Space Hugging Face impossible ou trop lente. Le Space ZeroGPU peut être en cours de démarrage ; réessaie dans quelques instants.')
    }
  }

  private resolveHuggingFaceEndpoint(info: unknown): { apiName: string; schema?: JsonRecord } {
    const root = record(info)
    const named = record(root?.named_endpoints)
    const desired = this.config.mediaAi.videoApiName
    const desiredKey = desired.startsWith('/') ? desired : `/${desired}`
    if (named) {
      const exact = record(named[desiredKey]) ?? record(named[desiredKey.slice(1)])
      if (exact) return { apiName: desiredKey, schema: exact }
      for (const [key, raw] of Object.entries(named)) {
        const apiName = key.startsWith('/') ? key : `/${key}`
        const endpoint = record(raw)
        const parameters = Array.isArray(endpoint?.parameters) ? endpoint.parameters : []
        const hasPrompt = parameters.some((parameter) => {
          const item = record(parameter)
          const name = (stringValue(item?.parameter_name) ?? stringValue(item?.name) ?? '').toLowerCase()
          return name.includes('prompt') || name == 'text'
        })
        if (hasPrompt && endpoint) return { apiName, schema: endpoint }
      }
    }
    return { apiName: desiredKey }
  }

  private async downloadHuggingFace(url: string, maxBytes = 100 * 1024 * 1024): Promise<{ buffer: Buffer; mimetype: string }> {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(180_000),
        headers: this.huggingFaceHeaders(false),
      })
      if (!response.ok) {
        const payload = await responseJson(response)
        throw mediaError('huggingface', response.status, payload)
      }
      return responseBuffer(response, maxBytes)
    } catch (error) {
      if (error instanceof MediaAiError) throw error
      throw new MediaAiError('La vidéo Hugging Face a été générée mais son téléchargement a échoué. Réessaie dans quelques instants.')
    }
  }

  private async parseHuggingFacePoll(eventUrl: string, deadline: number): Promise<{ url: string; mimetype: string }> {
    while (Date.now() < deadline) {
      const remaining = Math.max(1_000, deadline - Date.now())
      let response: Response
      let text: string
      try {
        response = await fetch(eventUrl, {
          signal: AbortSignal.timeout(Math.min(remaining, 900_000)),
          headers: {
            ...this.huggingFaceHeaders(false),
            accept: 'text/event-stream, application/json',
          },
        })
        text = await response.text()
      } catch {
        if (Date.now() >= deadline) {
          throw new MediaAiError(`La génération vidéo ZeroGPU a dépassé ${Math.ceil(Math.min(this.config.mediaAi.videoTimeoutSeconds, 360))} secondes. Réessaie plus tard : la file gratuite peut être saturée.`)
        }
        throw new MediaAiError('La connexion au flux vidéo Hugging Face a été interrompue avant la fin de la génération. Réessaie dans quelques instants.')
      }

      if (!response.ok) {
        let payload: unknown = {}
        try {
          payload = JSON.parse(text)
        } catch {}
        throw mediaError('huggingface', response.status, payload)
      }

      const events = parseSseEventBlocks(text)
      if (events.length === 0) {
        try {
          const payload = JSON.parse(text)
          const file = extractHuggingFaceVideoFile(payload, this.config.mediaAi.videoSpace)
          if (file) return file
        } catch {}
        await sleep(4_000)
        continue
      }

      for (const item of events) {
        const joined = item.data.join('\n').trim()
        if (!joined) continue
        let payload: unknown
        try {
          payload = JSON.parse(joined)
        } catch {
          continue
        }
        const root = record(payload)
        const errorMessage = typeof payload === 'string' ? payload.trim() : stringValue(root?.error) ?? providerMessage(payload)
        if (item.event === 'error' || errorMessage) {
          throw new MediaAiError(errorMessage ? `Hugging Face a échoué : ${errorMessage.slice(0, 240)}` : 'Hugging Face a signalé une erreur pendant la génération vidéo.')
        }
        const event = item.event ?? stringValue(root?.event)?.toLowerCase() ?? stringValue(root?.msg)?.toLowerCase()
        const file = extractHuggingFaceVideoFile(root?.output ?? root?.data ?? payload, this.config.mediaAi.videoSpace)
        if (file && (!event || event === 'complete' || event === 'success' || event === 'process_completed' || event === 'generating')) {
          return file
        }
      }

      await sleep(4_000)
    }

    throw new MediaAiError(`La génération vidéo ZeroGPU a dépassé ${Math.ceil(Math.min(this.config.mediaAi.videoTimeoutSeconds, 360))} secondes. Réessaie plus tard : la file gratuite peut être saturée.`)
  }

  private async huggingFaceTextVideoRequest(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.videoConfigured()) throw new MediaAiError('Hugging Face vidéo n’est pas configuré.')
    const text = prompt.trim().slice(0, 4_000)
    if (!text) throw new MediaAiError('Le prompt vidéo est vide.')

    const timeoutMs = Math.min(this.config.mediaAi.videoTimeoutSeconds * 1_000, 360_000)
    const deadline = Date.now() + timeoutMs
    const spaceInfo = await this.huggingFaceSpaceInfo()
    const endpoint = this.resolveHuggingFaceEndpoint(spaceInfo)
    const apiSegment = normalizedApiSegment(endpoint.apiName)
    // LTX expose un endpoint texte→vidéo dédié. Le schéma live sert uniquement
    // à rester compatible avec les noms de paramètres Gradio sans changer leur sens.
    const requestBody = { data: this.buildHuggingFaceVideoPayload(endpoint.schema, text) }
    const routes = [
      `${this.config.mediaAi.videoSpace}/call/${apiSegment}`,
      `${this.config.mediaAi.videoSpace}/gradio_api/call/${apiSegment}`,
    ]

    let payload: unknown = {}
    let eventBase = ''
    let lastStatus = 0
    for (const route of routes) {
      let response: Response
      try {
        response = await fetch(route, {
          method: 'POST',
          signal: AbortSignal.timeout(Math.min(timeoutMs, 120_000)),
          headers: this.huggingFaceHeaders(true),
          body: JSON.stringify(requestBody),
        })
      } catch {
        continue
      }
      payload = await responseJson(response)
      if (response.ok) {
        eventBase = route
        lastStatus = 0
        break
      }
      lastStatus = response.status
      if (response.status !== 404 && response.status !== 405) {
        throw mediaError('huggingface', response.status, payload)
      }
    }

    if (!eventBase) {
      if (lastStatus) throw mediaError('huggingface', lastStatus, payload)
      throw new MediaAiError('Impossible de joindre l’API vidéo Hugging Face. Le Space ZeroGPU peut être en démarrage ou temporairement saturé.')
    }

    const root = record(payload)
    const eventId = stringValue(root?.event_id) ?? stringValue(root?.eventId)
    if (!eventId) {
      const file = extractHuggingFaceVideoFile(payload, this.config.mediaAi.videoSpace)
      if (!file) throw new MediaAiError('Hugging Face n’a pas renvoyé d’identifiant de génération vidéo.')
      return this.downloadHuggingFace(file.url)
    }
    const file = await this.parseHuggingFacePoll(`${eventBase}/${eventId}`, deadline)
    return this.downloadHuggingFace(file.url)
  }

  private async geminiVideoRequest(
    prompt: string,
    source?: { kind: 'image' | 'video'; buffer: Buffer; mimetype: string },
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.videoConfigured()) throw new MediaAiError('Gemini vidéo n’est pas configuré.')
    const text = prompt.trim().slice(0, 4_000)
    if (!text) throw new MediaAiError('Le prompt vidéo est vide.')
    const input: unknown = source
      ? source.kind === 'video'
        ? [{ type: 'user_input', content: [{ type: 'video', mime_type: source.mimetype || 'video/mp4', data: source.buffer.toString('base64') }, { type: 'text', text }] }]
        : [{ type: 'image', mime_type: normalizeImageMime(source.mimetype), data: source.buffer.toString('base64') }, { type: 'text', text }]
      : text
    const task = source?.kind === 'image' ? 'image_to_video' : source?.kind === 'video' ? 'edit' : 'text_to_video'
    const timeoutMs = this.config.mediaAi.videoTimeoutSeconds * 1_000
    const deadline = Date.now() + timeoutMs
    const response = await fetch(`${this.geminiBaseUrl}/interactions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'x-goog-api-key': this.config.mediaAi.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.config.mediaAi.videoModel,
        input,
        response_format: { type: 'video', aspect_ratio: this.config.mediaAi.videoAspectRatio, delivery: 'uri' },
        generation_config: { video_config: { task } },
        background: false,
        store: false,
        stream: false,
      }),
    })
    let payload = await responseJson(response)
    if (!response.ok) throw mediaError('gemini', response.status, payload)
    let output = extractGeminiVideo(payload)
    const interactionId = stringValue(record(payload)?.id)
    while (!output && interactionId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      const statusResponse = await fetch(`${this.geminiBaseUrl}/interactions/${encodeURIComponent(interactionId)}`, {
        signal: AbortSignal.timeout(Math.min(45_000, Math.max(1_000, deadline - Date.now()))),
        headers: { 'x-goog-api-key': this.config.mediaAi.apiKey },
      })
      payload = await responseJson(statusResponse)
      if (!statusResponse.ok) throw mediaError('gemini', statusResponse.status, payload)
      const status = stringValue(record(payload)?.status)?.toLowerCase()
      if (status === 'failed' || status === 'cancelled') throw new MediaAiError(providerMessage(payload) ?? 'La génération vidéo Gemini a échoué.')
      output = extractGeminiVideo(payload)
      if (output || status === 'completed') break
    }
    if (!output) throw new MediaAiError(`La génération vidéo n’a pas produit de fichier avant ${this.config.mediaAi.videoTimeoutSeconds} secondes.`)
    if (output.data) return { buffer: Buffer.from(output.data, 'base64'), mimetype: output.mimetype || 'video/mp4' }
    if (!output.uri) throw new MediaAiError('Gemini n’a pas renvoyé de vidéo téléchargeable.')
    const fileId = fileIdFromUri(output.uri)
    if (fileId) {
      while (Date.now() < deadline) {
        const fileResponse = await fetch(`${this.geminiBaseUrl}/files/${encodeURIComponent(fileId)}`, {
          signal: AbortSignal.timeout(Math.min(45_000, Math.max(1_000, deadline - Date.now()))),
          headers: { 'x-goog-api-key': this.config.mediaAi.apiKey },
        })
        const filePayload = await responseJson(fileResponse)
        if (!fileResponse.ok) throw mediaError('gemini', fileResponse.status, filePayload)
        const state = stringValue(record(filePayload)?.state)?.toUpperCase()
        if (state === 'FAILED') throw new MediaAiError('Le traitement final de la vidéo Gemini a échoué.')
        if (state === 'ACTIVE' || !state) break
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
      if (Date.now() >= deadline) throw new MediaAiError(`La génération vidéo a dépassé ${this.config.mediaAi.videoTimeoutSeconds} secondes.`)
      return downloadGemini(`${this.geminiBaseUrl}/files/${encodeURIComponent(fileId)}:download?alt=media`, this.config.mediaAi.apiKey)
    }
    return downloadGemini(output.uri, this.config.mediaAi.apiKey)
  }
}
