import TelegramBot from 'node-telegram-bot-api'
import { getApplicationStatus } from './status'
import path from 'path'
import fs from 'fs/promises'

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
  | {
      state: 'input_application_name'
      referenceNumber: string
      dateOfBirth: Date
    }
  | { state: 'loading'; editMessageId: number | null }
>()

const userDb = new Map<
  number,
  {
    savedApplications: {
      referenceNumber: string
      dateOfBirth: Date
      name: string
    }[]
  }
>()

async function parseDb() {
  let dbFile: string
  try {
    dbFile = await fs.readFile(path.join(__dirname, '../db.txt'), 'utf-8')
  } catch {
    dbFile = ''
  }
  const lines = dbFile.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const del1 = line.indexOf('\t')
    const del2 = line.indexOf('\t', del1 + 1)
    const del3 = line.indexOf('\t', del2 + 1)
    const id = Number(line.substring(0, del1))
    const referenceNumber = line.substring(del1 + 1, del2)
    const dateOfBirth = new Date(line.substring(del2 + 1, del3))
    const name = line.substring(del3 + 1)
    if (!userDb.has(id)) {
      userDb.set(id, { savedApplications: [] })
    }
    userDb
      .get(id)!
      .savedApplications.push({ referenceNumber, dateOfBirth, name })
  }
}

parseDb()

let saveFileLock = false
async function saveDb() {
  if (saveFileLock) return
  saveFileLock = true
  let dbFile = ''
  for (const [id, user] of userDb) {
    for (const application of user.savedApplications) {
      dbFile +=
        id +
        '\t' +
        application.referenceNumber +
        '\t' +
        application.dateOfBirth.toISOString() +
        '\t' +
        application.name +
        '\n'
    }
  }
  await fs.writeFile(path.join(__dirname, '../db.txt'), dbFile)
  saveFileLock = false
}

type Scene =
  | 'mainMenu'
  | 'about'
  | 'inputReferenceNumber'
  | 'incorrectReferenceNumber'
  | 'inputDateOfBirth'
  | 'incorrectDateOfBirth'
  | 'inputApplicationName'
  | 'incorrectApplicationName'
  | 'fetchingApplicationStatus'
  | 'errorWhileFetchingApplicationStatus'
  | 'applicationMenu'

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
  inputApplicationName: {
    text: 'Чтобы вам было удобнее ориентироваться в меню бота, введите название для заявки (например, Ваше имя). Макс. 30 символов',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Назад',
            callback_data: 'back_to_birthday_date',
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
  incorrectApplicationName: {
    text: 'Некорректное имя для заявки. Макс. 30 символов. Попробуйте еще раз',
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: 'Назад',
            callback_data: 'back_to_birthday_date',
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
  applicationMenu: {
    text: 'Выберите действие',
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
}

const referenceNumberRegex = /^EVN\d+$/

bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) {
    return
  }

  const userState = userStates.get(msg.from.id)
  if (userState) {
    if (userState.state === 'input_reference_number') {
      if (msg.text) {
        if (referenceNumberRegex.test(msg.text) && msg.text.length < 30) {
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
          const birthdayDate = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            12,
            0,
            0,
            0,
          )
          userStates.set(msg.from.id, {
            state: 'input_application_name',
            referenceNumber: userState.referenceNumber,
            dateOfBirth: birthdayDate,
          })
          await goToScene(msg, scenes.inputApplicationName, true)
        } else {
          await goToScene(msg, scenes.incorrectDateOfBirth, true)
        }
      } else {
        await goToScene(msg, scenes.incorrectDateOfBirth, true)
      }
      return
    } else if (userState.state === 'input_application_name') {
      if (msg.text && msg.text.length <= 30) {
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
        fetchApplicationStatus({
          name: msg.text,
          telegramUserId: msg.from.id,
          referenceNumber: userState.referenceNumber,
          dateOfBirth: userState.dateOfBirth,
        })
      } else {
        await goToScene(msg, scenes.incorrectApplicationName, true)
      }
    } else if (userState.state === 'loading') {
      userStates.set(msg.from.id, {
        state: 'loading',
        editMessageId: null,
      })
      return
    }
  }

  const savedApplications = getSavedApplications(msg.from.id)
  bot.sendMessage(msg.chat.id, scenes.mainMenu.text, {
    reply_markup: {
      inline_keyboard: [
        ...savedApplications.map((a) => [
          {
            text: a.name + ' (' + a.referenceNumber + ')',
            callback_data: 'application_' + a.referenceNumber,
          },
        ]),
        ...(scenes.mainMenu.replyMarkup?.inline_keyboard ?? []),
      ],
    },
  })
})

function getSavedApplications(telegramUserId: number) {
  return userDb.get(telegramUserId)?.savedApplications ?? []
}

async function goToScene(
  replyTo: TelegramBot.Message,
  scene: SceneConfig,
  forceNewMessage = false,
  additionalButtons?: TelegramBot.InlineKeyboardButton[][],
) {
  if (!replyTo.from) return null
  const replyMarkup: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      ...(scene.replyMarkup?.inline_keyboard ?? []),
      ...(additionalButtons ? additionalButtons : []),
    ],
  }
  if (forceNewMessage) {
    try {
      const msg = await bot.sendMessage(replyTo.from.id, scene.text, {
        reply_markup: replyMarkup,
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
        reply_markup: replyMarkup,
      })
      return replyTo.message_id
    } catch {
      try {
        const msg = await bot.sendMessage(replyTo.from.id, scene.text, {
          reply_markup: replyMarkup,
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

  const userState = userStates.get(query.from.id)
  if (userState && userState.state === 'loading') return

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
    case 'back_to_birthday_date': {
      if (!userState || userState.state !== 'input_application_name') {
        break
      }
      userStates.set(query.from.id, {
        state: 'input_date_of_birth',
        referenceNumber: userState?.referenceNumber ?? '',
      })
      await goToScene(query.message, scenes.inputDateOfBirth)
      break
    }
    case undefined:
      break
    default: {
      if (
        query.data.startsWith('application_') ||
        query.data.startsWith('status_') ||
        query.data.startsWith('delete_')
      ) {
        const referenceNumber = query.data.substring('status_'.length)
        if (!referenceNumberRegex.test(referenceNumber)) {
          break
        }
        const savedApplications = getSavedApplications(query.from.id)
        const savedApplication = savedApplications.find(
          (a) => a.referenceNumber === referenceNumber,
        )
        if (!savedApplication) {
          break
        }
        if (query.data.startsWith('application_')) {
          await goToScene(query.message, scenes.applicationMenu, false, [
            [
              {
                text: 'Проверить статус заявки',
                callback_data: 'status_' + referenceNumber,
              },
            ],
            [
              {
                text: 'Удалить',
                callback_data: 'delete_' + referenceNumber,
              },
            ],
          ])
        } else if (query.data.startsWith('status_')) {
          userStates.set(query.from.id, {
            state: 'loading',
            editMessageId: null,
          })
          const messageId = await goToScene(
            query.message,
            scenes.fetchingApplicationStatus,
            true,
          )
          userStates.set(query.from.id, {
            state: 'loading',
            editMessageId: messageId,
          })
          fetchApplicationStatus({
            name: savedApplication.name,
            telegramUserId: query.from.id,
            referenceNumber: savedApplication.referenceNumber,
            dateOfBirth: savedApplication.dateOfBirth,
          })
        } else if (query.data.startsWith('delete_')) {
          if (!userDb.has(query.from.id)) {
            userDb.set(query.from.id, { savedApplications: [] })
          } else {
            userDb.set(query.from.id, {
              ...userDb.get(query.from.id)!,
              savedApplications: savedApplications.filter(
                (a) => a.referenceNumber !== referenceNumber,
              ),
            })
            saveDb()
            await goToScene(query.message, scenes.mainMenu)
          }
        }
      }
      break
    }
  }
})

async function fetchApplicationStatus({
  name,
  telegramUserId,
  referenceNumber,
  dateOfBirth,
}: {
  name: string
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
        Math.round((rateLimitInterval - rateLimitLeft) / 1000) +
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
        const savedApplications = userDb.get(telegramUserId)?.savedApplications
        if (
          !savedApplications ||
          !savedApplications.some((a) => a.referenceNumber === referenceNumber)
        ) {
          if (!userDb.has(telegramUserId)) {
            userDb.set(telegramUserId, { savedApplications: [] })
          }
          userDb.get(telegramUserId)!.savedApplications.push({
            referenceNumber,
            dateOfBirth,
            name: name,
          })
          saveDb()
        }
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
  const replyMarkup: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: 'Меню',
          callback_data: 'main',
        },
      ],
    ],
  }
  if (userState.editMessageId) {
    await bot.editMessageText(text, {
      message_id: userState.editMessageId,
      chat_id: telegramUserId,
      reply_markup: replyMarkup,
    })
  } else {
    await bot.sendMessage(telegramUserId, text, {
      reply_markup: replyMarkup,
    })
  }
  userStates.delete(telegramUserId)
}

console.log('Bot is running')
