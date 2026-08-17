import { randomInt } from 'node:crypto'
import os from 'node:os'
import { lookup, resolveMx, resolveNs } from 'node:dns/promises'
import type { BotCommand } from '../types.js'
import { brandedPanel } from '../utils/brand.js'
import { CalculationError, calculateExpression, formatCalculatedNumber } from '../utils/calculator.js'
import { ConversionError, convertUnit } from '../utils/converter.js'
import { jidToMention } from '../utils/jid.js'
import { formatDuration } from '../utils/text.js'
import { APP_VERSION } from '../version.js'
import { getWeather } from '../utils/weather.js'

const categoryIcons: Record<string, string> = {
  Général: '✨',
  IA: '🤖',
  Groupe: '👥',
  Modération: '🛡️',
  Média: '🎨',
  'Audio & Vidéo': '🎬',
  'Documents & Création': '📄',
  Automatisation: '⚙️',
  Budget: '💰',
  Entreprise: '💼',
  Jeux: '🎮',
  WhatsApp: '💬',
  Propriétaire: '👑',
}

function normalizeCategory(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const categoryAliases = new Map<string, string>([
  ['general', 'Général'],
  ['ia', 'IA'],
  ['groupe', 'Groupe'],
  ['moderation', 'Modération'],
  ['media', 'Média'],
  ['audiovideo', 'Audio & Vidéo'],
  ['audio', 'Audio & Vidéo'],
  ['video', 'Audio & Vidéo'],
  ['documentscreation', 'Documents & Création'],
  ['document', 'Documents & Création'],
  ['creation', 'Documents & Création'],
  ['automatisation', 'Automatisation'],
  ['budget', 'Budget'],
  ['entreprise', 'Entreprise'],
  ['jeux', 'Jeux'],
  ['whatsapp', 'WhatsApp'],
  ['proprietaire', 'Propriétaire'],
])

const categoryOrder = [
  'Automatisation',
  'Entreprise',
  'Groupe',
  'Média',
  'Audio & Vidéo',
  'Modération',
  'Jeux',
  'IA',
  'Propriétaire',
  'Budget',
  'Général',
  'Documents & Création',
  'WhatsApp',
] as const

function orderedCategories(registryByCategory: Map<string, BotCommand[]>): Array<[string, BotCommand[]]> {
  const remaining = new Map(registryByCategory)
  const ordered: Array<[string, BotCommand[]]> = []
  for (const name of categoryOrder) {
    const value = remaining.get(name)
    if (!value) continue
    ordered.push([name, value])
    remaining.delete(name)
  }
  for (const entry of remaining) ordered.push(entry)
  return ordered
}

function menuDatePart(date: Date, timezone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: timezone }).format(date)
}

function menuUserName(ctx: Parameters<BotCommand['execute']>[0]): string {
  const pushName = ctx.message.pushName?.trim()
  if (pushName) return pushName.slice(0, 40)
  return ctx.sender.split('@')[0]?.replace(/\D/g, '') || 'Utilisateur'
}

function menuSection(title: string, icon: string, commands: BotCommand[], prefix: string): string[] {
  const lines = [`╭─❏ ${icon} ${title.toUpperCase()} ❏`]
  for (const command of [...commands].sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
    lines.push(`│ ${prefix}${command.name}`)
  }
  lines.push('╰─────────────────')
  return lines
}

function menuHeader(
  ctx: Parameters<BotCommand['execute']>[0],
  activeCount: number,
): string[] {
  const now = new Date()
  const rssMb = Math.max(1, Math.round(process.memoryUsage().rss / 1024 / 1024))
  const totalMb = Math.max(1, Math.round(os.totalmem() / 1024 / 1024))
  const platform = `VPS (${os.platform() === 'linux' ? 'Linux' : os.platform()} ${os.arch()})`
  return [
    `╭═══ ✦ *${ctx.config.botName}* ✦ ═══⊷`,
    '┃❃╭────────────────',
    `┃❃│ Préfixe : *${ctx.prefix}*`,
    `┃❃│ Utilisateur : *${menuUserName(ctx)}*`,
    `┃❃│ Session : *${ctx.sessionName}*`,
    `┃❃│ Heure : ${menuDatePart(now, ctx.config.timezone, { hour: '2-digit', minute: '2-digit' })}`,
    `┃❃│ Jour : ${menuDatePart(now, ctx.config.timezone, { weekday: 'long' })}`,
    `┃❃│ Date : ${menuDatePart(now, ctx.config.timezone, { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
    `┃❃│ Version : *${APP_VERSION}*`,
    `┃❃│ Commandes : *${activeCount}*`,
    `┃❃│ RAM : ${rssMb}/${totalMb} Mo`,
    `┃❃│ Uptime : ${formatDuration(process.uptime())}`,
    `┃❃│ Plateforme : ${platform}`,
    '┃❃╰────────────────',
    '╰═════════════════⊷',
  ]
}

function domainFromText(value: string): string | undefined {
  const raw = value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? ''
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(raw) ? raw : undefined
}

const PASSWORD_SETS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%*-_',
]
const PASSWORD_CHARACTERS = PASSWORD_SETS.join('')

function generatePassword(length: number): string {
  const characters = PASSWORD_SETS.map((set) => set[randomInt(0, set.length)] ?? '')
  while (characters.length < length) characters.push(PASSWORD_CHARACTERS[randomInt(0, PASSWORD_CHARACTERS.length)] ?? '')
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1)
    const current = characters[index]
    characters[index] = characters[swapIndex] ?? ''
    characters[swapIndex] = current ?? ''
  }
  return characters.join('')
}

export const generalCommands: BotCommand[] = [
  {
    name: 'menu',
    aliases: ['aide', 'commandes', 'bestla'],
    description: 'Affiche le centre de commandes, une catégorie ou le détail d’une commande.',
    usage: '[catégorie|commande|tout]',
    category: 'Général',
    cooldownSeconds: 3,
    async execute(ctx) {
      const requested = ctx.argText.trim().toLowerCase()
      const category = categoryAliases.get(normalizeCategory(requested))
      const ordered = orderedCategories(ctx.registry.byCategory())
      const activeCommands = ctx.registry.list()
        .filter((command) => command.name === 'commande' || ctx.db.isCommandEnabled(command.name))

      if (category) {
        const commands = (ctx.registry.byCategory().get(category as never) ?? [])
          .filter((command) => command.name === 'commande' || ctx.db.isCommandEnabled(command.name))
        const lines = [
          ...menuHeader(ctx, activeCommands.length),
          '',
          ...menuSection(category, categoryIcons[category] ?? '◆', commands, ctx.prefix),
          '',
          `Tape *${ctx.prefix}menu* pour le menu complet.`,
          `✦ BY ${ctx.config.signature}`,
        ]
        await ctx.reply(lines.join('\n'))
        return
      }

      if (requested && requested !== 'tout' && requested !== 'all') {
        const command = ctx.registry.get(requested)
        if (!command) return void (await ctx.reply(`Commande introuvable : ${requested}`))
        if (command.name !== 'commande' && !ctx.db.isCommandEnabled(command.name)) {
          return void (await ctx.reply(
            ctx.isOwner
              ? `La commande *${ctx.prefix}${command.name}* est désactivée. Réactive-la avec *${ctx.prefix}commande activer ${command.name}*.`
              : 'Cette commande n’est pas disponible.',
          ))
        }
        const aliases = command.aliases?.length ? `Alias : ${command.aliases.join(', ')}` : 'Alias : aucun'
        const usage = command.usage ? ` ${command.usage}` : ''
        await ctx.reply(
          `${brandedPanel(
            'FICHE COMMANDE',
            [
              `Commande : *${ctx.prefix}${command.name}${usage}*`,
              command.description,
              aliases,
              `Catégorie : ${command.category}`,
            ],
            ctx.config,
          )}\n\n✦ BY ${ctx.config.signature}`,
        )
        return
      }

      const lines: string[] = [...menuHeader(ctx, activeCommands.length), '']
      for (const [name, commands] of ordered) {
        const active = commands.filter((command) => command.name === 'commande' || ctx.db.isCommandEnabled(command.name))
        if (!active.length) continue
        lines.push(...menuSection(name, categoryIcons[name] ?? '◆', active, ctx.prefix), '')
      }
      lines.push(
        `Tape *${ctx.prefix}menu ia*, *${ctx.prefix}menu groupe* ou *${ctx.prefix}menu nom_commande*.`,
        `✦ BY ${ctx.config.signature}`,
      )
      await ctx.reply(lines.join('\n'))
    },
  },
  {
    name: 'latence',
    aliases: ['rapidite'],
    description: 'Mesure le temps de réponse de Bestla iA.',
    category: 'Général',
    cooldownSeconds: 2,
    async execute(ctx) {
      const startedAt = performance.now()
      const sent = await ctx.reply('🏓 Mesure de la latence…')
      const latency = Math.max(0, Math.round(performance.now() - startedAt))
      if (sent?.key.remoteJid) {
        await ctx.sock.sendMessage(sent.key.remoteJid, {
          text: `⚡ Réponse en *${latency} ms*.`,
          edit: sent.key,
        })
      }
    },
  },
  {
    name: 'duree',
    aliases: ['activite'],
    description: 'Affiche la durée de fonctionnement du bot.',
    category: 'Général',
    async execute(ctx) {
      await ctx.reply(`⏱️ En ligne depuis *${formatDuration(process.uptime())}*.`)
    },
  },
  {
    name: 'info',
    aliases: ['infobot'],
    description: 'Affiche l’identité et l’état général du bot.',
    category: 'Général',
    async execute(ctx) {
      const mode = ctx.db.getPublicMode(ctx.config.publicMode) ? 'public' : 'privé'
      await ctx.reply(
        brandedPanel(
          'IDENTITÉ DU BOT',
          [
            `Version : *${APP_VERSION}*`,
            `Moteur : Node.js ${process.version}`,
            `Session : ${ctx.sessionName}`,
            `Mode : ${mode}`,
            `Commandes : ${ctx.registry.list().length}`,
          ],
          ctx.config,
        ),
      )
    },
  },
  {
    name: 'proprietaire',
    aliases: ['createur'],
    description: 'Affiche le ou les propriétaires configurés.',
    category: 'Général',
    async execute(ctx) {
      if (ctx.config.ownerNumbers.length === 0) {
        await ctx.reply('Aucun numéro propriétaire n’est configuré dans OWNER_NUMBERS.')
        return
      }
      const jids = ctx.config.ownerNumbers.map((phone) => `${phone}@s.whatsapp.net`)
      await ctx.reply(`👑 Propriétaire(s) :\n${jids.map(jidToMention).join('\n')}`, jids)
    },
  },
  {
    name: 'identifiant',
    aliases: ['numerochat'],
    description: 'Affiche les identifiants techniques du chat et de l’expéditeur.',
    category: 'Général',
    async execute(ctx) {
      await ctx.reply(`Chat : ${ctx.chatId}\nExpéditeur : ${ctx.sender}`)
    },
  },
  {
    name: 'heure',
    aliases: ['dateheure'],
    description: 'Affiche la date et l’heure du serveur selon le fuseau configuré.',
    category: 'Général',
    async execute(ctx) {
      const formatted = new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: ctx.config.timezone,
      }).format(new Date())
      await ctx.reply(`🕒 ${formatted}\nFuseau : ${ctx.config.timezone}`)
    },
  },
  {
    name: 'calculer',
    aliases: ['calcul'],
    description: 'Résout un calcul sans exécuter de code externe.',
    usage: '<expression>',
    category: 'Général',
    cooldownSeconds: 2,
    async execute(ctx) {
      if (!ctx.argText) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}calculer (25 + 5) × 2`))
      }
      try {
        const result = calculateExpression(ctx.argText)
        await ctx.reply(`🧮 ${ctx.argText} = *${formatCalculatedNumber(result)}*`)
      } catch (error) {
        const detail = error instanceof CalculationError ? error.message : 'Calcul invalide.'
        await ctx.reply(`${detail} Exemple : ${ctx.prefix}calculer (25 + 5) × 2`)
      }
    },
  },
  {
    name: 'convertir',
    aliases: ['conversion'],
    description: 'Convertit une longueur, masse, volume ou température.',
    usage: '<valeur> <unité départ> <unité arrivée>',
    category: 'Général',
    cooldownSeconds: 2,
    async execute(ctx) {
      const value = Number((ctx.args[0] ?? '').replace(',', '.'))
      const from = ctx.args[1]
      const to = ctx.args[2]
      if (!Number.isFinite(value) || !from || !to) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}convertir 10 km mi\nUnités : km, m, cm, mi, kg, g, lb, L, mL, gal, C, F.`))
      }
      try {
        const converted = convertUnit(value, from, to)
        await ctx.reply(`🔁 *${formatCalculatedNumber(value)} ${converted.from}* = *${formatCalculatedNumber(converted.value)} ${converted.to}*`)
      } catch (error) {
        const detail = error instanceof ConversionError ? error.message : 'Conversion invalide.'
        await ctx.reply(detail)
      }
    },
  },
  {
    name: 'motdepasse',
    aliases: ['generermotdepasse'],
    description: 'Génère un mot de passe aléatoire robuste en privé.',
    usage: '[longueur 8 à 64]',
    category: 'Général',
    cooldownSeconds: 5,
    async execute(ctx) {
      if (ctx.isGroup) {
        return void (await ctx.reply('Pour ta confidentialité, utilise cette commande dans une conversation privée.'))
      }
      const requested = Number(ctx.args[0] ?? 16)
      const length = Number.isInteger(requested) ? requested : 16
      if (length < 8 || length > 64) {
        return void (await ctx.reply(`Utilisation : ${ctx.prefix}motdepasse 16 (entre 8 et 64 caractères).`))
      }
      await ctx.reply(`🔐 Mot de passe généré :\n\n\`${generatePassword(length)}\`\n\nNe le partage avec personne.`)
    },
  },
  {
    name: 'meteo',
    aliases: ['temps'],
    description: 'Affiche la météo actuelle et les températures du jour pour une ville.',
    usage: '<ville>',
    category: 'Général',
    cooldownSeconds: 10,
    async execute(ctx) {
      if (!ctx.argText) return void (await ctx.reply(`Utilisation : ${ctx.prefix}meteo Ouagadougou`))
      try {
        const weather = await getWeather(ctx.argText)
        const range = weather.min !== null && weather.max !== null ? `${weather.min}° → ${weather.max}°` : 'indisponible'
        const rain = weather.rainProbability !== null ? `${weather.rainProbability} %` : 'indisponible'
        await ctx.reply(
          brandedPanel(
            `MÉTÉO • ${weather.location.toUpperCase()}`,
            [
              `Pays : ${weather.country || 'indisponible'}`,
              `Condition : *${weather.condition}*`,
              `Température : *${weather.temperature}°C* (ressenti ${weather.apparentTemperature}°C)`,
              `Aujourd’hui : ${range}`,
              `Humidité : ${weather.humidity} % • Vent : ${weather.windSpeed} km/h`,
              `Précipitations : ${weather.precipitation} mm • Risque de pluie : ${rain}`,
              `Fuseau local : ${weather.timezone}`,
            ],
            ctx.config,
          ),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Météo indisponible pour le moment.'
        await ctx.reply(message)
      }
    },
  },
  {
    name: 'domaine',
    aliases: ['infosdomaine'],
    description: 'Vérifie les enregistrements DNS publics d’un nom de domaine.',
    usage: '<domaine>',
    category: 'Général',
    cooldownSeconds: 8,
    async execute(ctx) {
      const domain = domainFromText(ctx.argText)
      if (!domain) return void (await ctx.reply(`Utilisation : ${ctx.prefix}domaine exemple.com`))
      const [addresses, nameservers, mail] = await Promise.all([
        lookup(domain, { all: true, verbatim: true }).catch(() => []),
        resolveNs(domain).catch(() => []),
        resolveMx(domain).catch(() => []),
      ])
      await ctx.reply(
        brandedPanel(
          `DOMAINE • ${domain}`,
          [
            `Adresses : ${addresses.length ? addresses.slice(0, 6).map((entry) => entry.address).join(', ') : 'aucune réponse'}`,
            `Serveurs DNS : ${nameservers.length ? nameservers.slice(0, 4).join(', ') : 'aucun'}`,
            `Serveurs mail : ${mail.length ? mail.sort((a, b) => a.priority - b.priority).slice(0, 4).map((entry) => entry.exchange).join(', ') : 'aucun'}`,
          ],
          ctx.config,
        ),
      )
    },
  },
  {
    name: 'choisir',
    aliases: ['tirage'],
    description: 'Choisit une option au hasard parmi une liste séparée par |.',
    usage: '<option 1> | <option 2> | …',
    category: 'Général',
    cooldownSeconds: 2,
    async execute(ctx) {
      const choices = ctx.argText.split('|').map((choice) => choice.trim()).filter(Boolean).slice(0, 30)
      if (choices.length < 2) return void (await ctx.reply(`Utilisation : ${ctx.prefix}choisir rouge | bleu | vert`))
      const choice = choices[randomInt(0, choices.length)]
      await ctx.reply(`🎲 Je choisis : *${choice}*`)
    },
  },
  {
    name: 'pileouface',
    aliases: ['piece'],
    description: 'Lance une pièce virtuelle.',
    category: 'Général',
    cooldownSeconds: 2,
    async execute(ctx) {
      await ctx.reply(randomInt(0, 2) === 0 ? '🪙 *PILE*' : '🪙 *FACE*')
    },
  },
]
