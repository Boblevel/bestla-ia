import type { AppConfig } from '../config.js'

/**
 * La signature de marque est réservée au seul menu WhatsApp (.menu).
 * Les autres réponses restent naturelles et sans pied de page automatique.
 */
export function signText(text: string, _config: AppConfig): string {
  return text.trim()
}

export function brandedPanel(title: string, lines: string[], _config: AppConfig): string {
  return [
    `╭━━〔 *${title}* 〕━━╮`,
    ...lines.map((line) => `┃ ${line}`),
    '╰━━━━━━━━━━━━━━━━━━╯',
  ].join('\n')
}
