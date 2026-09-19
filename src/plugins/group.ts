import type { BotCommand, CommandContext } from '../types.js'
import { brandedPanel } from '../utils/brand.js'
import { jidToMention, phoneToJid, sameUser } from '../utils/jid.js'

async function requireTarget(ctx: CommandContext): Promise<string | undefined> {
  const target = ctx.targetUser()
  if (!target) {
    await ctx.reply('Mentionne une personne, réponds à son message ou indique son numéro international.')
    return undefined
  }
  return target
}

function participantCommand(
  name: string,
  action: 'remove' | 'promote' | 'demote',
  description: string,
  aliases: string[] = [],
): BotCommand {
  return {
    name,
    aliases,
    description,
    usage: '@personne',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const target = await requireTarget(ctx)
      if (!target) return
      await ctx.sock.groupParticipantsUpdate(ctx.chatId, [target], action)
      await ctx.reply(`Action *${name}* effectuée pour ${jidToMention(target)}.`, [target])
    },
  }
}

function pendingRequestJid(entry: Record<string, string>): string | undefined {
  return Object.values(entry).find((value) => /@(?:s\.whatsapp\.net|lid)$/i.test(value))
}

function groupInviteCode(rawLink: string): string | undefined {
  try {
    const parsed = new URL(rawLink.trim())
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'chat.whatsapp.com') return undefined
    const code = parsed.pathname.split('/').filter(Boolean)[0]?.trim()
    return code && /^[A-Za-z0-9_-]+$/.test(code) ? code : undefined
  } catch {
    return undefined
  }
}

export const groupCommands: BotCommand[] = [
  participantCommand('expulser', 'remove', 'Retire un membre du groupe.', ['retirer']),
  participantCommand('promouvoir', 'promote', 'Nomme un membre administrateur.'),
  participantCommand('retrograder', 'demote', 'Retire les droits administrateur.'),
  {
    name: 'ajouter',
    description: 'Ajoute un numéro au groupe.',
    usage: '22670000000',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const target = phoneToJid(ctx.args[0] ?? '')
      if (!target) return void (await ctx.reply('Indique un numéro international valide, sans le signe +.'))
      const result = await ctx.sock.groupParticipantsUpdate(ctx.chatId, [target], 'add')
      const status = result[0]?.status ?? 'inconnu'
      await ctx.reply(`Demande d’ajout envoyée pour ${jidToMention(target)} (statut : ${status}).`, [target])
    },
  },
  {
    name: 'mentionnertous',
    aliases: ['tous'],
    description: 'Mentionne tous les membres, par lots raisonnables.',
    usage: '[message]',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    cooldownSeconds: 30,
    async execute(ctx) {
      const participants = ctx.groupMetadata?.participants.map((participant) => participant.id) ?? []
      if (participants.length === 0) return void (await ctx.reply('Liste des membres indisponible.'))
      const title = ctx.argText || 'Annonce du groupe'
      for (let index = 0; index < participants.length; index += 50) {
        const batch = participants.slice(index, index + 50)
        await ctx.send({
          text: `📣 *${title}*\n\n${batch.map(jidToMention).join(' ')}`,
          mentions: batch,
        })
      }
    },
  },
  {
    name: 'mentioncachee',
    description: 'Mentionne discrètement tous les membres sans afficher la liste des @numéros.',
    usage: '[message]',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    cooldownSeconds: 20,
    async execute(ctx) {
      const participants = ctx.groupMetadata?.participants.map((participant) => participant.id) ?? []
      if (participants.length === 0) return void (await ctx.reply('Liste des membres indisponible.'))
      const text = ctx.argText.trim().slice(0, 2_000) || 'Notification du groupe'
      for (let index = 0; index < participants.length; index += 100) {
        const batch = participants.slice(index, index + 100)
        await ctx.send({
          text: index === 0 ? text : '\u200B',
          mentions: batch,
        })
      }
    },
  },
  {
    name: 'ouvrir',
    description: 'Autorise tous les membres à écrire.',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      await ctx.sock.groupSettingUpdate(ctx.chatId, 'not_announcement')
      await ctx.reply('🔓 Groupe ouvert : tous les membres peuvent écrire.')
    },
  },
  {
    name: 'fermer',
    description: 'Réserve l’envoi de messages aux administrateurs.',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      await ctx.sock.groupSettingUpdate(ctx.chatId, 'announcement')
      await ctx.reply('🔒 Groupe fermé : seuls les administrateurs peuvent écrire.')
    },
  },
  {
    name: 'nomgroupe',
    description: 'Change le nom du groupe.',
    usage: '<nouveau nom>',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      if (!ctx.argText) return void (await ctx.reply(`Utilisation : ${ctx.prefix}nomgroupe Nouveau nom`))
      await ctx.sock.groupUpdateSubject(ctx.chatId, ctx.argText.slice(0, 100))
      await ctx.reply('Nom du groupe modifié.')
    },
  },
  {
    name: 'descriptiongroupe',
    aliases: ['description'],
    description: 'Change la description du groupe.',
    usage: '<description>',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      if (!ctx.argText) return void (await ctx.reply(`Utilisation : ${ctx.prefix}descriptiongroupe Texte`))
      await ctx.sock.groupUpdateDescription(ctx.chatId, ctx.argText.slice(0, 2_000))
      await ctx.reply('Description du groupe modifiée.')
    },
  },
  {
    name: 'invitation',
    aliases: ['liengroupe'],
    description: 'Affiche le lien d’invitation du groupe.',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    cooldownSeconds: 10,
    async execute(ctx) {
      const code = await ctx.sock.groupInviteCode(ctx.chatId)
      await ctx.reply(`Lien d’invitation :\nhttps://chat.whatsapp.com/${code}`)
    },
  },
  {
    name: 'revoquerlien',
    description: 'Révoque l’ancien lien d’invitation.',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    cooldownSeconds: 15,
    async execute(ctx) {
      await ctx.sock.groupRevokeInvite(ctx.chatId)
      await ctx.reply('Ancien lien révoqué. Un nouveau lien a été créé.')
    },
  },
  {
    name: 'administrateurs',
    aliases: ['listeadministrateurs'],
    description: 'Affiche les administrateurs du groupe.',
    category: 'Groupe',
    groupOnly: true,
    async execute(ctx) {
      const admins =
        ctx.groupMetadata?.participants
          .filter((participant) => participant.admin)
          .map((participant) => participant.id) ?? []
      await ctx.reply(
        admins.length ? `Administrateurs :\n${admins.map(jidToMention).join('\n')}` : 'Aucun administrateur trouvé.',
        admins,
      )
    },
  },
  {
    name: 'infosgroupe',
    aliases: ['infogroupe'],
    description: 'Affiche un résumé clair du groupe et de ses réglages.',
    category: 'Groupe',
    groupOnly: true,
    async execute(ctx) {
      const metadata = ctx.groupMetadata
      const settings = ctx.db.getGroup(ctx.chatId)
      const participants = metadata?.participants ?? []
      const adminCount = participants.filter((participant) => participant.admin).length
      await ctx.reply(
        brandedPanel(
          'INFOS DU GROUPE',
          [
            `Nom : *${metadata?.subject ?? 'indisponible'}*`,
            `Membres : ${metadata?.size ?? participants.length}`,
            `Administrateurs : ${adminCount}`,
            `Écriture : ${metadata?.announce ? 'admins uniquement' : 'tous les membres'}`,
            `Infos verrouillées : ${metadata?.restrict ? 'oui' : 'non'}`,
            `Validation des entrées : ${metadata?.joinApprovalMode ? 'activée' : 'désactivée'}`,
            `Messages éphémères : ${metadata?.ephemeralDuration ? `${Math.round(metadata.ephemeralDuration / 86_400)} jour(s)` : 'désactivés'}`,
            `Règlement : ${settings.rules ? 'configuré' : 'non configuré'}`,
            ...(metadata?.desc ? [`Description : ${metadata.desc.slice(0, 250)}`] : []),
          ],
          ctx.config,
        ),
      )
    },
  },
  {
    name: 'membres',
    aliases: ['effectif'],
    description: 'Affiche l’effectif et les administrateurs du groupe.',
    category: 'Groupe',
    groupOnly: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const participants = ctx.groupMetadata?.participants ?? []
      const admins = participants.filter((participant) => participant.admin).map((participant) => participant.id)
      const shownAdmins = admins.slice(0, 25)
      const suffix = admins.length > shownAdmins.length ? `\n… et ${admins.length - shownAdmins.length} autre(s).` : ''
      await ctx.reply(
        `👥 Membres : *${ctx.groupMetadata?.size ?? participants.length}*\n👑 Administrateurs : *${admins.length}*\n\n${shownAdmins.length ? shownAdmins.map(jidToMention).join('\n') : 'Aucun administrateur trouvé.'}${suffix}`,
        shownAdmins,
      )
    },
  },
  {
    name: 'comptermembres',
    aliases: ['comptegroupe'],
    description: 'Compte précisément les membres et les administrateurs du groupe.',
    category: 'Groupe',
    groupOnly: true,
    cooldownSeconds: 3,
    async execute(ctx) {
      const participants = ctx.groupMetadata?.participants ?? []
      const total = ctx.groupMetadata?.size ?? participants.length
      const admins = participants.filter((participant) => participant.admin).length
      const standards = Math.max(0, total - admins)
      await ctx.reply(
        `👥 *EFFECTIF DU GROUPE*\n\nMembres : *${total}*\nAdministrateurs : *${admins}*\nMembres standards : *${standards}*`,
      )
    },
  },
  {
    name: 'reglement',
    aliases: ['regles'],
    description: 'Affiche ou configure le règlement permanent du groupe.',
    usage: 'definir <texte>|voir|effacer',
    category: 'Groupe',
    groupOnly: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      const settings = ctx.db.getGroup(ctx.chatId)
      if (!action || action === 'voir') {
        return void (await ctx.reply(settings.rules ? brandedPanel('RÈGLEMENT DU GROUPE', settings.rules.split('\n'), ctx.config) : `Aucun règlement n’est encore défini. Un admin peut utiliser ${ctx.prefix}reglement definir <texte>.`))
      }
      if (!ctx.isAdmin && !ctx.isOwner) {
        return void (await ctx.reply('Seul un administrateur peut modifier le règlement.'))
      }
      if (action === 'effacer') {
        await ctx.db.updateGroup(ctx.chatId, { rules: '' })
        return void (await ctx.reply('Règlement effacé.'))
      }
      if (action !== 'definir' || ctx.args.length < 2) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}reglement definir Respect, pas de liens non autorisés.`))
      }
      await ctx.db.updateGroup(ctx.chatId, { rules: ctx.args.slice(1).join(' ').slice(0, 3_000) })
      await ctx.reply(`Règlement enregistré. Tout le monde peut le lire avec ${ctx.prefix}reglement.`)
    },
  },
  {
    name: 'messagesdisparition',
    aliases: ['messagesephemeres'],
    description: 'Configure la durée des messages éphémères du groupe.',
    usage: 'desactiver|24h|7j|90j',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      const choice = ctx.args[0]?.toLowerCase()
      const durations: Record<string, number> = { desactiver: 0, '24h': 86_400, '7j': 604_800, '90j': 7_776_000 }
      if (choice === undefined || durations[choice] === undefined) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}messagesdisparition desactiver|24h|7j|90j`))
      }
      await ctx.sock.groupToggleEphemeral(ctx.chatId, durations[choice])
      await ctx.reply(choice === 'desactiver' ? 'Messages éphémères désactivés.' : `Messages éphémères réglés sur *${choice}*.`)
    },
  },
  {
    name: 'validationentree',
    aliases: ['validationmembres'],
    description: 'Active ou désactive la validation des demandes d’entrée.',
    usage: 'activer|desactiver',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action !== 'activer' && action !== 'desactiver') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}validationentree activer|desactiver`))
      }
      await ctx.sock.groupJoinApprovalMode(ctx.chatId, action === 'activer' ? 'on' : 'off')
      await ctx.reply(`Validation des entrées *${action === 'activer' ? 'activée' : 'désactivée'}*.`)
    },
  },
  {
    name: 'demandesadmission',
    aliases: ['demandesentree'],
    description: 'Liste, accepte ou refuse les demandes d’entrée quand la validation est activée.',
    usage: 'liste|accepter @personne|refuser @personne',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    cooldownSeconds: 5,
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase() ?? 'liste'
      if (action === 'liste') {
        const requests = await ctx.sock.groupRequestParticipantsList(ctx.chatId)
        const users = requests.map(pendingRequestJid).filter((jid): jid is string => Boolean(jid)).slice(0, 50)
        await ctx.reply(
          users.length
            ? `*DEMANDES D’ADMISSION (${users.length})*\n\n${users.map(jidToMention).join('\n')}\n\nAccepter : ${ctx.prefix}demandesadmission accepter @personne`
            : 'Aucune demande d’admission en attente.',
          users,
        )
        return
      }
      if (action !== 'accepter' && action !== 'refuser') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}demandesadmission liste|accepter @personne|refuser @personne`))
      }
      const target = ctx.targetUser() ?? phoneToJid(ctx.args[1] ?? '')
      if (!target) return void (await ctx.reply('Mentionne la personne concernée ou indique son numéro international après l’action.'))
      await ctx.sock.groupRequestParticipantsUpdate(ctx.chatId, [target], action === 'accepter' ? 'approve' : 'reject')
      await ctx.reply(`${jidToMention(target)} : demande ${action === 'accepter' ? 'acceptée' : 'refusée'}.`, [target])
    },
  },
  {
    name: 'ajoutmembres',
    aliases: ['membresajout'],
    description: 'Définit qui peut ajouter de nouveaux membres au groupe.',
    usage: 'tous|administrateurs',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      const mode = ctx.args[0]?.toLowerCase()
      if (mode !== 'tous' && mode !== 'administrateurs') {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}ajoutmembres tous|administrateurs`))
      }
      await ctx.sock.groupMemberAddMode(ctx.chatId, mode === 'tous' ? 'all_member_add' : 'admin_add')
      await ctx.reply(mode === 'tous' ? 'Tous les membres peuvent maintenant ajouter des personnes.' : 'Seuls les administrateurs peuvent maintenant ajouter des personnes.')
    },
  },
  {
    name: 'verrouillerinfos',
    description: 'Réserve la modification des informations du groupe aux administrateurs.',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      await ctx.sock.groupSettingUpdate(ctx.chatId, 'locked')
      await ctx.reply('🔐 Informations du groupe verrouillées.')
    },
  },
  {
    name: 'deverrouillerinfos',
    description: 'Autorise tous les membres à modifier les informations du groupe.',
    category: 'Groupe',
    groupOnly: true,
    adminOnly: true,
    botAdminRequired: true,
    async execute(ctx) {
      await ctx.sock.groupSettingUpdate(ctx.chatId, 'unlocked')
      await ctx.reply('🔓 Informations du groupe déverrouillées.')
    },
  },
  {
    name: 'lienmembres',
    description: 'Envoie en privé le lien d’un groupe destination à un nombre choisi de membres d’un groupe source, depuis n’importe quelle conversation.',
    usage: '<nombre> | <lien_groupe_source> | <lien_groupe_destination> | [message avec {lien} et {numero}]',
    category: 'Groupe',
    cooldownSeconds: 30,
    async execute(ctx) {
      const parts = ctx.argText.split('|').map((part) => part.trim())
      const requested = Number.parseInt(parts[0] ?? '', 10)
      const sourceLink = parts[1] ?? ''
      const destinationLink = parts[2] ?? ''
      const template = parts.slice(3).join(' | ').trim() || 'Bonjour, rejoins notre groupe ici : {lien}'
      const sourceCode = groupInviteCode(sourceLink)
      const destinationCode = groupInviteCode(destinationLink)
      if (!Number.isInteger(requested) || requested < 1 || requested > 100 || !sourceCode || !destinationCode) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}lienmembres 20 | LIEN_GROUPE_SOURCE | LIEN_GROUPE_DESTINATION | Bonjour, rejoins-nous ici : {lien}`))
      }

      let sourceInfo
      try {
        sourceInfo = await ctx.sock.groupGetInviteInfo(sourceCode)
      } catch {
        return void (await ctx.reply('Impossible de reconnaître le lien du groupe source. Vérifie que le lien d’invitation est toujours valide.'))
      }
      let destinationInfo
      try {
        destinationInfo = await ctx.sock.groupGetInviteInfo(destinationCode)
      } catch {
        return void (await ctx.reply('Impossible de reconnaître le lien du groupe destination. Vérifie que le lien d’invitation est toujours valide.'))
      }
      if (sourceInfo.id === destinationInfo.id) return void (await ctx.reply('Le groupe source et le groupe destination doivent être différents.'))

      let source
      try {
        source = await ctx.sock.groupMetadata(sourceInfo.id)
      } catch {
        return void (await ctx.reply('Bestla doit déjà être membre du groupe source pour pouvoir lire ses membres.'))
      }

      let destinationMembers: string[] = []
      try {
        const destination = await ctx.sock.groupMetadata(destinationInfo.id)
        destinationMembers = destination.participants.map((participant) => participant.id)
      } catch {
        // Bestla n’a pas besoin d’être membre du groupe destination pour simplement envoyer son lien.
      }

      const self = ctx.sock.user?.id
      const participants = source.participants
        .map((participant) => {
          const details = participant as typeof participant & { phoneNumber?: string | null }
          return details.phoneNumber || participant.id
        })
        .filter((jid) => !sameUser(jid, self) && !destinationMembers.some((existing) => sameUser(existing, jid)))
        .slice(0, requested)
      if (!participants.length) return void (await ctx.reply('Aucun membre disponible dans le groupe source pour cet envoi.'))

      const cleanDestinationLink = `https://chat.whatsapp.com/${destinationCode}`
      let sent = 0
      let failed = 0
      for (const jid of participants) {
        const number = jid.split('@')[0]?.split(':')[0] ?? jid
        const text = template.replaceAll('{lien}', cleanDestinationLink).replaceAll('{numero}', number).slice(0, 4_000)
        try {
          await ctx.sock.sendMessage(jid, { text })
          sent += 1
        } catch {
          failed += 1
        }
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
      await ctx.reply(`Envoi terminé : *${sent}* membre(s) reçu(s)${failed ? `, *${failed}* échec(s)` : ''}.`)
    },
  },
  {
    name: 'copiermembres',
    description: 'Ajoute dans un groupe destination un nombre choisi de membres d’un groupe source, à partir des deux liens et depuis n’importe quelle conversation.',
    usage: '<nombre> | <lien_groupe_source> | <lien_groupe_destination>',
    category: 'Groupe',
    cooldownSeconds: 30,
    async execute(ctx) {
      const parts = ctx.argText.split('|').map((part) => part.trim())
      const requested = Number.parseInt(parts[0] ?? '', 10)
      const sourceCode = groupInviteCode(parts[1] ?? '')
      const destinationCode = groupInviteCode(parts[2] ?? '')
      if (!Number.isInteger(requested) || requested < 1 || requested > 100 || !sourceCode || !destinationCode) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}copiermembres 20 | LIEN_GROUPE_SOURCE | LIEN_GROUPE_DESTINATION`))
      }

      let sourceInfo
      try {
        sourceInfo = await ctx.sock.groupGetInviteInfo(sourceCode)
      } catch {
        return void (await ctx.reply('Impossible de reconnaître le lien du groupe source. Vérifie que le lien d’invitation est toujours valide.'))
      }
      let destinationInfo
      try {
        destinationInfo = await ctx.sock.groupGetInviteInfo(destinationCode)
      } catch {
        return void (await ctx.reply('Impossible de reconnaître le lien du groupe destination. Vérifie que le lien d’invitation est toujours valide.'))
      }
      if (sourceInfo.id === destinationInfo.id) return void (await ctx.reply('Le groupe source et le groupe destination doivent être différents.'))

      let source
      try {
        source = await ctx.sock.groupMetadata(sourceInfo.id)
      } catch {
        return void (await ctx.reply('Bestla doit déjà être membre du groupe source pour pouvoir lire ses membres.'))
      }
      let destination
      try {
        destination = await ctx.sock.groupMetadata(destinationInfo.id)
      } catch {
        return void (await ctx.reply('Bestla doit déjà être membre du groupe destination pour pouvoir y ajouter des membres.'))
      }

      const current = destination.participants.map((participant) => participant.id)
      const self = ctx.sock.user?.id
      const candidates = source.participants
        .map((participant) => {
          const details = participant as typeof participant & { phoneNumber?: string | null }
          return details.phoneNumber || participant.id
        })
        .filter((jid) => !sameUser(jid, self) && !current.some((existing) => sameUser(existing, jid)))
        .slice(0, requested)
      if (!candidates.length) return void (await ctx.reply('Aucun nouveau membre disponible dans le groupe source.'))

      let added = 0
      let refused = 0
      for (let index = 0; index < candidates.length; index += 10) {
        const batch = candidates.slice(index, index + 10)
        try {
          const results = await ctx.sock.groupParticipantsUpdate(destinationInfo.id, batch, 'add')
          for (const result of results) {
            const status = Number(result.status)
            if (status >= 200 && status < 300) added += 1
            else refused += 1
          }
        } catch {
          refused += batch.length
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      await ctx.reply(`Ajout terminé : *${added}* membre(s) ajouté(s)${refused ? `, *${refused}* non ajouté(s) (droits du groupe, confidentialité, invitation ou refus WhatsApp)` : ''}.`)
    },
  },


]
