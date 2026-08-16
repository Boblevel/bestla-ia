import type { AppConfig } from '../config.js'

export function signatureLine(config: AppConfig): string {
  return `✦ BY ${config.signature}`
}

export function signText(text: string, config: AppConfig): string {
  const signature = signatureLine(config)
  if (text.includes(signature)) return text
  return `${text}\n\n${signature}`
}

export function brandedPanel(title: string, lines: string[], config: AppConfig): string {
  return [
    `╭━━〔 ✦ *${config.botName}* ✦ 〕━━╮`,
    `┃ *${title}*`,
    ...lines.map((line) => `┃ ${line}`),
    '╰━━━━━━━━━━━━━━━━━━╯',
    signatureLine(config),
  ].join('\n')
}
