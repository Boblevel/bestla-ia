import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CommandRegistry } from '../src/core/registry.js'
import { registerBuiltInCommands } from '../src/plugins/index.js'

const registry = new CommandRegistry()
registerBuiltInCommands(registry)

const commands = registry.list().map((command) => ({
  name: command.name,
  aliases: command.aliases ?? [],
  description: command.description,
  usage: command.usage ?? '',
  category: command.category,
  ownerOnly: command.ownerOnly ?? false,
  groupOnly: command.groupOnly ?? false,
  adminOnly: command.adminOnly ?? false,
  botAdminRequired: command.botAdminRequired ?? false,
}))

const outputDirectory = path.resolve('output')
await mkdir(outputDirectory, { recursive: true })
await writeFile(
  path.join(outputDirectory, 'commandes-bestla.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), commands }, null, 2)}\n`,
  'utf8',
)
