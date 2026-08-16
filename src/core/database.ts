import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig } from '../config.js'
import { logger } from './logger.js'

export interface GroupSettings {
  welcome: boolean
  goodbye: boolean
  antilink: boolean
  antispam: boolean
  badwords: string[]
  welcomeMessage: string
  goodbyeMessage: string
  allowedDomains: string[]
  rules: string
}

export type AutomationScope = 'prive' | 'groupe' | 'tous'

export interface AutoReplyRule {
  id: string
  trigger: string
  response: string
  scope: AutomationScope
  match: 'contient' | 'exact'
}

export interface ReactionRule {
  id: string
  trigger: string
  emoji: string
  scope: AutomationScope
}

export interface AutomationSettings {
  autoRepliesEnabled: boolean
  autoReplies: AutoReplyRule[]
  away: {
    enabled: boolean
    message: string
  }
  businessHours: {
    enabled: boolean
    start: string
    end: string
    days: number[]
    message: string
  }
  autoReactionsEnabled: boolean
  reactions: ReactionRule[]
  customerAi: {
    enabled: boolean
    instructions: string
  }
  faq: Record<string, string>
  notes: Record<string, string>
  shortcuts: Record<string, string>
  business: {
    entreprise: string
    services: string
    tarifs: string
    contact: string
    adresse: string
    paiement: string
    livraison: string
    reseaux: string
    catalogue: string
    conditions: string
  }
}

export interface DigitalProduct {
  id: string
  name: string
  description: string
  deliveryText: string
  active: boolean
  deliveredCount: number
  createdAt: string
  updatedAt: string
}

export type TicketStatus = 'ouvert' | 'ferme'
export type TicketPriority = 'basse' | 'normale' | 'haute' | 'urgente'

export interface SupportTicket {
  id: string
  sessionName: string
  chatId: string
  createdBy: string
  subject: string
  status: TicketStatus
  priority: TicketPriority
  createdAt: string
  updatedAt: string
}

export type FinanceEntryType = 'revenu' | 'depense'

/**
 * Les entrées budget sont volontairement liées au propriétaire qui les a créées.
 * Elles ne sont jamais visibles dans une discussion de groupe.
 */
export interface FinanceEntry {
  id: string
  owner: string
  type: FinanceEntryType
  amount: number
  category: string
  note: string
  createdAt: string
}

export interface ScheduledJob {
  id: string
  sessionName: string
  chatId: string
  createdBy: string
  message: string
  nextRunAt: string
  repeat: 'aucune' | 'quotidien'
  status: 'en_attente' | 'en_cours' | 'envoye' | 'echec' | 'annule'
  createdAt: string
  claimedAt: string | null
  lastError: string | null
}

export interface WarningRecord {
  count: number
  reasons: string[]
  updatedAt: string
}

interface DatabaseSchema {
  version: 5
  global: {
    publicMode: boolean | null
    prefix: string | null
    disabledCommands: string[]
  }
  groups: Record<string, GroupSettings>
  warnings: Record<string, Record<string, WarningRecord>>
  automation: AutomationSettings
  schedules: ScheduledJob[]
  tickets: SupportTicket[]
  finances: FinanceEntry[]
  digitalProducts: DigitalProduct[]
}

const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  welcome: false,
  goodbye: false,
  antilink: false,
  antispam: false,
  badwords: [],
  welcomeMessage: '',
  goodbyeMessage: '',
  allowedDomains: [],
  rules: '',
}

const DEFAULT_AUTOMATION: AutomationSettings = {
  autoRepliesEnabled: false,
  autoReplies: [],
  away: {
    enabled: false,
    message: 'Merci pour votre message. Nous sommes momentanément indisponibles et vous répondrons dès que possible.',
  },
  businessHours: {
    enabled: false,
    start: '08:00',
    end: '18:00',
    days: [1, 2, 3, 4, 5, 6],
    message: 'Notre service est actuellement fermé. Nous traiterons votre message pendant nos heures d’ouverture.',
  },
  autoReactionsEnabled: false,
  reactions: [],
  customerAi: {
    enabled: false,
    instructions: 'Réponds comme un service client professionnel, poli et respectueux. Sois bref, précis et utile. Ne promets jamais un prix, un délai ou une disponibilité qui ne figure pas dans les informations de l’entreprise. Si une information manque, propose de transmettre la demande au responsable.',
  },
  faq: {},
  notes: {},
  shortcuts: {},
  business: {
    entreprise: '',
    services: '',
    tarifs: '',
    contact: '',
    adresse: '',
    paiement: '',
    livraison: '',
    reseaux: '',
    catalogue: '',
    conditions: '',
  },
}

function initialData(): DatabaseSchema {
  return {
    version: 5,
    global: { publicMode: null, prefix: null, disabledCommands: [] },
    groups: {},
    warnings: {},
    automation: cloneAutomation(DEFAULT_AUTOMATION),
    schedules: [],
    tickets: [],
    finances: [],
    digitalProducts: [],
  }
}

function cloneGroupSettings(value: GroupSettings): GroupSettings {
  return {
    ...value,
    badwords: [...value.badwords],
    allowedDomains: [...value.allowedDomains],
  }
}

function cloneAutomation(value: AutomationSettings): AutomationSettings {
  return {
    ...value,
    autoReplies: value.autoReplies.map((rule) => ({ ...rule })),
    away: { ...value.away },
    businessHours: { ...value.businessHours, days: [...value.businessHours.days] },
    reactions: value.reactions.map((rule) => ({ ...rule })),
    customerAi: { ...value.customerAi },
    faq: { ...value.faq },
    notes: { ...value.notes },
    shortcuts: { ...value.shortcuts },
    business: { ...value.business },
  }
}

function cloneTicket(value: SupportTicket): SupportTicket {
  return { ...value }
}

function cloneFinance(value: FinanceEntry): FinanceEntry {
  return { ...value }
}

function cloneDigitalProduct(value: DigitalProduct): DigitalProduct {
  return { ...value }
}

export class JsonDatabase {
  private readonly filePath: string
  private data: DatabaseSchema = initialData()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(config: AppConfig) {
    this.filePath = path.join(config.dataDir, 'database.json')
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<DatabaseSchema>
      this.data = {
        ...initialData(),
        ...parsed,
        version: 5,
        global: {
          ...initialData().global,
          ...parsed.global,
          disabledCommands: parsed.global?.disabledCommands ?? [],
        },
        groups: parsed.groups ?? {},
        warnings: parsed.warnings ?? {},
        automation: {
          ...cloneAutomation(DEFAULT_AUTOMATION),
          ...parsed.automation,
          away: { ...DEFAULT_AUTOMATION.away, ...parsed.automation?.away },
          businessHours: {
            ...DEFAULT_AUTOMATION.businessHours,
            ...parsed.automation?.businessHours,
            days: parsed.automation?.businessHours?.days ?? [...DEFAULT_AUTOMATION.businessHours.days],
          },
          autoReplies: parsed.automation?.autoReplies ?? [],
          reactions: parsed.automation?.reactions ?? [],
          customerAi: { ...DEFAULT_AUTOMATION.customerAi, ...parsed.automation?.customerAi },
          faq: parsed.automation?.faq ?? {},
          notes: parsed.automation?.notes ?? {},
          shortcuts: parsed.automation?.shortcuts ?? {},
          business: { ...DEFAULT_AUTOMATION.business, ...parsed.automation?.business },
        },
        schedules: parsed.schedules ?? [],
        tickets: parsed.tickets ?? [],
        finances: parsed.finances ?? [],
        digitalProducts: parsed.digitalProducts ?? [],
      }
      const staleBefore = Date.now() - 5 * 60_000
      for (const job of this.data.schedules) {
        if (job.status === 'en_cours' && (!job.claimedAt || Date.parse(job.claimedAt) < staleBefore)) {
          job.status = 'en_attente'
          job.claimedAt = null
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const backup = `${this.filePath}.corrupt-${Date.now()}`
        logger.error({ err: error, backup }, 'Base JSON illisible, création d’une sauvegarde')
        await rename(this.filePath, backup).catch(() => undefined)
      }
      await this.persist()
    }
  }

  getPublicMode(fallback: boolean): boolean {
    return this.data.global.publicMode ?? fallback
  }

  getPrefix(fallback: string): string {
    return this.data.global.prefix ?? fallback
  }

  async setPublicMode(value: boolean): Promise<void> {
    await this.mutate((data) => {
      data.global.publicMode = value
    })
  }

  async setPrefix(value: string): Promise<void> {
    await this.mutate((data) => {
      data.global.prefix = value
    })
  }

  isCommandEnabled(name: string): boolean {
    return !this.data.global.disabledCommands.includes(name.trim().toLowerCase())
  }

  listDisabledCommands(): string[] {
    return [...this.data.global.disabledCommands].sort()
  }

  async setCommandEnabled(name: string, enabled: boolean): Promise<void> {
    const normalized = name.trim().toLowerCase()
    if (!normalized) return
    await this.mutate((data) => {
      const current = new Set(data.global.disabledCommands)
      if (enabled) current.delete(normalized)
      else current.add(normalized)
      data.global.disabledCommands = [...current].sort()
    })
  }

  getGroup(groupId: string): GroupSettings {
    const stored = this.data.groups[groupId]
    return cloneGroupSettings({
      ...DEFAULT_GROUP_SETTINGS,
      ...stored,
      badwords: stored?.badwords ?? [],
      allowedDomains: stored?.allowedDomains ?? [],
    })
  }

  async updateGroup(groupId: string, patch: Partial<GroupSettings>): Promise<GroupSettings> {
    let result = this.getGroup(groupId)
    await this.mutate((data) => {
      const stored = data.groups[groupId]
      const current: GroupSettings = {
        ...DEFAULT_GROUP_SETTINGS,
        ...stored,
        badwords: stored?.badwords ?? [],
        allowedDomains: stored?.allowedDomains ?? [],
      }
      result = {
        ...current,
        ...patch,
        badwords: patch.badwords ? [...patch.badwords] : [...current.badwords],
        allowedDomains: patch.allowedDomains ? [...patch.allowedDomains] : [...current.allowedDomains],
      }
      data.groups[groupId] = result
    })
    return cloneGroupSettings(result)
  }

  getWarning(groupId: string, userId: string): WarningRecord {
    const record = this.data.warnings[groupId]?.[userId]
    return record ? { ...record, reasons: [...record.reasons] } : { count: 0, reasons: [], updatedAt: '' }
  }

  listWarnings(groupId: string): Array<{ userId: string; warning: WarningRecord }> {
    return Object.entries(this.data.warnings[groupId] ?? {})
      .map(([userId, warning]) => ({ userId, warning: { ...warning, reasons: [...warning.reasons] } }))
      .sort((left, right) => right.warning.count - left.warning.count || right.warning.updatedAt.localeCompare(left.warning.updatedAt))
  }

  async addWarning(groupId: string, userId: string, reason: string): Promise<WarningRecord> {
    let result: WarningRecord = { count: 0, reasons: [], updatedAt: '' }
    await this.mutate((data) => {
      data.warnings[groupId] ??= {}
      const current = data.warnings[groupId][userId] ?? { count: 0, reasons: [], updatedAt: '' }
      result = {
        count: current.count + 1,
        reasons: [...current.reasons.slice(-9), reason],
        updatedAt: new Date().toISOString(),
      }
      data.warnings[groupId][userId] = result
    })
    return { ...result, reasons: [...result.reasons] }
  }

  async removeWarning(groupId: string, userId: string): Promise<WarningRecord> {
    let result = this.getWarning(groupId, userId)
    await this.mutate((data) => {
      const current = data.warnings[groupId]?.[userId]
      if (!current) return
      result = {
        count: Math.max(0, current.count - 1),
        reasons: current.reasons.slice(0, -1),
        updatedAt: new Date().toISOString(),
      }
      if (result.count === 0) {
        delete data.warnings[groupId]?.[userId]
      } else if (data.warnings[groupId]) {
        data.warnings[groupId][userId] = result
      }
    })
    return { ...result, reasons: [...result.reasons] }
  }

  async clearWarnings(groupId: string, userId: string): Promise<void> {
    await this.mutate((data) => {
      delete data.warnings[groupId]?.[userId]
    })
  }

  getAutomation(): AutomationSettings {
    return cloneAutomation(this.data.automation)
  }

  async mutateAutomation(mutator: (settings: AutomationSettings) => void): Promise<AutomationSettings> {
    let result = this.getAutomation()
    await this.mutate((data) => {
      mutator(data.automation)
      result = cloneAutomation(data.automation)
    })
    return result
  }

  listDigitalProducts(includeInactive = false): DigitalProduct[] {
    return this.data.digitalProducts
      .filter((product) => includeInactive || product.active)
      .map(cloneDigitalProduct)
      .sort((left, right) => left.name.localeCompare(right.name, 'fr'))
  }

  getDigitalProduct(id: string): DigitalProduct | undefined {
    const normalized = id.trim().toLowerCase()
    const product = this.data.digitalProducts.find((entry) => entry.id === normalized)
    return product ? cloneDigitalProduct(product) : undefined
  }

  async upsertDigitalProduct(product: DigitalProduct): Promise<void> {
    await this.mutate((data) => {
      const index = data.digitalProducts.findIndex((entry) => entry.id === product.id)
      if (index >= 0) data.digitalProducts[index] = cloneDigitalProduct(product)
      else data.digitalProducts.push(cloneDigitalProduct(product))
    })
  }

  async setDigitalProductActive(id: string, active: boolean): Promise<boolean> {
    let changed = false
    await this.mutate((data) => {
      const product = data.digitalProducts.find((entry) => entry.id === id.trim().toLowerCase())
      if (!product) return
      product.active = active
      product.updatedAt = new Date().toISOString()
      changed = true
    })
    return changed
  }

  async removeDigitalProduct(id: string): Promise<boolean> {
    let removed = false
    await this.mutate((data) => {
      const before = data.digitalProducts.length
      data.digitalProducts = data.digitalProducts.filter((entry) => entry.id !== id.trim().toLowerCase())
      removed = data.digitalProducts.length < before
    })
    return removed
  }

  async markDigitalProductDelivered(id: string): Promise<void> {
    await this.mutate((data) => {
      const product = data.digitalProducts.find((entry) => entry.id === id.trim().toLowerCase())
      if (!product) return
      product.deliveredCount += 1
      product.updatedAt = new Date().toISOString()
    })
  }

  listSchedules(createdBy?: string): ScheduledJob[] {
    return this.data.schedules
      .filter((job) => !createdBy || job.createdBy === createdBy)
      .map((job) => ({ ...job }))
      .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt))
  }

  async addSchedule(job: ScheduledJob): Promise<void> {
    await this.mutate((data) => {
      data.schedules.push({ ...job })
    })
  }

  listTickets(filters: { createdBy?: string; status?: TicketStatus } = {}): SupportTicket[] {
    return this.data.tickets
      .filter((ticket) => (!filters.createdBy || ticket.createdBy === filters.createdBy) && (!filters.status || ticket.status === filters.status))
      .map(cloneTicket)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  getTicket(id: string): SupportTicket | undefined {
    const ticket = this.data.tickets.find((entry) => entry.id === id)
    return ticket ? cloneTicket(ticket) : undefined
  }

  async addTicket(ticket: SupportTicket): Promise<void> {
    await this.mutate((data) => {
      data.tickets.push(cloneTicket(ticket))
    })
  }

  async updateTicket(id: string, patch: Partial<Pick<SupportTicket, 'status' | 'priority' | 'subject'>>): Promise<SupportTicket | undefined> {
    let result: SupportTicket | undefined
    await this.mutate((data) => {
      const ticket = data.tickets.find((entry) => entry.id === id)
      if (!ticket) return
      if (patch.status) ticket.status = patch.status
      if (patch.priority) ticket.priority = patch.priority
      if (patch.subject) ticket.subject = patch.subject.slice(0, 500)
      ticket.updatedAt = new Date().toISOString()
      result = cloneTicket(ticket)
    })
    return result
  }

  listFinance(owner: string, month?: string): FinanceEntry[] {
    return this.data.finances
      .filter((entry) => entry.owner === owner && (!month || entry.createdAt.startsWith(month)))
      .map(cloneFinance)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async addFinance(entry: FinanceEntry): Promise<void> {
    await this.mutate((data) => {
      data.finances.push(cloneFinance(entry))
    })
  }

  async removeFinance(id: string, owner: string): Promise<boolean> {
    let removed = false
    await this.mutate((data) => {
      const before = data.finances.length
      data.finances = data.finances.filter((entry) => !(entry.id === id && entry.owner === owner))
      removed = data.finances.length < before
    })
    return removed
  }

  async clearFinance(owner: string): Promise<number> {
    let removed = 0
    await this.mutate((data) => {
      const before = data.finances.length
      data.finances = data.finances.filter((entry) => entry.owner !== owner)
      removed = before - data.finances.length
    })
    return removed
  }

  async cancelSchedule(id: string, requester: string, owner: boolean): Promise<boolean> {
    let cancelled = false
    await this.mutate((data) => {
      const job = data.schedules.find(
        (entry) => entry.id === id && (owner || entry.createdBy === requester) && entry.status === 'en_attente',
      )
      if (!job) return
      job.status = 'annule'
      cancelled = true
    })
    return cancelled
  }

  async claimDueSchedules(now = new Date()): Promise<ScheduledJob[]> {
    const claimed: ScheduledJob[] = []
    await this.mutate((data) => {
      for (const job of data.schedules) {
        if (job.status !== 'en_attente' || Date.parse(job.nextRunAt) > now.getTime()) continue
        job.status = 'en_cours'
        job.claimedAt = now.toISOString()
        claimed.push({ ...job })
      }
    })
    return claimed
  }

  async finishSchedule(id: string, success: boolean, errorMessage = ''): Promise<void> {
    await this.mutate((data) => {
      const job = data.schedules.find((entry) => entry.id === id)
      if (!job) return
      if (success && job.repeat === 'quotidien') {
        const next = new Date(job.nextRunAt)
        next.setDate(next.getDate() + 1)
        while (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
        job.nextRunAt = next.toISOString()
        job.status = 'en_attente'
      } else {
        job.status = success ? 'envoye' : 'echec'
      }
      job.claimedAt = null
      job.lastError = success ? null : errorMessage.slice(0, 500)
    })
  }

  exportJson(): string {
    return `${JSON.stringify(this.data, null, 2)}\n`
  }

  async cleanupFinishedSchedules(): Promise<number> {
    let removed = 0
    await this.mutate((data) => {
      const before = data.schedules.length
      data.schedules = data.schedules.filter((job) => ['en_attente', 'en_cours'].includes(job.status))
      removed = before - data.schedules.length
    })
    return removed
  }

  private async mutate(mutator: (data: DatabaseSchema) => void): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      mutator(this.data)
      await this.persist()
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }
}

export { DEFAULT_AUTOMATION, DEFAULT_GROUP_SETTINGS }
