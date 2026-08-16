import { randomUUID } from 'node:crypto'
import type { FinanceEntryType } from '../core/database.js'
import type { BotCommand, CommandContext } from '../types.js'
import { brandedPanel } from '../utils/brand.js'

function francs(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value) + ' F CFA'
}

function privateOwner(ctx: CommandContext): boolean {
  return !ctx.isGroup && ctx.isOwner
}

function parseAmount(value: string | undefined): number | undefined {
  const normalized = (value ?? '').replace(/[\s.]/g, '').replace(',', '.')
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000_000 ? Math.round(amount) : undefined
}

function monthFrom(value: string | undefined): string | undefined {
  if (!value) return new Date().toISOString().slice(0, 7)
  return /^\d{4}-\d{2}$/.test(value) ? value : undefined
}

function splitNote(value: string): { category: string; note: string } {
  const parts = value.split('|').map((part) => part.trim()).filter(Boolean)
  return { category: (parts[0] ?? 'Divers').slice(0, 80), note: (parts[1] ?? '').slice(0, 300) }
}

function entryCommand(name: string, type: FinanceEntryType, label: string): BotCommand {
  return {
    name,
    description: `Enregistre un ${label.toLowerCase()} dans ton budget privé.`,
    usage: '<montant> | <catégorie> [| note]',
    category: 'Budget',
    ownerOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      if (!privateOwner(ctx)) return void (await ctx.reply('Pour protéger ton budget, utilise cette commande dans une conversation privée.'))
      const amount = parseAmount(ctx.args[0])
      const raw = ctx.args.slice(1).join(' ').trim()
      if (!amount || !raw) return void (await ctx.reply(`Utilisation : ${ctx.prefix}${name} 5000 | Vente | Client site web`))
      const { category, note } = splitNote(raw)
      const entry = {
        id: randomUUID().replaceAll('-', '').slice(0, 8),
        owner: ctx.sender,
        type,
        amount,
        category,
        note,
        createdAt: new Date().toISOString(),
      }
      await ctx.db.addFinance(entry)
      await ctx.reply(`${label} enregistré : *${francs(amount)}* • ${category}\nIdentifiant : *${entry.id}*`)
    },
  }
}

export const budgetCommands: BotCommand[] = [
  entryCommand('revenu', 'revenu', 'Revenu'),
  entryCommand('depense', 'depense', 'Dépense'),
  {
    name: 'budget',
    aliases: ['resumebudget'],
    description: 'Affiche le résumé des revenus et dépenses du mois.',
    usage: '[AAAA-MM]',
    category: 'Budget',
    ownerOnly: true,
    async execute(ctx) {
      if (!privateOwner(ctx)) return void (await ctx.reply('Pour protéger ton budget, utilise cette commande dans une conversation privée.'))
      const month = monthFrom(ctx.args[0])
      if (!month) return void (await ctx.reply(`Utilisation : ${ctx.prefix}budget 2026-08`))
      const entries = ctx.db.listFinance(ctx.sender, month)
      const revenue = entries.filter((entry) => entry.type === 'revenu').reduce((sum, entry) => sum + entry.amount, 0)
      const expense = entries.filter((entry) => entry.type === 'depense').reduce((sum, entry) => sum + entry.amount, 0)
      const balance = revenue - expense
      await ctx.reply(
        brandedPanel(
          `BUDGET ${month}`,
          [`Revenus : *${francs(revenue)}*`, `Dépenses : *${francs(expense)}*`, `Solde : *${francs(balance)}*`, `Opérations : ${entries.length}`],
          ctx.config,
        ),
      )
    },
  },
  {
    name: 'historiquebudget',
    aliases: ['operationsbudget'],
    description: 'Affiche les dernières opérations de budget privées.',
    usage: '[AAAA-MM]',
    category: 'Budget',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      if (!privateOwner(ctx)) return void (await ctx.reply('Pour protéger ton budget, utilise cette commande dans une conversation privée.'))
      const month = monthFrom(ctx.args[0])
      if (!month) return void (await ctx.reply(`Utilisation : ${ctx.prefix}historiquebudget 2026-08`))
      const entries = ctx.db.listFinance(ctx.sender, month).slice(0, 25)
      await ctx.reply(
        entries.length
          ? `*OPÉRATIONS ${month}*\n\n${entries.map((entry) => `${entry.type === 'revenu' ? '➕' : '➖'} *${francs(entry.amount)}* • ${entry.category}${entry.note ? ` — ${entry.note}` : ''}\n↳ \`${entry.id}\``).join('\n\n')}`
          : 'Aucune opération pour ce mois.',
      )
    },
  },
  {
    name: 'supprimerbudget',
    aliases: ['retirerbudget'],
    description: 'Supprime une opération de ton budget avec son identifiant.',
    usage: '<identifiant>',
    category: 'Budget',
    ownerOnly: true,
    async execute(ctx) {
      if (!privateOwner(ctx)) return void (await ctx.reply('Pour protéger ton budget, utilise cette commande dans une conversation privée.'))
      const id = ctx.args[0]
      if (!id) return void (await ctx.reply(`Utilisation : ${ctx.prefix}supprimerbudget identifiant`))
      const removed = await ctx.db.removeFinance(id, ctx.sender)
      await ctx.reply(removed ? 'Opération supprimée.' : 'Identifiant introuvable.')
    },
  },
  {
    name: 'effacerbudget',
    description: 'Efface toutes les opérations de ton budget après confirmation.',
    usage: 'confirmer',
    category: 'Budget',
    ownerOnly: true,
    cooldownSeconds: 15,
    async execute(ctx) {
      if (!privateOwner(ctx)) return void (await ctx.reply('Pour protéger ton budget, utilise cette commande dans une conversation privée.'))
      if (ctx.args[0]?.toLowerCase() !== 'confirmer') {
        return void (await ctx.reply(`Cette action est définitive. Confirme avec ${ctx.prefix}effacerbudget confirmer`))
      }
      const removed = await ctx.db.clearFinance(ctx.sender)
      await ctx.reply(`${removed} opération(s) supprimée(s).`)
    },
  },
]
