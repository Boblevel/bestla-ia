import { createHmac } from 'node:crypto'
import type { AppConfig } from '../config.js'
import type { IncomingWebhookPayload } from '../types.js'
import { logger } from './logger.js'

export class WebhookDispatcher {
  constructor(private readonly config: AppConfig) {}

  dispatch(payload: IncomingWebhookPayload): void {
    if (!this.config.webhook.url) return
    void this.post(payload)
  }

  private async post(payload: IncomingWebhookPayload): Promise<void> {
    const body = JSON.stringify(payload)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.config.webhook.secret) {
      headers['x-bot-signature'] = `sha256=${createHmac('sha256', this.config.webhook.secret).update(body).digest('hex')}`
    }

    try {
      const response = await fetch(this.config.webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) {
        logger.warn({ status: response.status }, 'Le webhook a refusé un événement')
      }
    } catch (error) {
      logger.warn({ err: error }, 'Échec de l’envoi du webhook')
    }
  }
}
