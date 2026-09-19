import { readFile, unlink } from 'node:fs/promises'
import type { AnyMessageContent } from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import { brandedPanel } from '../utils/brand.js'
import type { Appointment, JsonDatabase, ScheduledJob } from './database.js'
import { logger } from './logger.js'
import type { SessionManager } from './session-manager.js'

const STATUS_SCHEDULE_PREFIX = '__BESTLA_STATUS_V1__:'

interface ScheduledStatusPayload {
  kind: 'text' | 'image' | 'video'
  audience: string[]
  text?: string
  mimetype?: string
  filePath?: string
}

function scheduledStatusPayload(message: string): ScheduledStatusPayload | undefined {
  if (!message.startsWith(STATUS_SCHEDULE_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(message.slice(STATUS_SCHEDULE_PREFIX.length)) as ScheduledStatusPayload
    if (!parsed || !Array.isArray(parsed.audience) || !['text', 'image', 'video'].includes(parsed.kind)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export class SchedulerService {
  private timer: NodeJS.Timeout | undefined
  private running = false

  constructor(
    private readonly config: AppConfig,
    private readonly db: JsonDatabase,
    private readonly sessions: SessionManager,
  ) {}

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 10_000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const jobs = await this.db.claimDueSchedules()
      for (const job of jobs) await this.deliver(job)
      const appointments = await this.db.claimDueAppointments()
      for (const appointment of appointments) await this.deliverAppointment(appointment)
    } catch (error) {
      logger.error({ err: error }, 'Erreur du planificateur')
    } finally {
      this.running = false
    }
  }

  private async deliverAppointment(appointment: Appointment): Promise<void> {
    try {
      const when = new Date(appointment.scheduledAt).toLocaleString('fr-FR', { timeZone: this.config.timezone })
      await this.sessions.send(appointment.sessionName, appointment.chatId, {
        text: brandedPanel(
          'RENDEZ-VOUS',
          [
            `Heure : ${when}`,
            `Contact : ${appointment.contact}`,
            `Objet : ${appointment.title}`,
            `Référence : #${appointment.id}`,
          ],
          this.config,
        ),
      })
      await this.db.finishAppointment(appointment.id, true)
      logger.info({ appointmentId: appointment.id, session: appointment.sessionName }, 'Rappel de rendez-vous envoyé')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Erreur inconnue'
      await this.db.finishAppointment(appointment.id, false, reason)
      logger.warn({ err: error, appointmentId: appointment.id }, 'Rappel de rendez-vous non envoyé')
    }
  }

  private async deliver(job: ScheduledJob): Promise<void> {
    const statusPayload = scheduledStatusPayload(job.message)
    try {
      if (statusPayload) {
        let content: AnyMessageContent
        if (statusPayload.kind === 'text') {
          if (!statusPayload.text) throw new Error('Texte du statut programmé manquant.')
          content = { text: statusPayload.text }
        } else {
          if (!statusPayload.filePath) throw new Error('Fichier du statut programmé manquant.')
          const buffer = await readFile(statusPayload.filePath)
          if (statusPayload.kind === 'image') {
            content = { image: buffer, ...(statusPayload.text ? { caption: statusPayload.text } : {}) }
          } else {
            content = {
              video: buffer,
              ...(statusPayload.mimetype ? { mimetype: statusPayload.mimetype } : {}),
              ...(statusPayload.text ? { caption: statusPayload.text } : {}),
            }
          }
        }
        await this.sessions.send(job.sessionName, 'status@broadcast', content, {
          statusJidList: statusPayload.audience,
          broadcast: true,
        })
        await this.db.finishSchedule(job.id, true)
        if (job.repeat !== 'quotidien' && statusPayload.filePath) await unlink(statusPayload.filePath).catch(() => undefined)
        logger.info({ scheduleId: job.id, session: job.sessionName }, 'Statut WhatsApp programmé envoyé')
        return
      }

      const lines = job.message.split('\n').filter(Boolean)
      await this.sessions.send(job.sessionName, job.chatId, {
        text: brandedPanel('MESSAGE PROGRAMMÉ', lines, this.config),
      })
      await this.db.finishSchedule(job.id, true)
      logger.info({ scheduleId: job.id, session: job.sessionName }, 'Message programmé envoyé')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Erreur inconnue'
      await this.db.finishSchedule(job.id, false, reason)
      if (statusPayload?.filePath) await unlink(statusPayload.filePath).catch(() => undefined)
      logger.warn({ err: error, scheduleId: job.id }, statusPayload ? 'Statut WhatsApp programmé non envoyé' : 'Message programmé non envoyé')
    }
  }
}
