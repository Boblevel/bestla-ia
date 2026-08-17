import { randomUUID } from 'node:crypto'
import type { BotCommand, CommandContext } from '../types.js'
import type { DigitalProduct, SupportTicket } from '../core/database.js'
import { signText } from '../utils/brand.js'
import { normalizeUserJid, phoneToJid, sameUser } from '../utils/jid.js'
import { mentionedJids } from '../utils/message.js'

const PRODUCT_ID = /^[a-z0-9][a-z0-9_-]{1,31}$/

function shortId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 8)
}

function productLine(product: DigitalProduct, owner = false): string {
  const state = product.active ? '✅' : '⛔'
  const stats = owner ? ` • livraisons ${product.deliveredCount}` : ''
  return `${state} *${product.name}* (#${product.id})${stats}\n↳ ${product.description || 'Produit numérique'}`
}

function deliveryTarget(ctx: CommandContext): string | undefined {
  const mentioned = mentionedJids(ctx.message)[0]
  if (mentioned) return normalizeUserJid(mentioned)
  const quoted = ctx.quotedMessage()
  const quotedTarget = quoted?.key.participant ?? quoted?.key.remoteJid
  if (quotedTarget && !sameUser(quotedTarget, ctx.sock.user?.id)) return normalizeUserJid(quotedTarget)
  const number = ctx.args[1]
  if (number) return phoneToJid(number)
  if (!ctx.isGroup && !sameUser(ctx.chatId, ctx.sock.user?.id)) return normalizeUserJid(ctx.chatId)
  return undefined
}

export const commerceCommands: BotCommand[] = [
  {
    name: 'produitsnumeriques',
    aliases: ['boutiquenumerique', 'cataloguenumerique'],
    description: 'Affiche les produits numériques disponibles.',
    category: 'Entreprise',
    cooldownSeconds: 5,
    async execute(ctx) {
      const products = ctx.db.listDigitalProducts(false)
      if (!products.length) return void (await ctx.reply('Aucun produit numérique n’est disponible pour le moment.'))
      await ctx.reply(
        `*PRODUITS NUMÉRIQUES*\n\n${products.map((product) => productLine(product)).join('\n\n')}\n\nPour commander : ${ctx.prefix}acheternumerique identifiant`,
      )
    },
  },
  {
    name: 'acheternumerique',
    aliases: ['commandernumerique'],
    description: 'Ouvre une demande pour acheter un produit numérique.',
    usage: '<identifiant>',
    category: 'Entreprise',
    cooldownSeconds: 10,
    async execute(ctx) {
      if (ctx.isGroup) return void (await ctx.reply('Pour protéger tes informations, passe la commande en conversation privée avec le bot.'))
      const product = ctx.db.getDigitalProduct(ctx.args[0] ?? '')
      if (!product || !product.active) return void (await ctx.reply(`Produit introuvable. Tape ${ctx.prefix}produitsnumeriques.`))
      const now = new Date().toISOString()
      const ticket: SupportTicket = {
        id: `pd${shortId()}`,
        sessionName: ctx.sessionName,
        chatId: ctx.chatId,
        createdBy: ctx.sender,
        subject: `Commande numérique #${product.id} — ${product.name}`,
        status: 'ouvert',
        priority: 'haute',
        createdAt: now,
        updatedAt: now,
      }
      await ctx.db.addTicket(ticket)
      const payment = ctx.db.getAutomation().business.paiement
      await ctx.reply(
        `🛒 Demande *#${ticket.id}* créée pour *${product.name}*.\n\n${payment ? `Paiement : ${payment}\n\n` : ''}Après vérification du paiement, le propriétaire pourra livrer le produit directement dans cette conversation.`,
      )
    },
  },
  {
    name: 'produitnumerique',
    aliases: ['gerernumerique'],
    description: 'Ajoute, active, désactive ou retire un produit numérique.',
    usage: 'ajouter|liste|activer|desactiver|retirer',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'liste' || action === 'statut') {
        const products = ctx.db.listDigitalProducts(true)
        return void (await ctx.reply(products.length ? `*PRODUITS NUMÉRIQUES*\n\n${products.map((product) => productLine(product, true)).join('\n\n')}` : 'Aucun produit numérique enregistré.'))
      }
      if (action === 'ajouter') {
        const raw = ctx.args.slice(1).join(' ')
        const parts = raw.split('|').map((part) => part.trim())
        const [rawId = '', name = '', description = '', deliveryText = ''] = parts
        const id = rawId.toLowerCase()
        if (!PRODUCT_ID.test(id) || !name || !deliveryText) {
          return void (await ctx.reply(
            `Utilisation : ${ctx.prefix}produitnumerique ajouter pack1 | Pack Premium | Description publique | Lien/code/texte privé de livraison`,
          ))
        }
        const existing = ctx.db.getDigitalProduct(id)
        const now = new Date().toISOString()
        await ctx.db.upsertDigitalProduct({
          id,
          name: name.slice(0, 120),
          description: description.slice(0, 800),
          deliveryText: deliveryText.slice(0, 8_000),
          active: existing?.active ?? true,
          deliveredCount: existing?.deliveredCount ?? 0,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        return void (await ctx.reply(`Produit *#${id}* enregistré et ${existing?.active === false ? 'désactivé' : 'actif'}.`))
      }
      if (action === 'activer' || action === 'desactiver') {
        const id = (ctx.args[1] ?? '').toLowerCase()
        const changed = id ? await ctx.db.setDigitalProductActive(id, action === 'activer') : false
        return void (await ctx.reply(changed ? `Produit *#${id}* ${action === 'activer' ? 'activé' : 'désactivé'}.` : 'Produit introuvable.'))
      }
      if (action === 'retirer') {
        const id = (ctx.args[1] ?? '').toLowerCase()
        const removed = id ? await ctx.db.removeDigitalProduct(id) : false
        return void (await ctx.reply(removed ? `Produit *#${id}* retiré.` : 'Produit introuvable.'))
      }
      await ctx.reply(`Utilisation : ${ctx.prefix}produitnumerique ajouter|liste|activer|desactiver|retirer`)
    },
  },
  {
    name: 'livrernumerique',
    aliases: ['livrerproduit'],
    description: 'Livre le contenu privé d’un produit numérique à un client.',
    usage: '<id> [numéro] ou répondre au client',
    category: 'Propriétaire',
    ownerOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const product = ctx.db.getDigitalProduct(ctx.args[0] ?? '')
      if (!product) return void (await ctx.reply('Produit numérique introuvable.'))
      const target = deliveryTarget(ctx)
      if (!target) {
        return void (await ctx.reply(`Indique le client : ${ctx.prefix}livrernumerique ${product.id} 22670000000, mentionne-le, ou réponds à son message.`))
      }
      if (sameUser(target, ctx.sock.user?.id)) return void (await ctx.reply('La livraison ne peut pas viser le numéro du bot.'))
      await ctx.sock.sendMessage(target, {
        text: signText(
          `📦 *LIVRAISON NUMÉRIQUE*\n\nProduit : *${product.name}*\nRéférence : #${product.id}\n\n${product.deliveryText}\n\nMerci pour votre commande.`,
          ctx.config,
        ),
      })
      await ctx.db.markDigitalProductDelivered(product.id)
      await ctx.reply(`✅ Produit *${product.name}* livré au client.`)
    },
  },
]
