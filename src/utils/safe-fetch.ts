import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function privateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a = 0, b = 0] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^fe[89ab]/.test(normalized)) return true
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  return mapped ? privateIpv4(mapped) : false
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return privateIpv4(address)
  if (family === 6) return privateIpv6(address)
  return true
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Seules les URL HTTP(S) sont acceptées.')
  if (url.username || url.password) throw new Error('Les identifiants dans une URL sont interdits.')
  if (url.hostname.toLowerCase() === 'localhost') throw new Error('Adresse locale interdite.')
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Adresse réseau privée ou non résolue interdite.')
  }
}

export interface SafeFetchResult {
  buffer: Buffer
  contentType: string
  finalUrl: string
}

export async function safeFetchBuffer(
  input: string,
  maxBytes: number,
  redirectsRemaining = 3,
): Promise<SafeFetchResult> {
  const url = new URL(input)
  await assertPublicUrl(url)

  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': 'Bestla-iA-Bot/3.0' },
  })

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectsRemaining <= 0) throw new Error('Trop de redirections.')
    const location = response.headers.get('location')
    if (!location) throw new Error('Redirection sans destination.')
    return safeFetchBuffer(new URL(location, url).toString(), maxBytes, redirectsRemaining - 1)
  }
  if (!response.ok) throw new Error(`Téléchargement refusé (HTTP ${response.status}).`)

  const announcedSize = Number(response.headers.get('content-length') ?? 0)
  if (announcedSize > maxBytes) throw new Error('Le média distant dépasse la taille maximale.')
  if (!response.body) throw new Error('Réponse distante vide.')

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw new Error('Le média distant dépasse la taille maximale.')
    }
    chunks.push(Buffer.from(value))
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
    finalUrl: url.toString(),
  }
}
