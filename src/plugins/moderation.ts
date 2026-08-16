import type { GroupSettings } from '../core/database.js'
import type { BotCommand, CommandContext } from '../types.js'
import { jidToMention, sameUser } from '../utils/jid.js'
import { normalizeWords } from '../utils/text.js'

type BooleanGroupSetting = 'antilink' | 'antispam' | 'welcome' | 'goodbye'

function toggleCommand(
  name: string,
  setting: BooleanGroupSetting,
  label: string,
  aliases: string[] = [],
): BotCommand {
  return {
    name,
    aliases,
    description: `Active ou désactive ${label}.`,
    usage: 'activer|desactiver',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const value = ctx.args[0]?.toLowerCase()
      if (!['activer', 'desactiver'].includes(value ?? '')) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}${name} activer|desactiver`))
      }
      await ctx.db.updateGroup(ctx.chatId, { [setting]: value === 'activer' })
      await ctx.reply(`${label} : *${value === 'activer' ? 'activé' : 'désactivé'}*.`)
    },
  }
}

async function targetOrExplain(ctx: CommandContext): Promise<string | undefined> {
  const target = ctx.targetUser()
  if (!target) await ctx.reply('Mentionne une personne ou réponds à son message.')
  return target
}

function normalizeDomain(value: string): string | undefined {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  return candidate && /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(candidate) ? candidate : undefined
}

function domainFromLink(value: string): string | undefined {
  const candidate = value.trim()
  if (!candidate) return undefined
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`)
    return url.hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function isDomainAllowed(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
}

function templateCommand(
  name: string,
  field: 'welcomeMessage' | 'goodbyeMessage',
  label: string,
  example: string,
): BotCommand {
  return {
    name,
    description: `Personnalise le ${label}.`,
    usage: 'definir <texte>|voir|reinitialiser',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getGroup(ctx.chatId)
      if (action === 'voir') {
        await ctx.reply(settings[field] || `Modèle par défaut : ${example}`)
        return
      }
      if (action === 'reinitialiser') {
        await ctx.db.updateGroup(ctx.chatId, { [field]: '' })
        await ctx.reply(`${label} réinitialisé.`)
        return
      }
      if (action !== 'definir' || ctx.args.length < 2) {
        await ctx.reply(`Utilisation : ${ctx.prefix}${name} definir Bienvenue {nom} dans {groupe}`)
        return
      }
      const text = ctx.args.slice(1).join(' ').slice(0, 1_000)
      await ctx.db.updateGroup(ctx.chatId, { [field]: text })
      await ctx.reply(`${label} enregistré. Variables : {nom}, {groupe}, {nombre}.`)
    },
  }
}

export const moderationCommands: BotCommand[] = [
  toggleCommand('antilien', 'antilink', 'Anti-lien', ['protectionliens']),
  toggleCommand('antispam', 'antispam', 'Anti-spam'),
  toggleCommand('bienvenue', 'welcome', 'Message de bienvenue'),
  toggleCommand('aurevoir', 'goodbye', 'Message de départ'),
  {
    name: 'protection',
    description: 'Active ou désactive en une fois l’anti-lien et l’anti-spam.',
    usage: 'activer|desactiver',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (!['activer', 'desactiver'].includes(action ?? '')) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}protection activer|desactiver`))
      }
      const enabled = action === 'activer'
      await ctx.db.updateGroup(ctx.chatId, { antilink: enabled, antispam: enabled })
      await ctx.reply(`Protection renforcée : *${enabled ? 'activée' : 'désactivée'}*.`)
    },
  },
  {
    name: 'reglages',
    aliases: ['configurationgroupe'],
    description: 'Affiche les réglages de modération du groupe.',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const settings = ctx.db.getGroup(ctx.chatId)
      const state = (value: boolean) => (value ? '✅ ACTIVÉ' : '❌ DÉSACTIVÉ')
      await ctx.reply(
        `*RÉGLAGES DU GROUPE*\n\nAnti-lien : ${state(settings.antilink)}\nAnti-spam : ${state(settings.antispam)}\nBienvenue : ${state(settings.welcome)}\nDépart : ${state(settings.goodbye)}\nMots interdits : ${settings.badwords.length}\nDomaines autorisés : ${settings.allowedDomains.length}\nLimite d’avertissements : ${ctx.config.warnLimit}`,
      )
    },
  },
  {
    name: 'motinterdit',
    aliases: ['motsinterdits'],
    description: 'Gère la liste des mots interdits.',
    usage: 'ajouter|retirer|liste|vider [mot]',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getGroup(ctx.chatId)
      if (action === 'liste') {
        await ctx.reply(settings.badwords.length ? `Mots interdits : ${settings.badwords.join(', ')}` : 'La liste est vide.')
        return
      }
      if (action === 'vider') {
        await ctx.db.updateGroup(ctx.chatId, { badwords: [] })
        await ctx.reply('Liste des mots interdits vidée.')
        return
      }
      const word = normalizeWords(ctx.args.slice(1).join(' '))[0]
      if (!word || !['ajouter', 'retirer'].includes(action ?? '')) {
        await ctx.reply(`Utilisation : ${ctx.prefix}motinterdit ajouter|retirer|liste|vider [mot]`)
        return
      }
      const words = new Set(settings.badwords)
      if (action === 'ajouter') words.add(word)
      if (action === 'retirer') words.delete(word)
      await ctx.db.updateGroup(ctx.chatId, { badwords: [...words].sort() })
      await ctx.reply(`Mot *${word}* ${action === 'ajouter' ? 'ajouté' : 'retiré'}.`)
    },
  },
  {
    name: 'domainesautorises',
    aliases: ['exceptionsliens'],
    description: 'Gère les domaines ignorés par l’anti-lien.',
    usage: 'ajouter|retirer|liste|vider [domaine]',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getGroup(ctx.chatId)
      if (action === 'liste') {
        await ctx.reply(
          settings.allowedDomains.length
            ? `Domaines autorisés : ${settings.allowedDomains.join(', ')}`
            : 'Aucun domaine n’est autorisé.',
        )
        return
      }
      if (action === 'vider') {
        await ctx.db.updateGroup(ctx.chatId, { allowedDomains: [] })
        await ctx.reply('Liste des domaines autorisés vidée.')
        return
      }
      const domain = normalizeDomain(ctx.args[1] ?? '')
      if (!domain || !['ajouter', 'retirer'].includes(action ?? '')) {
        await ctx.reply(`Utilisation : ${ctx.prefix}domainesautorises ajouter exemple.com`)
        return
      }
      const domains = new Set(settings.allowedDomains)
      if (action === 'ajouter') domains.add(domain)
      if (action === 'retirer') domains.delete(domain)
      await ctx.db.updateGroup(ctx.chatId, { allowedDomains: [...domains].sort() })
      await ctx.reply(`Domaine *${domain}* ${action === 'ajouter' ? 'autorisé' : 'retiré'}.`)
    },
  },
  templateCommand(
    'messagebienvenue',
    'welcomeMessage',
    'message de bienvenue',
    'Bienvenue {nom} dans {groupe} !',
  ),
  templateCommand('messagedepart', 'goodbyeMessage', 'message de départ', 'Au revoir {nom}.'),
  {
    name: 'avertir',
    description: 'Ajoute un avertissement à un membre.',
    usage: '@personne [raison]',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const target = await targetOrExplain(ctx)
      if (!target) return
      const reason = ctx.argText.replace(/@?\d{7,15}/, '').trim() || 'aucune raison précisée'
      const warning = await ctx.db.addWarning(ctx.chatId, target, reason)
      const mention = jidToMention(target)
      await ctx.reply(
        `${mention} reçoit un avertissement : ${reason}. Total ${warning.count}/${ctx.config.warnLimit}.`,
        [target],
      )
      if (warning.count >= ctx.config.warnLimit && ctx.isBotAdmin) {
        await ctx.sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove')
        await ctx.db.clearWarnings(ctx.chatId, target)
      }
    },
  },
  {
    name: 'retireravertissement',
    description: 'Retire un avertissement à un membre.',
    usage: '@personne',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const target = await targetOrExplain(ctx)
      if (!target) return
      const warning = await ctx.db.removeWarning(ctx.chatId, target)
      await ctx.reply(`${jidToMention(target)} possède maintenant ${warning.count} avertissement(s).`, [target])
    },
  },
  {
    name: 'avertissements',
    description: 'Affiche les avertissements d’un membre.',
    usage: '[@personne]',
    category: 'Modération',
    groupOnly: true,
    async execute(ctx) {
      const target = ctx.targetUser() ?? ctx.sender
      const warning = ctx.db.getWarning(ctx.chatId, target)
      const reasons = warning.reasons.length ? `\nRaisons :\n- ${warning.reasons.join('\n- ')}` : ''
      await ctx.reply(
        `${jidToMention(target)} : ${warning.count}/${ctx.config.warnLimit} avertissement(s).${reasons}`,
        [target],
      )
    },
  },
  {
    name: 'effaceravertissements',
    description: 'Efface les avertissements d’un membre.',
    usage: '@personne',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    async execute(ctx) {
      const target = await targetOrExplain(ctx)
      if (!target) return
      await ctx.db.clearWarnings(ctx.chatId, target)
      await ctx.reply(`Avertissements effacés pour ${jidToMention(target)}.`, [target])
    },
  },
  {
    name: 'verifierlien',
    aliases: ['testerlien'],
    description: 'Vérifie si un domaine serait accepté par l’anti-lien du groupe.',
    usage: '<lien ou domaine>',
    category: 'Modération',
    groupOnly: true,
    async execute(ctx) {
      const domain = domainFromLink(ctx.argText)
      if (!domain) return void (await ctx.reply(`Utilisation : ${ctx.prefix}verifierlien https://exemple.com`))
      const settings = ctx.db.getGroup(ctx.chatId)
      if (!settings.antilink) {
        return void (await ctx.reply(`Le domaine *${domain}* est accepté : l’anti-lien est actuellement désactivé.`))
      }
      const allowed = isDomainAllowed(domain, settings.allowedDomains)
      await ctx.reply(
        allowed
          ? `✅ Le domaine *${domain}* est autorisé par la liste d’exceptions.`
          : `⛔ Le domaine *${domain}* serait bloqué par l’anti-lien. Un admin peut l’autoriser avec ${ctx.prefix}domainesautorises ajouter ${domain}.`,
      )
    },
  },
  {
    name: 'effacermessage',
    aliases: ['supprimermessage'],
    description: 'Supprime le message auquel tu réponds.',
    usage: '(en réponse à un message)',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const target = ctx.quotedMessage()
      if (!target?.key?.id) return void (await ctx.reply('Réponds au message à supprimer avec cette commande.'))
      await ctx.sock.sendMessage(ctx.chatId, { delete: target.key })
      await ctx.react('🗑️')
    },
  },
  {
    name: 'listeavertissements',
    aliases: ['listeavertissement'],
    description: 'Affiche les membres ayant des avertissements actifs.',
    category: 'Modération',
    groupOnly: true,
    adminOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const entries = ctx.db.listWarnings(ctx.chatId).slice(0, 50)
      if (!entries.length) return void (await ctx.reply('Aucun avertissement actif dans ce groupe.'))
      const users = entries.map((entry) => entry.userId)
      await ctx.reply(
        `*AVERTISSEMENTS ACTIFS*\n\n${entries
          .map((entry) => `${jidToMention(entry.userId)} : *${entry.warning.count}/${ctx.config.warnLimit}*`)
          .join('\n')}`,
        users,
      )
    },
  },
  {
    name: 'verifiermembre',
    aliases: ['infomembre'],
    description: 'Affiche le rôle et les avertissements d’un membre.',
    usage: '[@personne]',
    category: 'Modération',
    groupOnly: true,
    async execute(ctx) {
      const target = ctx.targetUser() ?? ctx.sender
      const participant = ctx.groupMetadata?.participants.find((member) => sameUser(member.id, target))
      const warning = ctx.db.getWarning(ctx.chatId, target)
      await ctx.reply(
        `${jidToMention(target)}\nRôle : *${participant?.admin ? 'administrateur' : participant ? 'membre' : 'hors du groupe'}*\nAvertissements : *${warning.count}/${ctx.config.warnLimit}*${warning.reasons.length ? `\nDernière raison : ${warning.reasons.at(-1)}` : ''}`,
        [target],
      )
    },
  },
]
