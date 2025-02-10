import TelegramBot from 'node-telegram-bot-api'
import { getApplicationStatus } from './status'

const TELEGRAM_BOT_TRACKING_API_KEY = process.env.TELEGRAM_BOT_TRACKING_API_KEY
if (!TELEGRAM_BOT_TRACKING_API_KEY) {
  throw new Error('Вы не указали TELEGRAM_BOT_TRACKING_API_KEY в .env файле')
}

const bot = new TelegramBot(TELEGRAM_BOT_TRACKING_API_KEY, {
  polling: true,
})

const userStates = new Map<
  number,
  | { state: 'input_reference_number' }
  | { state: 'input_date_of_birth'; referenceNumber: string }
  | { state: 'loading'; editMessageId: number | null }
>()

type Scene =
  | 'mainMenu'
  | 'about'
  | 'inputReferenceNumber'
  | 'incorrectReferenceNumber'
  | 'inputDateOfBirth'
  | 'incorrectDateOfBirth'
  | 'fetchingApplicationStatus'
  | 'errorWhileFetchingApplicationStatus'

type SceneConfig = {
  text: string
  replyMarkup?: TelegramBot.InlineKeyboardMarkup
}

const rateLimit = new Map<number, number>()
const cache = new Map<string, { updatedAt: number; status: string }>()

const scenes: Record<Scene, SceneConfig> = {
  mainMenu: {
    text: 'Меню бота',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Добавить номер для отслеживания ➡️',
            callback_data: 'add_tracking',
          },
        ],
        [
          {
            text: 'О боте ℹ️',
            callback_data: 'about',
          },
        ],
      ],
    },
  },
  about: {
    text: 'О боте',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Назад',
            callback_data: 'main',
          },
        ],
      ],
    },
  },
  inputReferenceNumber: {
    text: 'Введите номер для отслеживания',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Отмена',
            callback_data: 'main',
          },
        ],
      ],
    },
  },
  incorrectReferenceNumber: {
    text: 'Некорректный формат номера для отслеживания. Попробуйте еще раз',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Отмена',
            callback_data: 'main',
          },
        ],
      ],
    },
  },
  inputDateOfBirth: {
    text: 'Введите дату рождения в формате ДД.ММ.ГГГГ',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Назад',
            callback_data: 'add_tracking',
          },
        ],
        [
          {
            text: 'Отмена',
            callback_data: 'main',
          },
        ],
      ],
    },
  },
  incorrectDateOfBirth: {
    text: 'Некорректный формат даты рождения. Попробуйте еще раз',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Назад',
            callback_data: 'add_tracking',
          },
        ],
        [
          {
            text: 'Отмена',
            callback_data: 'main',
          },
        ],
      ],
    },
  },
  fetchingApplicationStatus: {
    text: 'Получение статуса заявки... (это может занять до 30 секунд)',
  },
  errorWhileFetchingApplicationStatus: {
    text: 'Не удалось получить статус заявки. Попробуйте позже',
  },
}

bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) {
    return
  }

  const userState = userStates.get(msg.from.id)
  if (userState) {
    if (userState.state === 'input_reference_number') {
      if (msg.text) {
        const referenceNumberRegex = /^EVN\d+$/
        if (referenceNumberRegex.test(msg.text)) {
          userStates.set(msg.from.id, {
            state: 'input_date_of_birth',
            referenceNumber: msg.text,
          })
          await goToScene(msg, scenes.inputDateOfBirth, true)
        } else {
          await goToScene(msg, scenes.incorrectReferenceNumber, true)
        }
      } else {
        await goToScene(msg, scenes.incorrectReferenceNumber, true)
      }
      return
    } else if (userState.state === 'input_date_of_birth') {
      if (msg.text) {
        const dateOfBirthRegex = /^(\d{2})\.(\d{2})\.(\d{4})$/
        if (dateOfBirthRegex.test(msg.text)) {
          const [, day, month, year] = msg.text.match(dateOfBirthRegex)!
          userStates.set(msg.from.id, {
            state: 'loading',
            editMessageId: null,
          })
          const messageId = await goToScene(
            msg,
            scenes.fetchingApplicationStatus,
            true,
          )
          userStates.set(msg.from.id, {
            state: 'loading',
            editMessageId: messageId,
          })
          const birthdayDate = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            12,
            0,
            0,
            0,
          )
          fetchApplicationStatus({
            telegramUserId: msg.from.id,
            referenceNumber: userState.referenceNumber,
            dateOfBirth: birthdayDate,
          })
        } else {
          await goToScene(msg, scenes.incorrectDateOfBirth, true)
        }
      } else {
        await goToScene(msg, scenes.incorrectDateOfBirth, true)
      }
      return
    } else if (userState.state === 'loading') {
      userStates.set(msg.from.id, {
        state: 'loading',
        editMessageId: null,
      })
      return
    }
  }

  bot.sendMessage(msg.chat.id, scenes.mainMenu.text, {
    reply_markup: scenes.mainMenu.replyMarkup,
  })
})

async function goToScene(
  replyTo: TelegramBot.Message,
  scene: SceneConfig,
  forceNewMessage = false,
) {
  if (!replyTo.from) return null
  if (forceNewMessage) {
    try {
      const msg = await bot.sendMessage(replyTo.from.id, scene.text, {
        reply_markup: scene.replyMarkup,
      })
      return msg.message_id
    } catch (e) {
      console.error(e)
      return null
    }
  } else {
    try {
      await bot.editMessageText(scene.text, {
        message_id: replyTo.message_id,
        chat_id: replyTo.chat.id,
        reply_markup: scene.replyMarkup,
      })
      return replyTo.message_id
    } catch {
      try {
        const msg = await bot.sendMessage(replyTo.from.id, scene.text, {
          reply_markup: scene.replyMarkup,
        })
        return msg.message_id
      } catch (e) {
        console.error(e)
        return null
      }
    }
  }
}

bot.on('callback_query', async (query) => {
  bot.answerCallbackQuery(query.id)
  if (!query.message) return

  switch (query.data) {
    case 'main':
      userStates.delete(query.from.id)
      await goToScene(query.message, scenes.mainMenu)
      break
    case 'add_tracking':
      userStates.set(query.from.id, { state: 'input_reference_number' })
      await goToScene(query.message, scenes.inputReferenceNumber)
      break
    case 'about':
      userStates.delete(query.from.id)
      await goToScene(query.message, scenes.about)
      break
    default:
      break
  }
})

async function fetchApplicationStatus({
  telegramUserId,
  referenceNumber,
  dateOfBirth,
}: {
  telegramUserId: number
  referenceNumber: string
  dateOfBirth: Date
}) {
  let text: string = ''
  let cacheMiss = true

  const rateLimitForUser = rateLimit.get(telegramUserId)
  if (rateLimitForUser) {
    const rateLimitInterval = 1000 * 60
    const rateLimitLeft = Date.now() - rateLimitForUser
    if (rateLimitLeft < rateLimitInterval) {
      text =
        'Пожалуйста, подождите ' +
        Math.round(rateLimitInterval - rateLimitLeft) +
        ' секунд перед следующим запросом'
      cacheMiss = false
    }
  }

  const cached = cache.get(referenceNumber)
  if (cached) {
    if (Date.now() - cached.updatedAt < 1000 * 60 * 60) {
      text =
        'Статус заявки ' +
        referenceNumber +
        ': ' +
        cached.status +
        '\n\n(обновлено в ' +
        Intl.DateTimeFormat('ru-RU', {
          hour: 'numeric',
          minute: 'numeric',
        }).format(new Date(cached.updatedAt)) +
        ')'
      cacheMiss = false
    }
  }

  if (cacheMiss) {
    try {
      const status = await getApplicationStatus(referenceNumber, dateOfBirth)
      if (status.ok) {
        text = 'Статус заявки ' + referenceNumber + ': ' + status.status
        cache.set(referenceNumber, {
          updatedAt: Date.now(),
          status: status.status,
        })
      } else {
        text = status.error
      }
    } catch (e) {
      console.error(e)
      text = 'Не удалось получить статус заявки ' + referenceNumber
    }
    rateLimit.set(telegramUserId, Date.now())
  }

  const userState = userStates.get(telegramUserId)
  if (!userState || userState.state !== 'loading') return
  if (userState.editMessageId) {
    await bot.editMessageText(text, {
      message_id: userState.editMessageId,
      chat_id: telegramUserId,
    })
  } else {
    await bot.sendMessage(telegramUserId, text)
  }
  userStates.delete(telegramUserId)
}

console.log('Bot is running')
