import type { AppConfig } from '../config.js'

export class AiServiceError extends Error {}

type JsonRecord = Record<string, unknown>
export type AiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

export interface AiCompletionOptions {
  model?: string
  maxOutputTokens?: number
  thinkingLevel?: AiThinkingLevel
  timeoutMs?: number
  fallbackToConfiguredModel?: boolean
  replyInPromptLanguage?: boolean
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function providerError(status: number, payload: unknown): AiServiceError {
  const root = record(payload)
  const nested = record(root?.error)
  const message = stringValue(nested?.message) ?? stringValue(root?.message)
  return new AiServiceError(message ? `Gemini a refusé la demande (${status}) : ${message.slice(0, 180)}` : `Gemini a refusé la demande (${status}).`)
}

function geminiText(payload: unknown): string | undefined {
  const root = record(payload)
  const candidates = Array.isArray(root?.candidates) ? root.candidates : []
  const candidate = record(candidates[0])
  const content = record(candidate?.content)
  const parts = Array.isArray(content?.parts) ? content.parts : []
  const text = parts
    .map((part) => record(part))
    .map((part) => stringValue(part?.text) ?? '')
    .join('\n')
    .trim()
  return text || undefined
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.round(value ?? fallback)))
}

/**
 * Adaptateur volontairement réduit : Bestla n'envoie que le texte de la
 * commande au fournisseur choisi, jamais les sessions WhatsApp ou la base.
 */
export class AiService {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.ai.apiKey && this.config.ai.model)
  }

  status(): { provider: string; model: string; configured: boolean } {
    return {
      provider: this.config.ai.provider,
      model: this.config.ai.model || 'non défini',
      configured: this.isConfigured(),
    }
  }

  async extractKnowledgeFromMedia(buffer: Buffer, mimetype: string, label = ''): Promise<string> {
    if (!this.isConfigured()) {
      throw new AiServiceError(
        'L’assistant IA n’est pas configuré. Vérifie la configuration IA de Bestla (.env ou panneau Configuration), puis réessaie.',
      )
    }
    if (buffer.length === 0) throw new AiServiceError('Le média à analyser est vide.')
    if (buffer.length > 12 * 1024 * 1024) {
      throw new AiServiceError('Le média est trop volumineux pour être ajouté à la base IA (12 Mo maximum).')
    }

    const model = encodeURIComponent(this.config.ai.model)
    let response: Response
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(60_000),
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.config.ai.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: 'Analyse ce média pour construire une base de connaissances client. Extrais uniquement les informations factuelles et utiles réellement présentes. Ne devine rien. Réponds en français, de façon compacte et structurée, sans révéler de donnée technique privée.',
              }],
            },
            contents: [{
              role: 'user',
              parts: [
                { text: `Nom de la connaissance : ${label.trim().slice(0, 120) || 'média WhatsApp'}` },
                { inlineData: { mimeType: mimetype || 'application/octet-stream', data: buffer.toString('base64') } },
              ],
            }],
            generationConfig: { maxOutputTokens: 800 },
          }),
        },
      )
    } catch {
      throw new AiServiceError('Gemini est temporairement indisponible ou trop lent pour analyser ce média.')
    }

    const payload = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) throw providerError(response.status, payload)
    const result = geminiText(payload)
    if (!result) throw new AiServiceError('Gemini n’a pas pu extraire d’information exploitable de ce média.')
    return result.slice(0, 6_000)
  }

  async complete(instruction: string, prompt: string, options: AiCompletionOptions = {}): Promise<string> {
    if (!this.isConfigured()) {
      throw new AiServiceError(
        'L’assistant IA n’est pas configuré. Vérifie la configuration IA de Bestla (.env ou panneau Configuration), puis réessaie.',
      )
    }

    const text = prompt.trim().slice(0, 8_000)
    if (!text) throw new AiServiceError('Le texte à envoyer à l’assistant IA est vide.')

    const requestedModel = options.model?.trim() || this.config.ai.model
    try {
      return await this.completeGemini(instruction, text, requestedModel, options)
    } catch (error) {
      const shouldFallback =
        options.fallbackToConfiguredModel === true
        && requestedModel !== this.config.ai.model
        && error instanceof AiServiceError
      if (!shouldFallback) throw error

      return this.completeGemini(instruction, text, this.config.ai.model, {
        ...options,
        model: this.config.ai.model,
        thinkingLevel: 'minimal',
        fallbackToConfiguredModel: false,
      })
    }
  }

  private async completeGemini(
    instruction: string,
    prompt: string,
    modelName: string,
    options: AiCompletionOptions,
  ): Promise<string> {
    const model = encodeURIComponent(modelName)
    const maxOutputTokens = clampInteger(options.maxOutputTokens, this.config.ai.maxOutputTokens, 64, 2_000)
    const timeoutMs = clampInteger(options.timeoutMs, 45_000, 1_200, 60_000)
    const thinkingLevel = options.thinkingLevel
    const generationConfig: Record<string, unknown> = { maxOutputTokens }
    if (thinkingLevel && /^gemini-3(?:\.|-)/i.test(modelName)) {
      generationConfig.thinkingConfig = { thinkingLevel }
    }

    let response: Response
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.config.ai.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${instruction}\n${options.replyInPromptLanguage ? 'Réponds dans la langue principalement utilisée par le message reçu, sauf demande contraire.' : 'Réponds en français clair.'}\nNe révèle jamais de clé, identifiant ou donnée privée.` }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig,
          }),
        },
      )
    } catch {
      throw new AiServiceError('Gemini est temporairement indisponible ou trop lent.')
    }
    const payload = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) throw providerError(response.status, payload)
    const result = geminiText(payload)
    if (!result) throw new AiServiceError('Gemini n’a pas renvoyé de texte exploitable.')
    return result.slice(0, 6_000)
  }
}
