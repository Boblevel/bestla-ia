import { areJidsSameUser, jidNormalizedUser } from '@whiskeysockets/baileys'

export function phoneToJid(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return undefined
  return `${digits}@s.whatsapp.net`
}

export function normalizeUserJid(jid: string | null | undefined): string {
  if (!jid) return ''
  try {
    return jidNormalizedUser(jid)
  } catch {
    return jid
  }
}

export function sameUser(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false
  try {
    return areJidsSameUser(left, right)
  } catch {
    return normalizeUserJid(left) === normalizeUserJid(right)
  }
}

export function jidToMention(jid: string): string {
  return `@${jid.split('@')[0]?.split(':')[0] ?? jid}`
}

export function normalizeDestination(value: string): string | undefined {
  const trimmed = value.trim()
  if (/^[\w.-]+@g\.us$/.test(trimmed)) return trimmed
  if (/^[\w.-]+@s\.whatsapp\.net$/.test(trimmed)) return normalizeUserJid(trimmed)
  return phoneToJid(trimmed)
}
