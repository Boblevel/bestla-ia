import pino from 'pino'
import { config } from '../config.js'

export const logger = pino({
  level: config.logLevel,
  base: { application: 'bestla-ia-bot' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.x-api-key', 'apiKey', 'creds'],
    censor: '[SECRET]',
  },
})

export const baileysLogger = logger.child({ module: 'baileys' }, { level: 'warn' })
