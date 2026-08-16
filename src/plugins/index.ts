import type { CommandRegistry } from '../core/registry.js'
import { aiCommands } from './ai.js'
import { automationCommands } from './automation.js'
import { advancedMediaCommands } from './advanced-media.js'
import { budgetCommands } from './budget.js'
import { businessCommands } from './business.js'
import { commerceCommands } from './commerce.js'
import { gameCommands } from './games.js'
import { generalCommands } from './general.js'
import { groupCommands } from './group.js'
import { generativeMediaCommands } from './generative-media.js'
import { mediaCommands } from './media.js'
import { moderationCommands } from './moderation.js'
import { ownerCommands } from './owner.js'
import { whatsappCommands } from './whatsapp.js'

export function registerBuiltInCommands(registry: CommandRegistry): void {
  ;[
    ...generalCommands,
    ...aiCommands,
    ...groupCommands,
    ...moderationCommands,
    ...mediaCommands,
    ...generativeMediaCommands,
    ...advancedMediaCommands,
    ...automationCommands,
    ...budgetCommands,
    ...businessCommands,
    ...commerceCommands,
    ...gameCommands,
    ...whatsappCommands,
    ...ownerCommands,
  ].forEach((command) => registry.register(command))
}
