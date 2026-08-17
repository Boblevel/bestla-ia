import { randomUUID } from 'node:crypto'
import type { WAMessageKey } from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import { normalizeWords } from '../utils/text.js'
import { AiService, AiServiceError } from './ai.js'
import type { AutomationScope, AutomationSettings, JsonDatabase, SupportTicket } from './database.js'

interface AutomationInput {
  sessionName: string
  chatId: string
  sender: string
  body: string
  isGroup: boolean
  messageKey: WAMessageKey
  reply(text: string): Promise<unknown>
  react(emoji: string): Promise<unknown>
}

const AI_TICKET_PREFIX = '[IA]'
const AI_DECISION_PATTERN = /(?:^|\n)\s*(?:[*_`>#-]+\s*)?DECISION\s*:\s*(TRANSFERER|REPONDRE)\s*(?:[*_`]*)\s*$/i
const DANGLING_DECISION_PATTERN = /(?:^|\n)\s*(?:[*_`>#-]+\s*)?DECISION\s*:?[\s*_`#-]*$/i
const EMOJI_TEST_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u
const EMOJI_STRIP_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D]/gu

interface ConversationTurn {
  role: 'client' | 'owner'
  text: string
  at: number
}

interface QuickHumanReply {
  handled: boolean
  text?: string
}

const CONVERSATION_MEMORY_TTL_MS = 6 * 60 * 60_000
const CONVERSATION_MEMORY_MAX_TURNS = 6
const ASSISTANTAUTO_FAST_MODEL = 'gemini-3.5-flash-lite'

function stripInternalMarkers(value: string): string {
  return value
    .replace(AI_DECISION_PATTERN, '')
    .replace(DANGLING_DECISION_PATTERN, '')
    .replace(/(?:^|\n)\s*(?:\[\[|<)?BESTLA[_ -]?HANDOFF\s*[:=]\s*(?:OUI|NON|YES|NO|TRUE|FALSE)?(?:\]\]|>)?\s*$/gi, '')
    .trim()
}

export function messageHasEmoji(value: string): boolean {
  return EMOJI_TEST_PATTERN.test(value)
}

function removeEmojis(value: string): string {
  return value
    .replace(EMOJI_STRIP_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim()
}

function keepAtMostOneEmoji(value: string): string {
  let kept = false
  return value.replace(EMOJI_STRIP_PATTERN, (token) => {
    if (/^[\uFE0F\u200D]$/u.test(token)) return kept ? token : ''
    if (kept) return ''
    kept = true
    return token
  }).replace(/[ \t]{2,}/g, ' ').trim()
}

export function sanitizeNaturalReply(value: string, conversationStarted: boolean, incomingHasEmoji = false): string {
  let text = stripInternalMarkers(value)
    .replace(/(?:^|\n)\s*✦\s*BY\s+[^\n]+/gi, '')
    .replace(/^\s*🤖?\s*\*?RÉPONSE IA\*?\s*[:—-]?\s*/i, '')
    .replace(/^\s*je suis\s+bestla\s*i?a?[^.!?]*[.!?]\s*/i, '')
    .replace(/\bBestla\s*iA\b/gi, '')
    .trim()

  if (conversationStarted) {
    text = text.replace(/^\s*(?:bonjour|bonsoir|salut|hello|coucou)\b[\s,!;:.—–-]*/i, '').trim()
  }

  text = incomingHasEmoji ? keepAtMostOneEmoji(text) : removeEmojis(text)
  text = stripInternalMarkers(text)
  return text || 'D’accord.'
}

function scopeMatches(scope: AutomationScope, isGroup: boolean): boolean {
  return scope === 'tous' || (scope === 'groupe' && isGroup) || (scope === 'prive' && !isGroup)
}

function normalizedSentence(value: string): string {
  return normalizeWords(value).join(' ')
}

function aiTicketForSender(db: JsonDatabase, sender: string): SupportTicket | undefined {
  return db
    .listTickets({ createdBy: sender, status: 'ouvert' })
    .find((ticket) => ticket.subject.startsWith(`${AI_TICKET_PREFIX} `))
}

export function customerMessageNeedsHuman(value: string): boolean {
  const text = normalizedSentence(value)
  if (!text) return false
  return [
    'devis', 'commander', 'commande', 'acheter', 'achat', 'reserver', 'reservation',
    'disponible', 'disponibilite', 'prix', 'tarif', 'livraison', 'livrer',
    'paiement', 'payer', 'remboursement', 'reclamation', 'responsable', 'humain',
    'parler a rhaff', 'rhaff', 'je veux parler', 'te parler', 'vous parler',
    'parler au proprietaire', 'parler au responsable', 'appeler', 'appel', 'joindre',
  ].some((keyword) => text.includes(keyword))
}

export function parseCustomerAiDecision(value: string): { text: string; handoff: boolean } {
  const match = value.match(AI_DECISION_PATTERN)
  const handoff = match?.[1]?.toUpperCase() === 'TRANSFERER'
  return { text: stripInternalMarkers(value), handoff }
}

function acknowledgementKind(value: string): 'thanks' | 'ack' | undefined {
  const words = normalizeWords(value)
  if (words.length === 0 || words.length > 8) return undefined

  const titles = new Set(['mr', 'mrs', 'monsieur', 'madame', 'frere', 'bro', 'chef'])
  const cleanWords = [...words]
  if (cleanWords.length > 1 && titles.has(cleanWords.at(-1) ?? '')) cleanWords.pop()
  const text = cleanWords.join(' ')

  const thanks = new Set(['merci', 'merci beaucoup', 'grand merci', 'merci bien'])
  if (thanks.has(text)) return 'thanks'

  const acknowledgements = new Set([
    'ok', 'okay', 'd accord', 'dac', 'ca marche', 'c est bon', 'entendu', 'bien recu',
    'nickel', 'parfait', 'super', 'top', 'cool', 'pas de souci', 'pas de soucis',
    'pas de probleme', 'ok pas de souci', 'ok pas de soucis', 'ok pas de probleme',
    'ok c est bon', 'ok ca marche', 'okay pas de souci', 'okay pas de soucis',
  ])
  return acknowledgements.has(text) ? 'ack' : undefined
}

/**
 * Les réactions emoji de l'assistant automatique ne sont utilisées que lorsque
 * le contact lui-même vient d'en utiliser une. Ainsi un simple "OK" reste sobre.
 */
export function acknowledgementReaction(value: string, conversationStarted: boolean): string | undefined {
  if (!conversationStarted || !messageHasEmoji(value)) return undefined
  const kind = acknowledgementKind(value)
  if (kind === 'thanks') return '🙏'
  if (kind === 'ack') return '👍'
  return undefined
}

function stablePick(values: readonly string[], key: string): string {
  let hash = 2166136261
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return values[Math.abs(hash) % values.length] ?? values[0] ?? ''
}

/** Réponses locales immédiates pour les petits échanges qui ne nécessitent aucun raisonnement. */
export function quickHumanReply(value: string, conversationStarted: boolean, stableKey = value): QuickHumanReply {
  const text = normalizedSentence(value)
  if (!text) return { handled: false }
  const incomingHasEmoji = messageHasEmoji(value)
  const kind = acknowledgementKind(value)

  if (conversationStarted && kind === 'ack') return { handled: true }
  if (conversationStarted && kind === 'thanks') {
    const reply = stablePick(['Avec plaisir.', 'Pas de souci.', 'Avec plaisir, vraiment.'], stableKey)
    return { handled: true, text: incomingHasEmoji ? `${reply} 🙏` : reply }
  }

  const greetings = new Set(['salut', 'slt', 'bonjour', 'bonsoir', 'coucou', 'hello', 'hey'])
  if (greetings.has(text)) {
    const base = text === 'bonsoir'
      ? stablePick(['Bonsoir, ça va ?', 'Bonsoir, tu vas bien ?'], stableKey)
      : text === 'bonjour'
        ? stablePick(['Bonjour, ça va ?', 'Bonjour, tu vas bien ?'], stableKey)
        : stablePick(['Salut, ça va ?', 'Salut, tu vas bien ?'], stableKey)
    return { handled: true, text: incomingHasEmoji ? `${base} 👋` : base }
  }

  const wellbeing = new Set(['ca va', 'ca va ?', 'tu vas bien', 'vous allez bien', 'comment ca va', 'comment tu vas'])
  if (wellbeing.has(text)) {
    const base = stablePick(['Ça va bien, et toi ?', 'Oui ça va tranquille, et toi ?', 'Ça va, et de ton côté ?'], stableKey)
    return { handled: true, text: incomingHasEmoji ? `${base} 🙂` : base }
  }

  if (['tu fais quoi', 'tu fais quoi ?', 'vous faites quoi', 't es la', 'tu es la'].includes(text)) {
    return { handled: true, text: stablePick(['Je suis là, dis-moi.', 'Je suis là, qu’est-ce qu’il y a ?'], stableKey) }
  }

  return { handled: false }
}

export function isOutsideBusinessHours(settings: AutomationSettings, date = new Date()): boolean {
  const hours = settings.businessHours
  if (!hours.enabled) return false
  if (!hours.days.includes(date.getDay())) return true
  const currentMinutes = date.getHours() * 60 + date.getMinutes()
  const [startHour = 0, startMinute = 0] = hours.start.split(':').map(Number)
  const [endHour = 0, endMinute = 0] = hours.end.split(':').map(Number)
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (start <= end) return currentMinutes < start || currentMinutes >= end
  return currentMinutes >= end && currentMinutes < start
}

export class AutomationService {
  private readonly cooldowns = new Map<string, number>()
  private readonly conversations = new Map<string, ConversationTurn[]>()

  constructor(
    private readonly db: JsonDatabase,
    private readonly config: AppConfig,
  ) {}

  async inspect(input: AutomationInput): Promise<boolean> {
    const settings = this.db.getAutomation()
    const normalizedBody = normalizedSentence(input.body)
    if (!normalizedBody) return false

    if (settings.autoReactionsEnabled) {
      const reaction = settings.reactions.find(
        (rule) => scopeMatches(rule.scope, input.isGroup) && normalizedBody.includes(rule.trigger),
      )
      if (reaction && this.consume(`reaction:${input.chatId}:${reaction.id}`, 60_000)) {
        await input.react(reaction.emoji)
      }
    }

    if (!input.isGroup && !settings.customerAi.enabled && isOutsideBusinessHours(settings)) {
      if (this.consume(`horaires:${input.sender}`, 12 * 60 * 60_000)) {
        await input.reply(settings.businessHours.message)
        return true
      }
    }

    if (!input.isGroup && !settings.customerAi.enabled && settings.away.enabled) {
      if (this.consume(`absence:${input.sender}`, 12 * 60 * 60_000)) {
        await input.reply(settings.away.message)
        return true
      }
    }

    if (settings.autoRepliesEnabled) {
      const rule = settings.autoReplies.find((entry) => {
        if (!scopeMatches(entry.scope, input.isGroup)) return false
        return entry.match === 'exact' ? normalizedBody === entry.trigger : normalizedBody.includes(entry.trigger)
      })
      if (rule && this.consume(`reponse:${input.chatId}:${rule.id}`, 30 * 60_000)) {
        await input.reply(rule.response)
        return true
      }
    }

    if (!input.isGroup && settings.customerAi.enabled) {
      const pending = aiTicketForSender(this.db, input.sender)
      const ai = new AiService(this.config)
      if (!ai.isConfigured()) return false

      const businessContext = Object.entries(settings.business)
        .filter(([, item]) => item.trim())
        .map(([key, item]) => `${key}: ${item}`)
        .join('\n')
      const conversationKey = `${input.sessionName}:${input.sender}`
      const recentTurns = this.recentConversation(conversationKey)
      const conversationStarted = recentTurns.some((turn) => turn.role === 'owner')
      const incomingHasEmoji = messageHasEmoji(input.body)

      const reaction = acknowledgementReaction(input.body, conversationStarted)
      if (reaction) {
        await input.react(reaction)
        this.rememberConversation(conversationKey, 'client', input.body)
        return true
      }

      // Les salutations, remerciements et petits messages sociaux partent immédiatement,
      // sans attendre un aller-retour réseau vers Gemini.
      const quick = quickHumanReply(input.body, conversationStarted, `${input.sender}:${input.body}`)
      if (quick.handled) {
        this.rememberConversation(conversationKey, 'client', input.body)
        if (quick.text) {
          const answer = sanitizeNaturalReply(quick.text, false, incomingHasEmoji)
          await input.reply(answer)
          this.rememberConversation(conversationKey, 'owner', answer)
        }
        return true
      }

      const recentConversation = recentTurns.length
        ? recentTurns.map((turn) => `${turn.role === 'client' ? 'Client' : 'Moi'}: ${turn.text}`).join('\n')
        : 'aucun échange récent'
      const emojiRule = incomingHasEmoji
        ? 'Le contact a utilisé un emoji. Tu peux en mettre au maximum un si cela sonne naturel, mais pas systématiquement.'
        : 'Le contact n’a utilisé aucun emoji : n’en mets aucun dans ta réponse.'
      const instruction = [
        settings.customerAi.instructions,
        'Écris directement le message WhatsApp à ma place.',
        'Voix : jeune adulte francophone ouest-africain de 23 ans, poli, urbain, naturel et posé. Français conversationnel propre, sans caricature, sans imitation d’accent et sans argot forcé.',
        'Adapte le tutoiement, le vouvoiement, la longueur et le sérieux uniquement à ce que le contact écrit. Ne suppose jamais son origine, âge, genre, religion ou statut social.',
        'Réponds le plus souvent en 1 ou 2 phrases courtes. Évite le ton service client et les formules automatiques du type « Comment puis-je vous aider ? », « C’est bien noté » ou « Je prends note ».',
        emojiRule,
        conversationStarted ? 'La conversation est déjà lancée : ne resalue pas.' : 'Salue seulement si le message reçu est lui-même une salutation.',
        'Ne dis jamais que tu es une IA, un bot, Bestla ou un assistant. Aucun titre, signature, marqueur interne ou mention de RHAFF SERVICE.',
        'N’invente aucune activité personnelle, position, prix, disponibilité, délai, adresse, garantie ou promesse. Si une information manque, dis-le simplement ou pose une courte question utile.',
        'Si le contact demande Rhaff ou le propriétaire, réponds naturellement comme si j’écrivais moi-même ; le signalement éventuel est géré en interne et ne doit jamais être mentionné.',
        businessContext ? `Infos publiques utilisables :\n${businessContext}` : 'Aucune information commerciale précise disponible : ne rien inventer.',
        pending ? 'Une demande de ce contact est déjà signalée en interne : n’en parle pas et poursuis normalement.' : '',
        `Échanges récents :\n${recentConversation}`,
        'Retourne uniquement le message final à envoyer, sans explication ni marqueur.',
      ].filter(Boolean).join('\n\n')

      try {
        const rawAnswer = await ai.complete(instruction, input.body, {
          model: ASSISTANTAUTO_FAST_MODEL,
          maxOutputTokens: 160,
          thinkingLevel: 'minimal',
          timeoutMs: 12_000,
          fallbackToConfiguredModel: true,
          replyInPromptLanguage: true,
        })
        const decision = parseCustomerAiDecision(rawAnswer)
        const answer = sanitizeNaturalReply(decision.text || 'D’accord.', conversationStarted, incomingHasEmoji)
        const handoff = decision.handoff || customerMessageNeedsHuman(input.body)

        this.rememberConversation(conversationKey, 'client', input.body)

        if (handoff && !pending) {
          const now = new Date().toISOString()
          const ticket: SupportTicket = {
            id: `tk${randomUUID().replaceAll('-', '').slice(0, 8)}`,
            sessionName: input.sessionName,
            chatId: input.chatId,
            createdBy: input.sender,
            subject: `${AI_TICKET_PREFIX} ${input.body.trim().slice(0, 450)}`,
            status: 'ouvert',
            priority: 'normale',
            createdAt: now,
            updatedAt: now,
          }
          await this.db.addTicket(ticket)
        }

        await input.reply(answer)
        this.rememberConversation(conversationKey, 'owner', answer)
        return true
      } catch (error) {
        if (!(error instanceof AiServiceError)) throw error
        return false
      }
    }

    return false
  }

  private recentConversation(key: string): ConversationTurn[] {
    const now = Date.now()
    const recent = (this.conversations.get(key) ?? []).filter((turn) => now - turn.at <= CONVERSATION_MEMORY_TTL_MS)
    if (recent.length) this.conversations.set(key, recent.slice(-CONVERSATION_MEMORY_MAX_TURNS))
    else this.conversations.delete(key)
    return recent.slice(-CONVERSATION_MEMORY_MAX_TURNS)
  }

  private rememberConversation(key: string, role: ConversationTurn['role'], text: string): void {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 1_500)
    if (!clean) return
    const turns = this.recentConversation(key)
    turns.push({ role, text: clean, at: Date.now() })
    this.conversations.set(key, turns.slice(-CONVERSATION_MEMORY_MAX_TURNS))
    if (this.conversations.size > 5_000) {
      const oldestKey = this.conversations.keys().next().value as string | undefined
      if (oldestKey) this.conversations.delete(oldestKey)
    }
  }

  private consume(key: string, durationMs: number): boolean {
    const now = Date.now()
    const expiresAt = this.cooldowns.get(key) ?? 0
    if (expiresAt > now) return false
    this.cooldowns.set(key, now + durationMs)
    if (this.cooldowns.size > 10_000) {
      for (const [entry, expiry] of this.cooldowns) {
        if (expiry <= now) this.cooldowns.delete(entry)
      }
    }
    return true
  }
}
