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
      ? `Gemini a refusé la demande média (${status}) : ${message.slice(0, 220)}`
      : `Gemini a refusé la demande média (${status}).`,
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
  if (parsed.protocol !== 'https:') throw new MediaAiError('Gemini a renvoyé une URL vidéo non sécurisée.')
  const response = await fetch(parsed, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!response.ok) throw new MediaAiError(`Téléchargement de la vidéo Gemini impossible (${response.status}).`)
  return responseBuffer(response, maxBytes)
}

export class MediaAiService {
  private readonly geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return this.config.mediaAi.enabled && this.config.mediaAi.apiKey.length >= 12
  }

  status(): { enabled: boolean; configured: boolean; provider: string; imageModel: string; videoModel: string } {
    return {
      enabled: this.config.mediaAi.enabled,
      configured: this.isConfigured(),
      provider: 'gemini',
      imageModel: this.config.mediaAi.imageModel,
      videoModel: this.config.mediaAi.videoModel,
    }
  }

  async generateImage(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    return this.geminiImageRequest(prompt)
  }

  async editImage(prompt: string, image: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    return this.geminiImageRequest(prompt, image)
  }

  async generateVideo(prompt: string, image?: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    return this.geminiVideoRequest(prompt, image ? { kind: 'image', ...image } : undefined)
  }

  async editVideo(prompt: string, video: { buffer: Buffer; mimetype: string }): Promise<{ buffer: Buffer; mimetype: string }> {
    return this.geminiVideoRequest(prompt, { kind: 'video', ...video })
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new MediaAiError('Gemini média n’est pas activé ou aucune clé Gemini n’est configurée. Ouvre bestla > Configuration > Clé Gemini.')
    }
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
        response_format: {
          type: 'image',
          aspect_ratio: this.config.mediaAi.imageAspectRatio,
          image_size: this.config.mediaAi.imageSize,
        },
      }),
    })
    const payload = await responseJson(response)
    if (!response.ok) throw mediaError(response.status, payload)
    const output = extractGeminiImage(payload)
    if (!output) throw new MediaAiError('Gemini n’a pas renvoyé d’image exploitable.')
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
        if (!fileResponse.ok) throw mediaError(fileResponse.status, filePayload)
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
