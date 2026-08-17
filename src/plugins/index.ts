import type { CommandRegistry } from '../core/registry.js'
import { aiCommands } from './ai.js'
import { apkCommands } from './apk.js'
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
import { socialMediaCommands } from './social-media.js'
import { whatsappCommands } from './whatsapp.js'
import { ttsCommands } from './tts.js'
import { textMakerCommands } from './textmaker.js'
import { userCommands } from './user.js'

export function registerBuiltInCommands(registry: CommandRegistry): void {
  ;[
    ...generalCommands,
    ...apkCommands,
    ...aiCommands,
    ...groupCommands,
    ...moderationCommands,
    ...mediaCommands,
    ...generativeMediaCommands,
    ...socialMediaCommands,
    ...advancedMediaCommands,
    ...ttsCommands,
    ...automationCommands,
    ...budgetCommands,
    ...businessCommands,
    ...commerceCommands,
    ...gameCommands,
    ...textMakerCommands,
    ...userCommands,
    ...whatsappCommands,
    ...ownerCommands,
  ].forEach((command) => registry.register(command))
}
