import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BotCommand, CommandCategory } from '../types.js'
import { logger } from './logger.js'

type PluginExport =
  | BotCommand
  | BotCommand[]
  | ((registry: CommandRegistry) => void | Promise<void>)

const VALID_COMMAND = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const VALID_CATEGORIES = new Set<CommandCategory>([
  'Général',
  'IA',
  'Groupe',
  'Modération',
  'Média',
  'Audio & Vidéo',
  'Documents & Création',
  'Automatisation',
  'Budget',
  'Entreprise',
  'Jeux',
  'WhatsApp',
  'Propriétaire',
])

export class CommandRegistry {
  private readonly commands = new Map<string, BotCommand>()
  private readonly primaryCommands = new Map<string, BotCommand>()

  register(command: BotCommand): void {
    if (!command || typeof command !== 'object') throw new Error('Plugin de commande invalide')
    if (typeof command.name !== 'string') throw new Error('Nom de commande manquant')
    if (typeof command.execute !== 'function') throw new Error(`Fonction execute manquante : ${command.name}`)
    if (typeof command.description !== 'string' || !command.description.trim()) {
      throw new Error(`Description manquante : ${command.name}`)
    }
    if (!VALID_CATEGORIES.has(command.category)) throw new Error(`Catégorie invalide : ${command.category}`)
    const name = command.name.toLowerCase()
    if (!VALID_COMMAND.test(name)) throw new Error(`Nom de commande invalide : ${command.name}`)
    if (this.commands.has(name)) throw new Error(`Commande déjà enregistrée : ${name}`)

    const normalized: BotCommand = {
      ...command,
      name,
      ...(command.aliases ? { aliases: command.aliases.map((alias) => alias.toLowerCase()) } : {}),
    }

    this.primaryCommands.set(name, normalized)
    this.commands.set(name, normalized)
    for (const alias of normalized.aliases ?? []) {
      if (!VALID_COMMAND.test(alias)) throw new Error(`Alias invalide : ${alias}`)
      if (this.commands.has(alias)) throw new Error(`Alias déjà enregistré : ${alias}`)
      this.commands.set(alias, normalized)
    }
  }

  get(name: string): BotCommand | undefined {
    return this.commands.get(name.toLowerCase())
  }

  list(): BotCommand[] {
    return [...this.primaryCommands.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  byCategory(): Map<CommandCategory, BotCommand[]> {
    const categories = new Map<CommandCategory, BotCommand[]>()
    for (const command of this.list()) {
      const list = categories.get(command.category) ?? []
      list.push(command)
      categories.set(command.category, list)
    }
    return categories
  }

  async loadCustomPlugins(directory: string): Promise<void> {
    let files: string[]
    try {
      files = (await readdir(directory)).filter((file) => file.endsWith('.mjs')).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const file of files) {
      const absolutePath = path.join(directory, file)
      try {
        const module = (await import(`${pathToFileURL(absolutePath).href}?v=${Date.now()}`)) as {
          default?: PluginExport
        }
        const plugin = module.default
        if (typeof plugin === 'function') {
          await plugin(this)
        } else if (Array.isArray(plugin)) {
          plugin.forEach((command) => this.register(command))
        } else if (plugin) {
          this.register(plugin)
        } else {
          throw new Error('export default manquant')
        }
        logger.info({ file }, 'Plugin personnalisé chargé')
      } catch (error) {
        logger.error({ err: error, file }, 'Échec du chargement du plugin personnalisé')
      }
    }
  }
}
