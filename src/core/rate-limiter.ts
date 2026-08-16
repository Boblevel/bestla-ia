export class CooldownManager {
  private readonly entries = new Map<string, number>()

  consume(key: string, cooldownSeconds: number): number {
    if (cooldownSeconds <= 0) return 0
    const now = Date.now()
    const expiresAt = this.entries.get(key) ?? 0
    if (expiresAt > now) return Math.ceil((expiresAt - now) / 1000)
    this.entries.set(key, now + cooldownSeconds * 1000)
    if (this.entries.size > 10_000) this.cleanup(now)
    return 0
  }

  private cleanup(now = Date.now()): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key)
    }
  }
}

interface SpamEntry {
  timestamps: number[]
  mutedUntil: number
}

export class SpamDetector {
  private readonly entries = new Map<string, SpamEntry>()

  isSpam(key: string, limit = 7, windowMs = 8_000): boolean {
    const now = Date.now()
    const current = this.entries.get(key) ?? { timestamps: [], mutedUntil: 0 }
    current.timestamps = current.timestamps.filter((timestamp) => now - timestamp <= windowMs)
    current.timestamps.push(now)

    if (current.mutedUntil > now) {
      this.entries.set(key, current)
      return false
    }

    const detected = current.timestamps.length >= limit
    if (detected) {
      current.mutedUntil = now + 20_000
      current.timestamps = []
    }
    this.entries.set(key, current)
    return detected
  }
}
