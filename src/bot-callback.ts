import TelegramBot from 'node-telegram-bot-api'
import { getApplicationStatus } from './status'
import { parse } from 'date-fns'

const TELEGRAM_BOT_CALLBACK_APPLICATIONS =
  process.env.TELEGRAM_BOT_CALLBACK_APPLICATIONS
if (!TELEGRAM_BOT_CALLBACK_APPLICATIONS) {
  throw new Error(
    'Вы не указали TELEGRAM_BOT_CALLBACK_APPLICATIONS в .env файле',
  )
}

const TELEGRAM_BOT_CALLBACK_NOTIFICATIONS_USER_ID =
  process.env.TELEGRAM_BOT_CALLBACK_NOTIFICATIONS_USER_ID
if (!TELEGRAM_BOT_CALLBACK_NOTIFICATIONS_USER_ID) {
  throw new Error(
    'Вы не указали TELEGRAM_BOT_CALLBACK_NOTIFICATIONS_USER_ID в .env файле',
  )
}

const TELEGRAM_BOT_CALLBACK_API_KEY = process.env.TELEGRAM_BOT_CALLBACK_API_KEY
if (!TELEGRAM_BOT_CALLBACK_API_KEY) {
  throw new Error('Вы не указали TELEGRAM_BOT_CALLBACK_API_KEY в .env файле')
}

const applications = TELEGRAM_BOT_CALLBACK_APPLICATIONS.split(',').map(
  (app) => {
    const data = app.trim()
    const parts = data.split(' ')
    if (parts.length !== 2) {
      throw new Error('Неверный формат TELEGRAM_BOT_CALLBACK_APPLICATIONS')
    }
    const referenceNumber = parts[0]
    const dateOfBirth = parse(parts[1], 'dd.MM.yyyy', new Date())
    return { referenceNumber, dateOfBirth }
  },
)

const bot = new TelegramBot(TELEGRAM_BOT_CALLBACK_API_KEY, {
  polling: false,
  webHook: false,
})

for (const application of applications) {
  try {
    const status = await getApplicationStatus(
      application.referenceNumber,
      application.dateOfBirth,
    )
    await bot.sendMessage(
      TELEGRAM_BOT_CALLBACK_NOTIFICATIONS_USER_ID,
      'Статус заявки ' + application.referenceNumber + ': ' + status,
    )
  } catch (e) {
    await bot.sendMessage(
      TELEGRAM_BOT_CALLBACK_NOTIFICATIONS_USER_ID,
      'Не удалось получить статус заявки ' +
        application.referenceNumber +
        (e instanceof Error ? ': ' + e.message : ''),
    )
  }
}
