import type { AppConfig } from '../config.js'

export class AiServiceError extends Error {}

type JsonRecord = Record<string, unknown>

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
  return new AiServiceError(message ? `Le fournisseur IA a refusé la demande (${status}) : ${message.slice(0, 180)}` : `Le fournisseur IA a refusé la demande (${status}).`)
}

function openAiCompatibleText(payload: unknown): string | undefined {
  const root = record(payload)
  const choices = Array.isArray(root?.choices) ? root.choices : []
  const first = record(choices[0])
  const message = record(first?.message)
  const content = message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .map((part) => record(part))
      .map((part) => stringValue(part?.text) ?? stringValue(part?.content) ?? '')
      .join('\n')
      .trim()
    if (text) return text
  }
  return undefined
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

/**
 * Adaptateur volontairement réduit : Bestla n'envoie que le texte de la
 * commande au fournisseur choisi, jamais les sessions WhatsApp ou la base.
 */
export class AiService {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return this.config.ai.provider !== 'none' && Boolean(this.config.ai.apiKey && this.config.ai.model)
  }

  status(): { provider: string; model: string; configured: boolean } {
    return {
      provider: this.config.ai.provider,
      model: this.config.ai.model || 'non défini',
      configured: this.isConfigured(),
    }
  }

  async complete(instruction: string, prompt: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new AiServiceError(
        'L’assistant IA n’est pas configuré. Vérifie la configuration IA de Bestla (.env ou panneau Configuration), puis réessaie.',
      )
    }

    const text = prompt.trim().slice(0, 8_000)
    if (!text) throw new AiServiceError('Le texte à envoyer à l’assistant IA est vide.')

    if (this.config.ai.provider === 'gemini') {
      return this.completeGemini(instruction, text)
    }
    return this.completeOpenAiCompatible(instruction, text)
  }

  private async completeOpenAiCompatible(instruction: string, prompt: string): Promise<string> {
    const baseUrl = this.config.ai.baseUrl || 'https://api.openai.com/v1'
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(45_000),
      headers: {
        authorization: `Bearer ${this.config.ai.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.ai.model,
        messages: [
          { role: 'system', content: `${instruction}\nRéponds en français clair. Ne révèle jamais de clé, identifiant ou donnée privée.` },
          { role: 'user', content: prompt },
        ],
        max_tokens: this.config.ai.maxOutputTokens,
        temperature: 0.5,
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) throw providerError(response.status, payload)
    const result = openAiCompatibleText(payload)
    if (!result) throw new AiServiceError('Le fournisseur IA n’a pas renvoyé de texte exploitable.')
    return result.slice(0, 6_000)
  }

  private async completeGemini(instruction: string, prompt: string): Promise<string> {
    const model = encodeURIComponent(this.config.ai.model)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.config.ai.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${instruction}\nRéponds en français clair. Ne révèle jamais de clé, identifiant ou donnée privée.` }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: this.config.ai.maxOutputTokens, temperature: 0.5 },
        }),
      },
    )
    const payload = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) throw providerError(response.status, payload)
    const result = geminiText(payload)
    if (!result) throw new AiServiceError('Le fournisseur IA n’a pas renvoyé de texte exploitable.')
    return result.slice(0, 6_000)
  }
}
