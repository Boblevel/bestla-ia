import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppConfig } from '../config.js'
import { CENTRAL_CLOUDFLARE_IMAGE_WORKERS, type CentralCloudflareImageWorker } from './cloudflare-pool.js'

export class MediaAiError extends Error {}

type JsonRecord = Record<string, unknown>

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

function extractCloudflareImage(payload: unknown): { data: string; mimetype: string } | undefined {
  const root = record(payload)
  const result = record(root?.result)
  const target = result ?? root
  const data = stringValue(target?.image)
  if (!data) return undefined
  return { data, mimetype: stringValue(target?.mime_type) ?? stringValue(target?.mimeType) ?? 'image/jpeg' }
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
      return this.huggingFaceTextVideoRequest(prompt)
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

  private aspectRatioDimensions(): { width: number; height: number } {
    // Résolution volontairement légère pour rester dans le budget ZeroGPU gratuit.
    return this.config.mediaAi.videoAspectRatio === '9:16'
      ? { width: 512, height: 704 }
      : { width: 704, height: 512 }
  }

  private huggingFaceVideoParameterValue(parameter: JsonRecord | undefined, prompt: string): unknown {
    if (!parameter) return undefined
    const name = stringValue(parameter.parameter_name) ?? stringValue(parameter.name) ?? stringValue(parameter.label) ?? ''
    const lower = name.toLowerCase()
    const { width, height } = this.aspectRatioDimensions()

    if (/(^|_)prompt$/.test(lower) || lower === 'text' || lower === 'input_text') return prompt
    if (lower.includes('negative')) return 'worst quality, inconsistent motion, blurry, jittery, distorted'
    if (lower === 'seed') return 0
    if (lower.includes('randomize') && lower.includes('seed')) return true
    if (lower === 'width' || lower === 'width_ui') return width
    if (lower === 'height' || lower === 'height_ui') return height
    if (lower === 'mode' || lower === 'task') return 'text-to-video'
    if (lower.includes('aspect')) return this.config.mediaAi.videoAspectRatio
    if (lower === 'num_frames' || lower === 'frames') return 81
    if (lower.includes('inference') && lower.includes('step')) return 20
    if (lower === 'duration' || lower === 'duration_seconds' || lower === 'duration_ui') return 2
    if (lower === 'fps') return 24
    if (lower.includes('guidance') || lower === 'cfg' || lower === 'cfg_scale') return 3
    if (lower === 'model') return this.config.mediaAi.videoModel
    if (lower === 'resolution') return '720p'

    if ('default' in parameter) return parameter.default
    const props = record(parameter.props)
    if (props && 'value' in props) return props.value
    const componentProps = record(parameter.component_props)
    if (componentProps && 'value' in componentProps) return componentProps.value
    return null
  }

  private defaultHuggingFaceVideoPayload(prompt: string): Record<string, unknown> {
    const { width, height } = this.aspectRatioDimensions()
    return {
      prompt,
      negative_prompt: 'worst quality, inconsistent motion, blurry, jittery, distorted',
      input_image_filepath: null,
      input_video_filepath: null,
      height_ui: height,
      width_ui: width,
      mode: 'text-to-video',
      duration_ui: 2,
      ui_frames_to_use: 9,
      seed_ui: 42,
      randomize_seed: true,
      ui_guidance_scale: 3,
      improve_texture_flag: false,
    }
  }

  private buildHuggingFaceVideoPayload(schema: unknown, prompt: string): Record<string, unknown> {
    const payload = this.defaultHuggingFaceVideoPayload(prompt)
    const endpoint = record(schema)
    const parameters = Array.isArray(endpoint?.parameters) ? endpoint.parameters : []
    for (const raw of parameters) {
      const parameter = record(raw)
      const name = stringValue(parameter?.parameter_name) ?? stringValue(parameter?.name) ?? stringValue(parameter?.label)
      if (!name) continue
      payload[name] = this.huggingFaceVideoParameterValue(parameter, prompt)
    }
    return payload
  }

  private buildHuggingFaceLegacyData(schema: unknown, prompt: string): unknown[] {
    const endpoint = record(schema)
    const parameters = Array.isArray(endpoint?.parameters) ? endpoint.parameters : []
    if (!parameters.length) {
      const payload = this.defaultHuggingFaceVideoPayload(prompt)
      return [
        payload.prompt,
        payload.negative_prompt,
        payload.input_image_filepath,
        payload.input_video_filepath,
        payload.height_ui,
        payload.width_ui,
        payload.mode,
        payload.duration_ui,
        payload.ui_frames_to_use,
        payload.seed_ui,
        payload.randomize_seed,
        payload.ui_guidance_scale,
        payload.improve_texture_flag,
      ]
    }
    return parameters.map((raw) => this.huggingFaceVideoParameterValue(record(raw), prompt))
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
      // Le Space LTX officiel expose explicitement /text_to_video.
      // On le privilégie même si une ancienne configuration contenait /predict.
      const textToVideo = record(named['/text_to_video']) ?? record(named.text_to_video)
      if (textToVideo) return { apiName: '/text_to_video', schema: textToVideo }
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

  private async parseHuggingFacePoll(eventUrl: string, deadline: number, baseUrl: string): Promise<{ url: string; mimetype: string }> {
    while (Date.now() < deadline) {
      const remaining = Math.max(1_000, deadline - Date.now())
      let response: Response
      try {
        response = await fetch(eventUrl, {
          signal: AbortSignal.timeout(Math.min(180_000, remaining)),
          headers: {
            ...this.huggingFaceHeaders(false),
            accept: 'text/event-stream, application/json',
          },
        })
      } catch {
        // Une génération ZeroGPU peut rester silencieuse plus d'une minute pendant
        // l'attente GPU ou l'inférence. On reprend le suivi tant que le délai global
        // MEDIA_AI_VIDEO_TIMEOUT_SECONDS n'est pas dépassé.
        if (Date.now() < deadline) {
          await sleep(3_000)
          continue
        }
        break
      }

      const body = await response.text()
      if (!response.ok) {
        let payload: unknown = {}
        try {
          payload = JSON.parse(body)
        } catch {}
        throw mediaError('huggingface', response.status, payload)
      }

      // Gradio renvoie du SSE sous la forme :
      // event: complete
      // data: [{...fichier vidéo...}, seed]
      // Le nom de l'évènement n'est donc pas forcément contenu dans le JSON "data".
      const blocks = body.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const lines = block.split(/\r?\n/)
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim().toLowerCase()
        const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean)
        for (const raw of dataLines) {
          let payload: unknown
          try {
            payload = JSON.parse(raw)
          } catch {
            continue
          }
          const root = record(payload)
          const errorMessage = stringValue(payload) ?? stringValue(root?.error) ?? providerMessage(payload)
          if (event === 'error' || errorMessage) {
            const detail = errorMessage ?? 'erreur interne du générateur vidéo'
            throw new MediaAiError(`Hugging Face a échoué : ${detail.slice(0, 240)}`)
          }
          const file = extractHuggingFaceVideoFile(root?.output ?? root?.data ?? payload, baseUrl)
          if (file) return file
        }
        if (event === 'complete') {
          throw new MediaAiError('Hugging Face a terminé la génération mais n’a renvoyé aucun fichier vidéo exploitable.')
        }
      }

      // Compatibilité avec les réponses JSON non-SSE.
      try {
        const payload = JSON.parse(body)
        const file = extractHuggingFaceVideoFile(payload, baseUrl)
        if (file) return file
      } catch {}

      await sleep(3_000)
    }

    throw new MediaAiError(`La génération vidéo a dépassé ${this.config.mediaAi.videoTimeoutSeconds} secondes.`)
  }

  private async callHuggingFaceVideoSpace(
    baseUrl: string,
    apiName: string,
    namedPayload: Record<string, unknown>,
    legacyData: unknown[],
    deadline: number,
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    const apiSegment = normalizedApiSegment(apiName)
    const remaining = Math.max(1_000, deadline - Date.now())
    const attempts = [
      { url: `${baseUrl}/gradio_api/call/v2/${apiSegment}`, body: namedPayload },
      { url: `${baseUrl}/gradio_api/call/${apiSegment}`, body: { data: legacyData } },
    ]

    let payload: unknown = {}
    let lastStatus = 0
    let hadNetworkError = false
    for (const attempt of attempts) {
      let response: Response
      try {
        response = await fetch(attempt.url, {
          method: 'POST',
          signal: AbortSignal.timeout(Math.min(180_000, remaining)),
          headers: this.huggingFaceHeaders(true),
          body: JSON.stringify(attempt.body),
        })
      } catch {
        hadNetworkError = true
        continue
      }
      hadNetworkError = false
      payload = await responseJson(response)
      if (response.ok) {
        lastStatus = 0
        break
      }
      lastStatus = response.status
      if (![404, 405, 422].includes(response.status)) throw mediaError('huggingface', response.status, payload)
    }

    if (lastStatus !== 0) throw mediaError('huggingface', lastStatus, payload)
    if (hadNetworkError) throw new MediaAiError('Connexion au Space Hugging Face impossible ou trop lente.')

    const root = record(payload)
    const eventId = stringValue(root?.event_id) ?? stringValue(root?.eventId)
    if (!eventId) {
      const file = extractHuggingFaceVideoFile(payload, baseUrl)
      if (!file) throw new MediaAiError('Hugging Face n’a pas renvoyé d’identifiant de génération vidéo.')
      return this.downloadHuggingFace(file.url)
    }

    const file = await this.parseHuggingFacePoll(`${baseUrl}/gradio_api/call/${apiSegment}/${eventId}`, deadline, baseUrl)
    return this.downloadHuggingFace(file.url)
  }

  private async huggingFaceTextVideoRequest(prompt: string): Promise<{ buffer: Buffer; mimetype: string }> {
    if (!this.videoConfigured()) throw new MediaAiError('Hugging Face vidéo n’est pas configuré.')
    const text = prompt.trim().slice(0, 4_000)
    if (!text) throw new MediaAiError('Le prompt vidéo est vide.')

    const deadline = Date.now() + this.config.mediaAi.videoTimeoutSeconds * 1_000
    const canvas = this.config.mediaAi.videoAspectRatio === '9:16'
      ? '544x960 · 9:16 fast'
      : '960x544 · 16:9 fast'
    const primaryPayload: Record<string, unknown> = {
      prompt: text,
      image_path: null,
      last_image_path: null,
      canvas,
      duration: 2,
      steps: 10,
      seed: 42,
      upsample: false,
    }
    const primaryLegacy = [text, null, null, canvas, 2, 10, 42, false]

    let primaryError: unknown
    try {
      return await this.callHuggingFaceVideoSpace(
        this.config.mediaAi.videoSpace,
        this.config.mediaAi.videoApiName,
        primaryPayload,
        primaryLegacy,
        deadline,
      )
    } catch (error) {
      primaryError = error
    }

    // Secours gratuit : ancien Space LTX, avec paramètres beaucoup plus légers
    // que les précédents essais (2 s, petite résolution, sans multi-scale).
    const ltxBaseUrl = 'https://lightricks-ltx-video-distilled.hf.space'
    const ltxApiName = '/text_to_video'
    const ltxPayload = this.defaultHuggingFaceVideoPayload(text)
    const ltxLegacy = this.buildHuggingFaceLegacyData(undefined, text)
    try {
      return await this.callHuggingFaceVideoSpace(ltxBaseUrl, ltxApiName, ltxPayload, ltxLegacy, deadline)
    } catch (fallbackError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : 'échec du moteur principal'
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'échec du moteur de secours'
      const tokenHint = this.config.mediaAi.videoAccessToken
        ? ''
        : ' Ajoute un HF_TOKEN gratuit pour utiliser ton quota personnel ZeroGPU au lieu du quota anonyme.'
      throw new MediaAiError(
        `Les deux générateurs vidéo gratuits Hugging Face ont échoué. Principal : ${primaryMessage.slice(0, 130)}. Secours : ${fallbackMessage.slice(0, 130)}.${tokenHint}`,
      )
    }
  }


}
