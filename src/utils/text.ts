import { extractMessageContent, type proto, type WAMessage } from '@whiskeysockets/baileys'

export function unwrapMessage(message: proto.IMessage | null | undefined): proto.IMessage | undefined {
  if (!message) return undefined
  return extractMessageContent(message) ?? message
}

export function messageText(message: WAMessage): string {
  const content = unwrapMessage(message.message)
  if (!content) return ''

  const interactiveParams = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
  let interactiveId = ''
  if (interactiveParams) {
    try {
      const parsed = JSON.parse(interactiveParams) as { id?: unknown }
      if (typeof parsed.id === 'string') interactiveId = parsed.id
    } catch {
      interactiveId = ''
    }
  }

  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.buttonsResponseMessage?.selectedButtonId ??
    content.listResponseMessage?.singleSelectReply?.selectedRowId ??
    content.templateButtonReplyMessage?.selectedId ??
    interactiveId ??
    ''
  ).trim()
}

export function messageType(message: WAMessage): string {
  const content = unwrapMessage(message.message)
  if (!content) return 'unknown'
  return Object.keys(content).find((key) => key !== 'messageContextInfo') ?? 'unknown'
}

export interface ParsedCommand {
  isCommand: boolean
  name: string
  args: string[]
  argText: string
}

export function parseCommand(body: string, prefix: string): ParsedCommand {
  if (!body.startsWith(prefix)) return { isCommand: false, name: '', args: [], argText: '' }
  const withoutPrefix = body.slice(prefix.length).trim()
  if (!withoutPrefix) return { isCommand: false, name: '', args: [], argText: '' }
  const [rawName = '', ...args] = withoutPrefix.split(/\s+/)
  return {
    isCommand: true,
    name: rawName.toLowerCase(),
    args,
    argText: args.join(' '),
  }
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [days && `${days}j`, hours && `${hours}h`, minutes && `${minutes}min`, `${rest}s`]
    .filter(Boolean)
    .join(' ')
}

export function normalizeWords(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}
