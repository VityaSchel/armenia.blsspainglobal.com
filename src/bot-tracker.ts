import TelegramBot from 'node-telegram-bot-api'
import { getApplicationStatus } from './status'
import path from 'path'
import fs from 'fs/promises'
import { formatDistanceStrict } from 'date-fns'
import { ru } from 'date-fns/locale'

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
      dateOfBirth: number
      addedAt: number
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
    if (!line.trim()) continue
    const del1 = line.indexOf('\t')
    const del2 = line.indexOf('\t', del1 + 1)
    const del3 = line.indexOf('\t', del2 + 1)
    const del4 = line.indexOf('\t', del3 + 1)
    const id = Number(line.substring(0, del1))
    const referenceNumber = line.substring(del1 + 1, del2)
    const addedAt = Number(line.substring(del2 + 1, del3))
    const dateOfBirth = Number(line.substring(del3 + 1, del4))
    const name = line.substring(del4 + 1)
    if (!userDb.has(id)) {
      userDb.set(id, { savedApplications: [] })
    }
    userDb
      .get(id)!
      .savedApplications.push({ referenceNumber, addedAt, dateOfBirth, name })
  }
}

await parseDb()

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
        application.addedAt +
        '\t' +
        application.dateOfBirth +
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
  | 'tooManyApplications'
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
const cache = new Map<
  string,
  { dateOfBirth: number; updatedAt: number; status: string }
>()

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
  tooManyApplications: {
    text: 'У вас уже слишком много добавленных заявок. Сначала удалите старые, прежде чем добавлять новые',
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
  about: {
    text: 'О боте:\n\nБота сделал @hlothdev\nОн просуществует до тех пор, пока мне не одобрят визу или не надоест.\nКапчи решают сотни живых людей в реальном времени на сервисе ruCaptcha за деньги из кармана автора бота.\nИсходный код: https://github.com/VityaSchel/armenia.blsspainglobal.com',
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
    text: 'Введите номер для отслеживания в формате EVN12345678',
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
    text: 'Некорректный формат номера для отслеживания. Введите номер для отслеживания в формате EVN12345678. Попробуйте еще раз',
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
        const referenceNumber = msg.text
        if (
          referenceNumberRegex.test(referenceNumber) &&
          referenceNumber.length < 30
        ) {
          const savedApplications = getSavedApplications(msg.from.id)
          if (
            savedApplications.some((a) => a.referenceNumber === referenceNumber)
          ) {
            await goToScene({
              replyTo: msg,
              scene: scenes.applicationMenu,
              forceNewMessage: false,
              additionalButtons: [
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
              ],
            })
            return
          } else {
            userStates.set(msg.from.id, {
              state: 'input_date_of_birth',
              referenceNumber: msg.text,
            })
            await goToScene({
              replyTo: msg,
              scene: scenes.inputDateOfBirth,
              forceNewMessage: true,
            })
          }
        } else {
          await goToScene({
            replyTo: msg,
            scene: scenes.incorrectReferenceNumber,
            forceNewMessage: true,
          })
        }
      } else {
        await goToScene({
          replyTo: msg,
          scene: scenes.incorrectReferenceNumber,
          forceNewMessage: true,
        })
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
          await goToScene({
            replyTo: msg,
            scene: scenes.inputApplicationName,
            forceNewMessage: true,
          })
        } else {
          await goToScene({
            replyTo: msg,
            scene: scenes.incorrectDateOfBirth,
            forceNewMessage: true,
          })
        }
      } else {
        await goToScene({
          replyTo: msg,
          scene: scenes.incorrectDateOfBirth,
          forceNewMessage: true,
        })
      }
      return
    } else if (userState.state === 'input_application_name') {
      if (msg.text && msg.text.length <= 30) {
        userStates.set(msg.from.id, {
          state: 'loading',
          editMessageId: null,
        })
        const messageId = await goToScene({
          replyTo: msg,
          scene: scenes.fetchingApplicationStatus,
          forceNewMessage: true,
        })
        userStates.set(msg.from.id, {
          state: 'loading',
          editMessageId: messageId,
        })
        fetchApplicationStatus({
          name: msg.text.replaceAll('\n', ' '),
          telegramUserId: msg.from.id,
          referenceNumber: userState.referenceNumber,
          dateOfBirth: userState.dateOfBirth,
        })
      } else {
        await goToScene({
          replyTo: msg,
          scene: scenes.incorrectApplicationName,
          forceNewMessage: true,
        })
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

  goToMainMenu(msg, true)
})

async function goToMainMenu(
  message: TelegramBot.Message,
  forceNewMessage: boolean,
  telegramUserId?: number,
) {
  if (!message.from) return
  const savedApplications = getSavedApplications(
    telegramUserId ?? message.from.id,
  )
  await goToScene({
    replyTo: message,
    scene: scenes.mainMenu,
    forceNewMessage,
    additionalButtons: savedApplications.map((a) => [
      {
        text: a.name + ' (' + a.referenceNumber + ')',
        callback_data: 'application_' + a.referenceNumber,
      },
    ]),
  })
}

function getSavedApplications(telegramUserId: number) {
  return userDb.get(telegramUserId)?.savedApplications ?? []
}

async function goToScene({
  replyTo,
  scene,
  forceNewMessage = false,
  additionalButtons,
  telegramUserId,
}: {
  replyTo: TelegramBot.Message
  scene: SceneConfig
  forceNewMessage?: boolean
  additionalButtons?: TelegramBot.InlineKeyboardButton[][]
  telegramUserId?: number
}) {
  if (!replyTo.from) return null
  const replyMarkup: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      ...(additionalButtons ? additionalButtons : []),
      ...(scene.replyMarkup?.inline_keyboard ?? []),
    ],
  }
  if (forceNewMessage) {
    try {
      const msg = await bot.sendMessage(
        telegramUserId ?? replyTo.from.id,
        scene.text,
        {
          reply_markup: replyMarkup,
        },
      )
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
        const msg = await bot.sendMessage(
          telegramUserId ?? replyTo.from.id,
          scene.text,
          {
            reply_markup: replyMarkup,
          },
        )
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
      await goToMainMenu(query.message, false, query.from.id)
      break
    case 'add_tracking': {
      const savedApplication = getSavedApplications(query.from.id)
      if (savedApplication.length >= 5) {
        await goToScene({
          replyTo: query.message,
          scene: scenes.tooManyApplications,
          telegramUserId: query.from.id,
        })
      } else {
        userStates.set(query.from.id, { state: 'input_reference_number' })
        await goToScene({
          replyTo: query.message,
          scene: scenes.inputReferenceNumber,
          telegramUserId: query.from.id,
        })
      }
      break
    }
    case 'about':
      userStates.delete(query.from.id)
      await goToScene({
        replyTo: query.message,
        scene: scenes.about,
        telegramUserId: query.from.id,
      })
      break
    case 'back_to_birthday_date': {
      if (!userState || userState.state !== 'input_application_name') {
        break
      }
      userStates.set(query.from.id, {
        state: 'input_date_of_birth',
        referenceNumber: userState?.referenceNumber ?? '',
      })
      await goToScene({
        replyTo: query.message,
        scene: scenes.inputDateOfBirth,
        telegramUserId: query.from.id,
      })
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
        const referenceNumber = query.data.substring(
          query.data.indexOf('_') + 1,
        )
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
          await goToScene({
            replyTo: query.message,
            scene: scenes.applicationMenu,
            forceNewMessage: false,
            additionalButtons: [
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
            ],
            telegramUserId: query.from.id,
          })
        } else if (query.data.startsWith('status_')) {
          userStates.set(query.from.id, {
            state: 'loading',
            editMessageId: null,
          })
          const messageId = await goToScene({
            replyTo: query.message,
            scene: scenes.fetchingApplicationStatus,
            forceNewMessage: false,
            telegramUserId: query.from.id,
          })
          userStates.set(query.from.id, {
            state: 'loading',
            editMessageId: messageId,
          })
          fetchApplicationStatus({
            name: savedApplication.name,
            telegramUserId: query.from.id,
            referenceNumber: savedApplication.referenceNumber,
            dateOfBirth: new Date(savedApplication.dateOfBirth),
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
            await goToMainMenu(query.message, false, query.from.id)
          }
        }
      }
      break
    }
  }
})

const rateLimitInterval = 1000 * 60
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
    const rateLimitLeft = Date.now() - rateLimitForUser
    if (rateLimitLeft < rateLimitInterval) {
      text =
        'Пожалуйста, подождите ' +
        Math.round((rateLimitInterval - rateLimitLeft) / 1000) +
        ' секунд перед следующим запросом'
      cacheMiss = false
    }
  }

  let saveToApplications = false

  const cached = cache.get(referenceNumber)
  if (cached) {
    if (Date.now() - cached.updatedAt < 1000 * 60 * 60) {
      if (cached.dateOfBirth === dateOfBirth.getTime()) {
        text =
          'Статус заявки ' +
          referenceNumber +
          ': ' +
          cached.status +
          '\n\n(обновлено ' +
          formatDistanceStrict(cached.updatedAt, new Date(), {
            locale: ru,
            addSuffix: true,
          }) +
          ')'
        cacheMiss = false
        saveToApplications = true
      }
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
          dateOfBirth: dateOfBirth.getTime(),
        })
        saveToApplications = true
      } else {
        text = status.error
      }
    } catch (e) {
      console.error(e)
      text = 'Не удалось получить статус заявки ' + referenceNumber
    }
    rateLimit.set(telegramUserId, Date.now())
  }

  if (saveToApplications) {
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
        dateOfBirth: dateOfBirth.getTime(),
        addedAt: Date.now(),
        name: name,
      })
      saveDb()
    }
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

async function scheduledFetchAllApplications() {
  const entries = Array.from(userDb.entries())
  const applications = []
  for (const [telegramUserId, user] of entries) {
    for (const application of user.savedApplications) {
      applications.push({
        name: application.name,
        telegramUserId,
        referenceNumber: application.referenceNumber,
        dateOfBirth: new Date(application.dateOfBirth),
        addedAt: application.addedAt,
      })
    }
  }
  for (let i = 0; i < applications.length; i++) {
    const application = applications[i]
    const { referenceNumber, addedAt, dateOfBirth, name, telegramUserId } =
      application

    const sendResult = async (text: string) => {
      try {
        await bot.sendMessage(
          telegramUserId,
          `Статус заявки ${name} (${referenceNumber}): ` + text,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'Отписаться от этой заявки',
                    callback_data: 'delete_' + application.referenceNumber,
                  },
                ],
              ],
            },
          },
        )
      } catch (e) {
        console.error('Ошибка во время отправки сообщения', e)
        userDb.delete(telegramUserId)
      }
    }

    const cached = cache.get(referenceNumber)
    if (cached) {
      if (Date.now() - cached.updatedAt < 1000 * 60 * 60) {
        await sendResult(cached.status)
        continue
      }
    }

    if (Date.now() - addedAt > 1000 * 60 * 60 * 24 * 60) {
      await bot.sendMessage(
        telegramUserId,
        `Ваша заявка ${name} (${referenceNumber}) была добавлена более 60 дней назад, поэтому она была автоматически удалена из отслеживания. Если вы хотите продолжить отслеживание, добавьте ее заново`,
      )
      userDb.set(telegramUserId, {
        ...userDb.get(telegramUserId)!,
        savedApplications: userDb
          .get(telegramUserId)!
          .savedApplications.filter(
            (a) => a.referenceNumber !== referenceNumber,
          ),
      })
      continue
    }

    const userState = userStates.get(telegramUserId)
    if (userState && userState.state === 'loading') {
      continue
    }

    userStates.set(telegramUserId, {
      state: 'loading',
      editMessageId: null,
    })

    try {
      const status = await getApplicationStatus(referenceNumber, dateOfBirth)
      if (status.ok) {
        cache.set(referenceNumber, {
          updatedAt: Date.now(),
          status: status.status,
          dateOfBirth: dateOfBirth.getTime(),
        })
        await sendResult(status.status)
      } else {
        console.error(
          'Ошибка во время получения статуса',
          status.error,
          new Date().toISOString(),
        )
        userStates.delete(telegramUserId)
        continue
      }
    } catch (e) {
      console.error(e)
      userStates.delete(telegramUserId)
      continue
    }

    userStates.delete(telegramUserId)
  }
}

const nextScheduledFetchAllApplications: Date = new Date()
nextScheduledFetchAllApplications.setHours(12, 0, 0, 0)
nextScheduledFetchAllApplications.setDate(
  nextScheduledFetchAllApplications.getDate() + 1,
)
setInterval(() => {
  if (Date.now() >= nextScheduledFetchAllApplications.getTime()) {
    console.log(
      'Running scheduled fetch all applications...',
      new Date().toISOString(),
    )
    nextScheduledFetchAllApplications.setDate(
      nextScheduledFetchAllApplications.getDate() + 1,
    )
    scheduledFetchAllApplications()
  }
}, 1000 * 60)

console.log('Bot is running')
