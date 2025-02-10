import { format } from 'date-fns'
import { userAgent } from './consts'
import { JSDOM } from 'jsdom'
import { solveCaptcha } from './captcha'

async function getApplicationPageHTML({
  referenceNumber,
  dateOfBirth,
  captchaId,
}: {
  referenceNumber: string
  dateOfBirth: Date
  captchaId: string
}) {
  const applicationStatusReq = await fetch(
    'https://armenia.blsspainglobal.com/Global/bls/showapplicationstatus?' +
      new URLSearchParams({
        referenceNo: referenceNumber,
        dob: format(dateOfBirth, 'yyyy-MM-dd'),
        captchaId,
      }),
    {
      headers: {
        'User-Agent': userAgent,
      },
    },
  )
  const applicationStatusRes = await applicationStatusReq.text()
  return applicationStatusRes
}

function parseApplicationPageHTML(html: string) {
  const document = new JSDOM(html)
  const content = document.window.document.querySelector(
    '#appWrapper .page-inner > div > div',
  )
  if (!content) {
    throw new Error('Could not parse application page HTML')
  }
  const childNodes = Array.from(content.childNodes)
  if (childNodes.length === 1) {
    const status = childNodes[0].textContent?.trim()
    if (!status) {
      throw new Error('Could not get text error')
    }
    return { ok: false, status }
  }
  if (content.children.length === 0) {
    throw new Error('Could not parse application page HTML')
  }
  const rows = Array.from(content.querySelectorAll('div.row'))
  const fields = new Map<string, string>()
  for (const row of rows) {
    const rowName = row.children[0].textContent?.trim()
    const rowValue = row.children[1].textContent?.trim()
    if (rowName !== undefined && rowValue !== undefined) {
      fields.set(rowName, rowValue)
    }
  }
  const status = fields.get('CurrentStatus')
  if (!status) {
    throw new Error('Could not get CurrentStatus')
  }
  return { ok: true, status }
}

const statuses: { [key: string]: string } = {
  'Application received, payment pending':
    'Заявление получено, ожидается оплата',
  'Processing at mission': 'Рассмотрение в консульстве',
  'Acceda done, Ready for Outscan to Hub': 'Готовится к отправке в Москву',
  'Acceda done': 'Готовится к отправке в Москву',
  'Ready for Outscan to Hub': 'Готовится к отправке в Москву',
  'Intransit from Spoke to HUB': 'В пути из Еревана в Москву',
  'Ready for Outscan to Mission': 'Готовится к отправке в консульство',
  'In transit from BLS to Mission': 'В пути в консульство',
  'Passport ready to dispatch': 'Рассмотрено; в пути из Москвы в Ереван',
  'Dispatched via courie': 'Готово к получению в Ереване',
  'Delivered at Counter': 'Готово к получению в Ереван',
}

const errors: { [key: string]: string } = {
  'Invalid Captch': 'Неверно введена капча',
  'Invalid Captcha': 'Неверно введена капча',
  'Invalid application': 'Неверно указан номер заявления',
  'Date of birth is not correct': 'Неверно указана дата рождения',
}

export async function getApplicationStatus(
  referenceNumber: string,
  dateOfBirth: Date,
  debug = false,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  let captchaId: string
  try {
    captchaId = await solveCaptcha(debug)
  } catch (e) {
    console.error(e)
    return {
      ok: false,
      error:
        'Не удалось решить капчу или сайт BLS перегружен. Попробуйте отправить запрос еще раз позднее.',
    }
  }
  if (debug) {
    console.log('Fetching application status...')
  }
  let applicationPageHTML: string
  try {
    applicationPageHTML = await getApplicationPageHTML({
      referenceNumber,
      dateOfBirth,
      captchaId,
    })
  } catch (e) {
    console.error(e)
    return {
      ok: false,
      error:
        'Не удалось получить статус заявления. Попробуйте отправить запрос еще раз позднее.',
    }
  }
  const result = parseApplicationPageHTML(applicationPageHTML)
  const removableCharacters = /^[a-z]/g
  if (result.ok) {
    const statusTranslated = Object.entries(statuses).find(([key]) => {
      return (
        key.toLowerCase().replaceAll(removableCharacters, '') ===
        result.status.toLowerCase().replaceAll(removableCharacters, '')
      )
    })
    if (statusTranslated) {
      return { ok: true, status: statusTranslated[1] }
    } else {
      return { ok: true, status: result.status }
    }
  } else {
    const errorTranslated = Object.entries(errors).find(([key]) => {
      return (
        key.toLowerCase().replaceAll(removableCharacters, '') ===
        result.status.toLowerCase().replaceAll(removableCharacters, '')
      )
    })
    if (errorTranslated) {
      return { ok: false, error: 'Ошибка: ' + errorTranslated[1] }
    } else {
      return { ok: false, error: 'Неизвестная ошибка: ' + result.status }
    }
  }
}
