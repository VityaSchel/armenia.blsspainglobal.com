import { JSDOM } from 'jsdom'
import { userAgent } from './consts'
import { getCaptchaSolution } from './captcha-solve'
import cookie from 'cookie'

export async function getCaptchaGenToken() {
  // const dataArg = crypto.randomBytes(80)

  const pageRequest = await fetch(
    'https://armenia.blsspainglobal.com/Global/bls/visaapplicationstatus',
    {
      headers: {
        'User-Agent': userAgent,
      },
    },
  )
  const pageResponse = await pageRequest.text()
  try {
    const dataArg = pageResponse
      .split("win.iframeOpenUrl = '/Global/Captcha/GenerateCaptcha?data=")[1]
      .split("'")[0]
    return decodeURIComponent(dataArg)
  } catch {
    throw new Error(
      'Could not fetch captcha generation token: ' + pageRequest.status,
    )
  }
}

async function getCaptcha(dataArg: string) {
  const captchaRequest = await fetch(
    'https://armenia.blsspainglobal.com/Global/Captcha/GenerateCaptcha?' +
      new URLSearchParams({
        data: dataArg,
      }),
    {
      headers: {
        'User-Agent': userAgent,
      },
    },
  )
  const cookiesHeader = captchaRequest.headers.get('set-cookie')
  if (!cookiesHeader) {
    throw new Error('Could not get cookies from captcha request')
  }
  const cookies = cookie.parse(cookiesHeader)
  const cookieString = Object.entries(cookies)
    .filter(([key]) => key.startsWith('.AspNetCore.Antiforgery'))
    .map(([key, value]) => key + '=' + value)
    .join('; ')
  const captchaResponse = await captchaRequest.text()
  try {
    // const dataArg = captchaResponse
    // return decodeURIComponent(dataArg)
    return { captchaHtml: captchaResponse, cookies: cookieString }
  } catch {
    throw new Error(
      'Could not fetch captcha HTML page: ' + captchaRequest.status,
    )
  }
}

async function parseCaptchaHTML(html: string) {
  const dom = new JSDOM(html)
  const document = dom.window.document
  const tasks = Array.from(document.querySelectorAll('.box-label'))
  let taskText: string | undefined
  for (const task of tasks) {
    const colorOfTask = dom.window
      .getComputedStyle(task)
      .getPropertyValue('color')
    if (colorOfTask === '') {
      taskText = task.textContent?.trim()
      break
    }
  }
  if (!taskText) {
    throw new Error('Could not find captcha task text')
  }

  const captchaId = document
    .querySelector('input[name=Id]')
    ?.getAttribute('value')
  if (!captchaId) {
    throw new Error('Could not find captcha id')
  }
  const requestVerificationToken = document
    .querySelector('input[name=__RequestVerificationToken]')
    ?.getAttribute('value')
  if (!requestVerificationToken) {
    throw new Error('Could not find request verification token')
  }

  const images = document.querySelectorAll('.captcha-img')
  const panelSlots: { id: string; zIndex: number; src: string }[][] = new Array(
    9,
  )
    .fill([])
    .map(() => [])
  for (const image of images) {
    const panelId = image.parentElement?.id
    if (!panelId) {
      throw new Error('Could not find captcha panel id')
    }
    const base64Src = image.getAttribute('src')
    if (!base64Src) {
      throw new Error('Could not find captcha panel src')
    }
    const panelStyles = dom.window.getComputedStyle(image.parentElement)
    if (panelStyles.display === 'none') {
      continue
    }
    const row = parseInt(panelStyles.top) / 110
    const col = parseInt(panelStyles.left) / 110
    panelSlots[row * 3 + col].push({
      id: panelId,
      zIndex: parseInt(panelStyles.zIndex),
      src: base64Src,
    })
  }
  const panels: { id: string; src: string }[] = []
  for (const panelSlot of panelSlots) {
    const panel = panelSlot.sort((a, b) => b.zIndex - a.zIndex)[0]
    if (!panel) {
      throw new Error(
        'Could not find captcha panel: expected 9, got ' +
          panelSlots.reduce((acc, cur) => (acc + cur.length ? 1 : 0), 0),
      )
    }
    panels.push(panel)
  }
  return { taskText, panels, captchaId, requestVerificationToken }
}

async function submitCaptcha({
  selectedPanelsIds,
  captchaId,
  requestVerificationToken,
  cookies,
}: {
  selectedPanelsIds: string[]
  captchaId: string
  requestVerificationToken: string
  cookies: string
  dataArg: string
}) {
  const body = new URLSearchParams({
    SelectedImages: selectedPanelsIds.join(','),
    Id: captchaId,
    __RequestVerificationToken: requestVerificationToken,
    'X-Requested-With': 'XMLHttpRequest',
  }).toString()
  const submitCaptchaRequest = await fetch(
    'https://armenia.blsspainglobal.com/Global/Captcha/SubmitCaptcha',
    {
      body,
      headers: {
        'User-Agent': userAgent,
        Cookie: cookies,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      method: 'POST',
    },
  )
  try {
    const submitCaptchaResponse = (await submitCaptchaRequest.json()) as {
      success: boolean
      captchaId: string
    }
    if (!submitCaptchaResponse.success) {
      throw new Error('Captcha submission failed')
    }
    return submitCaptchaResponse.captchaId
  } catch {
    throw new Error('Could not submit captcha: ' + submitCaptchaRequest.status)
  }
}

export async function solveCaptcha() {
  console.log('[1/5] Generating captcha token...')
  const dataArg = await getCaptchaGenToken()
  console.log('[2/5] Fetching captcha page...')
  const { captchaHtml, cookies } = await getCaptcha(dataArg)
  console.log('[3/5] Parsing captcha page...')
  const { taskText, panels, captchaId, requestVerificationToken } =
    await parseCaptchaHTML(captchaHtml)
  console.log('[4/5] Solving captcha...')
  const selectedPanelsIds = await getCaptchaSolution({ task: taskText, panels })
  console.log('[5/5] Submitting captcha solution...')
  const successCaptchaId = await submitCaptcha({
    selectedPanelsIds,
    captchaId,
    requestVerificationToken,
    cookies,
    dataArg,
  })
  return successCaptchaId
}
