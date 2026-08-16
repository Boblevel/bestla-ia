import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppConfig } from '../config.js'

export class MediaAiError extends Error {}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function providerMessage(payload: unknown): string | undefined {
  const root = record(payload)
  const nested = record(root?.error)
  return stringValue(nested?.message) ?? stringValue(root?.message)
}

function mediaError(status: number, payload: unknown): MediaAiError {
  const message = providerMessage(payload)
  return new MediaAiError(
    message
      ? `Le fournisseur média IA a refusé la demande (${status}) : ${message.slice(0, 220)}`
      : `Le fournisseur média IA a refusé la demande (${status}).`,
  )
}

function shouldUseAnonymousImageFallback(status: number, payload: unknown): boolean {
  if ([401, 402, 429, 502, 503].includes(status)) return true
  const message = (providerMessage(payload) ?? '').toLowerCase()
  return message.includes('insufficient balance')
    || message.includes('balance')
    || message.includes('payment')
    || message.includes('quota')
    || message.includes('credit')
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

function extractOpenAiImage(payload: unknown): { data?: string; url?: string } | undefined {
  const root = record(payload)
  const data = Array.isArray(root?.data) ? root.data : []
  const first = record(data[0])
  const b64 = stringValue(first?.b64_json)
  const url = stringValue(first?.url)
  return b64 || url ? { ...(b64 ? { data: b64 } : {}), ...(url ? { url } : {}) } : undefined
}

async function downloadPublicHttps(url: string, maxBytes = 100 * 1024 * 1024): Promise<{ buffer: Buffer; mimetype: string }> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new MediaAiError('Le fournisseur a renvoyé une URL non sécurisée.')
  const response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new MediaAiError(`Téléchargement du média impossible (${response.status}).`)
  return responseBuffer(response, maxBytes)
}

function imageDimensions(aspectRatio: string, size: '512px' | '1K' | '2K' | '4K'): { width: number; height: number } {
  const base = size === '512px' ? 512 : size === '2K' ? 1536 : size === '4K' ? 2048 : 1024
  if (aspectRatio === '9:16') return { width: Math.round(base * 0.75), height: Math.round(base * 1.333) }
  if (aspectRatio === '16:9') return { width: Math.round(base * 1.333), height: Math.round(base * 0.75) }
  return { width: base, height: base }
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new MediaAiError(stderr.trim().slice(-500) || 'FFmpeg n’a pas pu lire la vidéo source.'))
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

type VideoOutput = { data?: string; uri?: string; mimetype: string }

function extractGeminiVideo(payload: unknown): VideoOutput | undefined {
  const root = record(payload)
  for (const key of ['output_video', 'outputVideo']) {
    const video = record(root?.[key])
    const data = stringValue(video?.data)
    const uri = stringValue(video?.uri)
    if (data || uri) return { ...(data ? { data } : {}), ...(uri ? { uri } : {}), mimetype: stringValue(video?.mime_type) ?? stringValue(video?.mimeType) ?? 'video/mp4' }
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
      if (data || uri) return { ...(data ? { data } : {}), ...(uri ? { uri } : {}), mimetype: stringValue(item?.mime_type) ?? stringValue(item?.mimeType) ?? 'video/mp4' }
    }
  }
  return undefined
}

function fileIdFromUri(uri: string): string | undefined {
  const match = uri.match(/\/files\/([^/:?]+)/i)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

async function downloadGemini(url: string, apiKey: string, maxBytes = 100 * 1024 * 1024): Promise<{ buffer: Buffer; mimetype: string }> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new MediaAiError('Le fournisseur a renvoyé une URL vidéo non sécurisée.')
  const response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(120_000), headers: { 'x-goog-api-key': apiKey } })
  if (!response.ok) throw new MediaAiError(`Téléchargement de la vidéo impossible (${response.status}).`)
  return responseBuffer(response, maxBytes)
}

export class MediaAiService {
  private readonly geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  private readonly pollinationsBaseUrl = 'https://gen.pollinations.ai'

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return this.config.mediaAi.enabled && this.config.mediaAi.apiKey.length >= 12
  }

  status(): { enabled: boolean; configured: boolean; provider: string; imageModel: string; videoModel: string } {
    return {
      enabled: this.config.mediaAi.enabled,
      configured: this.isConfigured(),
      provider: this.config.mediaAi.provider,
      imageModel: this.config.mediaAi.imageModel,
      videoModel: this.config.mediaAi.videoModel,
    }
  }

  async generateImage(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    return this.config.mediaAi.provider === 'pollinations' ? this.pollinationsGenerateImage(prompt) : this.geminiImageRequest(prompt)
  }

  async editImage(prompt: string, image: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    return this.config.mediaAi.provider === 'pollinations' ? this.pollinationsEditImage(prompt, image) : this.geminiImageRequest(prompt, image)
  }

  async generateVideo(prompt: string, image?: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    return this.config.mediaAi.provider === 'pollinations'
      ? this.pollinationsVideo(prompt, image)
      : this.geminiVideoRequest(prompt, image ? { kind: 'image', ...image } : undefined)
  }

  async editVideo(prompt: string, video: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    if (this.config.mediaAi.provider === 'pollinations') {
      const frame = await firstFrame(video)
      const enrichedPrompt = `Recrée cette vidéo à partir de son image de départ en appliquant cette modification : ${prompt}. Garde une continuité visuelle naturelle, mouvements cinématiques cohérents et sujet principal reconnaissable.`
      return this.pollinationsVideo(enrichedPrompt, frame)
    }
    return this.geminiVideoRequest(prompt, { kind: 'video', ...video })
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) throw new MediaAiError('La génération média IA est désactivée. Ouvre bestla > Configuration > API IA automatique, puis autorise la connexion.')
  }

  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.config.mediaAi.apiKey}`, 'Pollinations-Safe': 'privacy,secrets,sexual,violence' }
  }

  private async anonymousPollinationsImage(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const text = prompt.trim().slice(0, 2_000)
    if (!text) throw new MediaAiError('Le prompt de génération est vide.')
    const { width, height } = imageDimensions(this.config.mediaAi.imageAspectRatio, this.config.mediaAi.imageSize)
    const params = new URLSearchParams({
      model: 'flux',
      width: String(Math.min(width, 1280)),
      height: String(Math.min(height, 1280)),
      seed: '-1',
      nologo: 'true',
      enhance: 'true',
      safe: 'true',
    })
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?${params.toString()}`
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(180_000),
      headers: { 'user-agent': 'Bestla-iA-V4/4.0.0' },
    })
    if (!response.ok) {
      throw new MediaAiError(`Le mode image gratuit temporaire est indisponible (${response.status}).`)
    }
    const result = await responseBuffer(response, 25 * 1024 * 1024)
    if (!result.mimetype.startsWith('image/')) throw new MediaAiError('Le mode image gratuit n’a pas renvoyé une image exploitable.')
    return { buffer: result.buffer, mimetype: result.mimetype }
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

  private async pollinationsGenerateImage(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    this.ensureConfigured()
    const text = prompt.trim().slice(0, 8_000)
    if (!text) throw new MediaAiError('Le prompt de génération est vide.')
    const { width, height } = imageDimensions(this.config.mediaAi.imageAspectRatio, this.config.mediaAi.imageSize)
    const response = await fetch(`${this.pollinationsBaseUrl}/v1/images/generations`, {
      method: 'POST',
      signal: AbortSignal.timeout(600_000),
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: text,
        model: this.config.mediaAi.imageModel || 'zimage',
        n: 1,
        size: `${width}x${height}`,
        response_format: 'b64_json',
        safe: 'privacy,secrets,sexual,violence',
      }),
    })
    const payload = await responseJson(response)
    if (!response.ok) {
      if (shouldUseAnonymousImageFallback(response.status, payload)) return this.anonymousPollinationsImage(text)
      throw mediaError(response.status, payload)
    }
    const result = extractOpenAiImage(payload)
    if (!result) throw new MediaAiError('Pollinations n’a pas renvoyé d’image exploitable.')
    if (result.data) return { buffer: Buffer.from(result.data, 'base64'), mimetype: 'image/png' }
    if (result.url) return downloadPublicHttps(result.url)
    throw new MediaAiError('Image Pollinations introuvable dans la réponse.')
  }

  private async pollinationsEditImage(prompt: string, image: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    this.ensureConfigured()
    const text = prompt.trim().slice(0, 8_000)
    if (!text) throw new MediaAiError('Le prompt de modification est vide.')
    const { width, height } = imageDimensions(this.config.mediaAi.imageAspectRatio, this.config.mediaAi.imageSize)
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(image.buffer)], { type: normalizeImageMime(image.mimetype) }), image.mimetype.includes('jpeg') ? 'source.jpg' : 'source.png')
    form.append('prompt', text)
    form.append('model', this.config.mediaAi.imageEditModel || 'kontext')
    form.append('size', `${width}x${height}`)
    const response = await fetch(`${this.pollinationsBaseUrl}/v1/images/edits`, {
      method: 'POST',
      signal: AbortSignal.timeout(600_000),
      headers: this.authHeaders(),
      body: form,
    })
    const payload = await responseJson(response)
    if (!response.ok) throw mediaError(response.status, payload)
    const result = extractOpenAiImage(payload)
    if (!result) throw new MediaAiError('Pollinations n’a pas renvoyé d’image modifiée exploitable.')
    if (result.data) return { buffer: Buffer.from(result.data, 'base64'), mimetype: 'image/png' }
    if (result.url) return downloadPublicHttps(result.url)
    throw new MediaAiError('Image modifiée introuvable dans la réponse.')
  }

  private async pollinationsUpload(media: { buffer: Buffer; mimetype: string }, filename: string): Promise<string> {
    this.ensureConfigured()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(media.buffer)], { type: media.mimetype }), filename)
    const response = await fetch(`${this.pollinationsBaseUrl}/upload`, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: this.authHeaders(),
      body: form,
    })
    const payload = await responseJson(response)
    if (!response.ok) throw mediaError(response.status, payload)
    const url = stringValue(record(payload)?.url)
    if (!url) throw new MediaAiError('Le fournisseur n’a pas renvoyé l’URL du média temporaire.')
    return url
  }

  private async pollinationsVideo(prompt: string, image?: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    this.ensureConfigured()
    const text = prompt.trim().slice(0, 4_000)
    if (!text) throw new MediaAiError('Le prompt vidéo est vide.')
    const params = new URLSearchParams({
      model: this.config.mediaAi.videoModel || 'wan-fast',
      duration: '5',
      aspectRatio: this.config.mediaAi.videoAspectRatio,
      safe: 'privacy,secrets,sexual,violence',
    })
    if (image) {
      try {
        params.set('image', await this.pollinationsUpload(image, image.mimetype.includes('jpeg') ? 'reference.jpg' : 'reference.png'))
      } catch (error) {
        if (error instanceof MediaAiError) return this.animateImageLocally(image)
        throw error
      }
    }
    const response = await fetch(`${this.pollinationsBaseUrl}/video/${encodeURIComponent(text)}?${params.toString()}`, {
      signal: AbortSignal.timeout(this.config.mediaAi.videoTimeoutSeconds * 1_000),
      headers: this.authHeaders(),
    })
    if (!response.ok) {
      const payload = await responseJson(response)
      if (shouldUseAnonymousImageFallback(response.status, payload)) {
        const fallbackImage = image ?? await this.anonymousPollinationsImage(text)
        return this.animateImageLocally(fallbackImage)
      }
      throw mediaError(response.status, payload)
    }
    const result = await responseBuffer(response)
    if (!result.mimetype.startsWith('video/')) throw new MediaAiError('Pollinations n’a pas renvoyé une vidéo MP4 exploitable.')
    return { buffer: result.buffer, mimetype: result.mimetype || 'video/mp4' }
  }

  private async geminiImageRequest(prompt: string, image?: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    this.ensureConfigured()
    const text = prompt.trim().slice(0, 8_000)
    if (!text) throw new MediaAiError('Le prompt de génération est vide.')
    const input: Array<Record<string, string>> = [{ type: 'text', text }]
    if (image) input.push({ type: 'image', mime_type: normalizeImageMime(image.mimetype), data: image.buffer.toString('base64') })
    const response = await fetch(`${this.geminiBaseUrl}/interactions`, {
      method: 'POST',
      signal: AbortSignal.timeout(180_000),
      headers: { 'x-goog-api-key': this.config.mediaAi.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.config.mediaAi.imageModel,
        input,
        response_format: { type: 'image', aspect_ratio: this.config.mediaAi.imageAspectRatio, image_size: this.config.mediaAi.imageSize },
      }),
    })
    const payload = await responseJson(response)
    if (!response.ok) throw mediaError(response.status, payload)
    const output = extractGeminiImage(payload)
    if (!output) throw new MediaAiError('Le fournisseur n’a pas renvoyé d’image exploitable.')
    return { buffer: Buffer.from(output.data, 'base64'), mimetype: normalizeImageMime(output.mimetype) }
  }

  private async geminiVideoRequest(
    prompt: string,
    source?: { kind: 'image' | 'video'; buffer: Buffer; mimetype: string },
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    this.ensureConfigured()
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
    if (!response.ok) throw mediaError(response.status, payload)
    let output = extractGeminiVideo(payload)
    const interactionId = stringValue(record(payload)?.id)
    while (!output && interactionId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      const statusResponse = await fetch(`${this.geminiBaseUrl}/interactions/${encodeURIComponent(interactionId)}`, {
        signal: AbortSignal.timeout(Math.min(45_000, Math.max(1_000, deadline - Date.now()))),
        headers: { 'x-goog-api-key': this.config.mediaAi.apiKey },
      })
      payload = await responseJson(statusResponse)
      if (!statusResponse.ok) throw mediaError(statusResponse.status, payload)
      const status = stringValue(record(payload)?.status)?.toLowerCase()
      if (status === 'failed' || status === 'cancelled') throw new MediaAiError(providerMessage(payload) ?? 'La génération vidéo a échoué chez le fournisseur.')
      output = extractGeminiVideo(payload)
      if (output || status === 'completed') break
    }
    if (!output) throw new MediaAiError(`La génération vidéo n’a pas produit de fichier avant ${this.config.mediaAi.videoTimeoutSeconds} secondes.`)
    if (output.data) return { buffer: Buffer.from(output.data, 'base64'), mimetype: output.mimetype || 'video/mp4' }
    if (!output.uri) throw new MediaAiError('Le fournisseur n’a pas renvoyé de vidéo téléchargeable.')
    const fileId = fileIdFromUri(output.uri)
    if (fileId) {
      while (Date.now() < deadline) {
        const fileResponse = await fetch(`${this.geminiBaseUrl}/files/${encodeURIComponent(fileId)}`, {
          signal: AbortSignal.timeout(Math.min(45_000, Math.max(1_000, deadline - Date.now()))),
          headers: { 'x-goog-api-key': this.config.mediaAi.apiKey },
        })
        const filePayload = await responseJson(fileResponse)
        if (!fileResponse.ok) throw mediaError(fileResponse.status, filePayload)
        const state = stringValue(record(filePayload)?.state)?.toUpperCase()
        if (state === 'FAILED') throw new MediaAiError('Le traitement final de la vidéo a échoué chez le fournisseur.')
        if (state === 'ACTIVE' || !state) break
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
      if (Date.now() >= deadline) throw new MediaAiError(`La génération vidéo a dépassé ${this.config.mediaAi.videoTimeoutSeconds} secondes.`)
      return downloadGemini(`${this.geminiBaseUrl}/files/${encodeURIComponent(fileId)}:download?alt=media`, this.config.mediaAi.apiKey)
    }
    return downloadGemini(output.uri, this.config.mediaAi.apiKey)
  }
}
