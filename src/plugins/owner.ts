import { freemem, hostname, loadavg, platform, release, totalmem } from 'node:os'
import type { BotCommand } from '../types.js'
import { brandedPanel } from '../utils/brand.js'
import { jidToMention, sameUser } from '../utils/jid.js'
import { formatDuration } from '../utils/text.js'
import { APP_VERSION } from '../version.js'

function megabytes(value: number): string {
  return `${(value / 1_024 / 1_024).toFixed(1)} Mo`
}

async function privateTarget(ctx: Parameters<BotCommand['execute']>[0]): Promise<string | undefined> {
  if (ctx.isGroup) {
    await ctx.reply('Pour éviter une action accidentelle dans un groupe, utilise cette commande dans une conversation privée.')
    return undefined
  }
  const target = ctx.targetUser()
  if (!target) {
    await ctx.reply('Réponds au message du contact ou indique son numéro international sans le signe +.')
    return undefined
  }
  if (sameUser(target, ctx.sock.user?.id)) {
    await ctx.reply('Cette action ne peut pas viser le numéro du bot.')
    return undefined
  }
  return target
}

export const ownerCommands: BotCommand[] = [
  {
    name: 'mode',
    description: 'Passe le bot en mode public ou privé.',
    usage: 'public|prive',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const mode = ctx.args[0]?.toLowerCase()
      if (!['public', 'prive'].includes(mode ?? '')) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}mode public|prive`))
      }
      const publicMode = mode === 'public'
      await ctx.db.setPublicMode(publicMode)
      await ctx.reply(`Mode *${publicMode ? 'public' : 'privé'}* activé.`)
    },
  },
  {
    name: 'prefixe',
    aliases: ['changerprefixe'],
    description: 'Change le préfixe des commandes.',
    usage: '<1 à 4 caractères>',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const requested = ctx.args[0]
      if (!requested || requested.toLowerCase() === 'statut') {
        return void (await ctx.reply(`Préfixe actuel : *${ctx.prefix}*
Pour changer : ${ctx.prefix}prefixe !`))
      }
      if (requested.toLowerCase() === 'reinitialiser') {
        await ctx.db.setPrefix(ctx.config.prefix)
        return void (await ctx.reply(`Préfixe réinitialisé à la valeur du serveur : *${ctx.config.prefix}*`))
      }
      if (requested.length > 4 || /\s/.test(requested)) {
        return void (await ctx.reply('Le préfixe doit contenir entre 1 et 4 caractères, sans espace.'))
      }
      await ctx.db.setPrefix(requested)
      await ctx.reply(`Nouveau préfixe : *${requested}*`)
    },
  },
  {
    name: 'commande',
    aliases: ['gerercommande', 'commandeswitch'],
    description: 'Active, désactive ou affiche l’état d’une commande.',
    usage: 'activer|desactiver|statut|liste <commande>',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'liste') {
        const disabled = ctx.db.listDisabledCommands()
        return void (await ctx.reply(disabled.length ? `*COMMANDES DÉSACTIVÉES*
${disabled.map((name) => `• ${ctx.prefix}${name}`).join('\n')}` : 'Toutes les commandes sont activées.'))
      }
      if (action === 'activer' && ctx.args[1]?.toLowerCase() === 'tout') {
        for (const name of ctx.db.listDisabledCommands()) await ctx.db.setCommandEnabled(name, true)
        return void (await ctx.reply('Toutes les commandes désactivées ont été réactivées.'))
      }
      const requestedName = ctx.args[1]?.toLowerCase()
      const command = requestedName ? ctx.registry.get(requestedName) : undefined
      if (!command || !['activer', 'desactiver', 'statut'].includes(action ?? '')) {
        return void (await ctx.reply(`Utilisation :
${ctx.prefix}commande statut assistant
${ctx.prefix}commande desactiver generervideo
${ctx.prefix}commande activer generervideo
${ctx.prefix}commande liste`))
      }
      if (action === 'statut') {
        return void (await ctx.reply(`${ctx.prefix}${command.name} : *${ctx.db.isCommandEnabled(command.name) ? 'activée' : 'désactivée'}*`))
      }
      if (command.name === 'commande' && action === 'desactiver') {
        return void (await ctx.reply('La commande de contrôle « commande » reste toujours active pour éviter de perdre l’accès aux réactivations.'))
      }
      const enabled = action === 'activer'
      await ctx.db.setCommandEnabled(command.name, enabled)
      await ctx.reply(`${ctx.prefix}${command.name} *${enabled ? 'activée' : 'désactivée'}*.`)
    },
  },
  {
    name: 'quitter',
    description: 'Quitte le groupe.',
    category: 'Propriétaire',
    ownerOnly: true,
    groupOnly: true,
    async execute(ctx) {
      await ctx.reply('Je quitte le groupe. Au revoir 👋')
      await ctx.sock.groupLeave(ctx.chatId)
    },
  },
  {
    name: 'sauvegarde',
    aliases: ['exporterreglages'],
    description: 'Exporte les réglages et automatisations, sans les clés WhatsApp.',
    category: 'Propriétaire',
    ownerOnly: true,
    cooldownSeconds: 30,
    async execute(ctx) {
      const document = Buffer.from(ctx.db.exportJson(), 'utf8')
      await ctx.send({
        document,
        mimetype: 'application/json',
        fileName: `sauvegarde-bestla-${new Date().toISOString().slice(0, 10)}.json`,
        caption: 'Sauvegarde privée. Conserve ce fichier en lieu sûr.',
      })
    },
  },
  {
    name: 'nettoyerprogrammes',
    description: 'Efface les anciens messages programmés terminés, échoués ou annulés.',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const removed = await ctx.db.cleanupFinishedSchedules()
      await ctx.reply(`${removed} ancien(s) programme(s) supprimé(s).`)
    },
  },
  {
    name: 'etatserveur',
    aliases: ['sante'],
    description: 'Affiche l’état technique du service et du serveur.',
    category: 'Propriétaire',
    ownerOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const memory = process.memoryUsage()
      const usedSystemMemory = totalmem() - freemem()
      await ctx.reply(
        brandedPanel(
          'ÉTAT TECHNIQUE',
          [
            `Version : *${APP_VERSION}*`,
            `Session actuelle : ${ctx.sessionName}`,
            `Compte WhatsApp : ${ctx.sock.user?.id ?? 'en attente'}`,
            `Durée : ${formatDuration(process.uptime())}`,
            `Node.js : ${process.version}`,
            `Serveur : ${hostname()} • ${platform()} ${release()}`,
            `Mémoire bot : ${megabytes(memory.rss)} RSS`,
            `Mémoire serveur : ${megabytes(usedSystemMemory)} / ${megabytes(totalmem())}`,
            `Charge (1 min) : ${loadavg()[0]?.toFixed(2) ?? 'indisponible'}`,
            `Commandes : ${ctx.registry.list().length}`,
          ],
          ctx.config,
        ),
      )
    },
  },
  {
    name: 'redemarrerbot',
    aliases: ['relancerbot'],
    description: 'Redémarre le service via PM2 après confirmation.',
    usage: 'confirmer',
    category: 'Propriétaire',
    ownerOnly: true,
    cooldownSeconds: 15,
    async execute(ctx) {
      if (ctx.args[0]?.toLowerCase() !== 'confirmer') {
        return void (await ctx.reply(`Cette action coupe brièvement le bot. Pour confirmer : ${ctx.prefix}redemarrerbot confirmer`))
      }
      if (!process.env.pm_id) {
        return void (await ctx.reply('PM2 n’est pas détecté. Lance plutôt depuis le VPS : pm2 restart bestla-ia-bot'))
      }
      await ctx.reply('♻️ Redémarrage demandé. Le service revient dans quelques secondes.')
      const timer = setTimeout(() => process.exit(0), 800)
      timer.unref()
    },
  },
  {
    name: 'bloquercontact',
    aliases: ['bloquer'],
    description: 'Bloque un contact WhatsApp depuis une conversation privée.',
    usage: '@personne ou numéro',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const target = await privateTarget(ctx)
      if (!target) return
      await ctx.sock.updateBlockStatus(target, 'block')
      await ctx.reply(`Contact ${jidToMention(target)} bloqué.`, [target])
    },
  },
  {
    name: 'debloquercontact',
    aliases: ['debloquer'],
    description: 'Débloque un contact WhatsApp depuis une conversation privée.',
    usage: '@personne ou numéro',
    category: 'Propriétaire',
    ownerOnly: true,
    async execute(ctx) {
      const target = await privateTarget(ctx)
      if (!target) return
      await ctx.sock.updateBlockStatus(target, 'unblock')
      await ctx.reply(`Contact ${jidToMention(target)} débloqué.`, [target])
    },
  },
  {
    name: 'listeblocages',
    aliases: ['contactsbloques'],
    description: 'Affiche les contacts bloqués par le compte WhatsApp.',
    category: 'Propriétaire',
    ownerOnly: true,
    cooldownSeconds: 10,
    async execute(ctx) {
      if (ctx.isGroup) return void (await ctx.reply('Pour ta confidentialité, consulte cette liste dans une conversation privée.'))
      const blocked = (await ctx.sock.fetchBlocklist()).filter((jid): jid is string => Boolean(jid)).slice(0, 100)
      await ctx.reply(
        blocked.length ? `*CONTACTS BLOQUÉS (${blocked.length})*\n\n${blocked.map(jidToMention).join('\n')}` : 'Aucun contact bloqué.',
        blocked,
      )
    },
  },
]
