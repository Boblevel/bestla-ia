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
  const label = provider === 'cloudflare' ? 'Cloudflare' : 'Gemini'
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
    return this.config.mediaAi.enabled && (this.imageConfigured() || this.videoFallbackConfigured() || this.imageEditConfigured())
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

    if (this.videoConfigured()) {
      try {
        return await this.geminiVideoRequest(prompt, image ? { kind: 'image', ...image } : undefined)
      } catch {
        // Reprend le comportement fiable de l’ancienne version : courte vidéo locale
        // à partir d’une image si le fournisseur vidéo refuse/quota/billing/indisponibilité.
      }
    }

    const source = image ?? await this.generateImage(prompt)
    return this.animateImageLocally(source)
  }

  async editVideo(prompt: string, video: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.config.mediaAi.enabled) throw new MediaAiError('La modification vidéo IA est désactivée.')
    if (this.videoConfigured()) {
      try {
        return await this.geminiVideoRequest(prompt, { kind: 'video', ...video })
      } catch {
        // Secours local comme dans l’ancienne version.
      }
    }
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
    return this.config.mediaAi.enabled && this.config.mediaAi.videoProvider === 'gemini' && this.hasGeminiMediaKey()
  }

  private videoFallbackConfigured(): boolean {
    return this.config.mediaAi.enabled && this.imageConfigured()
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
