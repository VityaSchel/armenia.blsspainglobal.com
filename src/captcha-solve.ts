import { createCanvas, loadImage } from 'canvas'
/** MANUAL SOLVING: */
// import prompts from 'prompts'
// import fs from 'fs/promises'

const RUCAPTCHA_KEY = process.env.RUCAPTCHA_API_KEY
if (!RUCAPTCHA_KEY) {
  throw new Error('Вы не указали RUCAPTCHA_API_KEY в .env файле')
}

export async function getCaptchaSolution({
  task,
  panels,
}: {
  task: string
  panels: { id: string; src: string }[]
}): Promise<{ selection: string[]; rucaptchaTaskId: number | null }> {
  const gridImage = await drawGrid({ panels: panels.map((panel) => panel.src) })
  const { solution, taskId } = await getPanelsSelection({ task, gridImage })
  return {
    selection: solution.map((panelIndex) => {
      const selectedPanel = panels[panelIndex - 1]
      if (!selectedPanel) {
        throw new Error('Could not find selected panel by captcha solver')
      }
      return selectedPanel.id
    }),
    rucaptchaTaskId: taskId,
  }
}

const gridSize = 1000
async function drawGrid({ panels }: { panels: string[] }) {
  const canvas = createCanvas(gridSize, gridSize)
  const ctx = canvas.getContext('2d')
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]
    const image = await loadImage(panel)
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = col * (gridSize / 3)
    const y = row * (gridSize / 3)
    ctx.drawImage(image, x, y, gridSize / 3, gridSize / 3)
  }
  return canvas.toDataURL('image/jpeg')
}

async function getPanelsSelection({
  task,
  gridImage,
}: {
  task: string
  gridImage: string
}): Promise<{ solution: number[]; taskId: number | null }> {
  /** MANUAL SOLVING: */
  // await fs.writeFile(
  //   'captcha.png',
  //   gridImage.substring('data:image/png;base64,'.length),
  //   'base64',
  // )
  // const response = await prompts({
  //   type: 'multiselect',
  //   name: 'panels',
  //   message: task,
  //   choices: new Array(9).fill('').map((_, i) => ({
  //     title: String(i + 1),
  //     value: i + 1,
  //   })),
  // })
  // return { solution: response.panels.map((panelId: number) => panelId), taskId: null }

  const response = (await fetch('https://api.rucaptcha.com/createTask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientKey: RUCAPTCHA_KEY,
      task: {
        type: 'GridTask',
        body: gridImage,
        comment: task,
        rows: 3,
        columns: 3,
      },
    }),
  }).then((res) => res.json())) as { taskId: number }
  await new Promise((resolve) => setTimeout(resolve, 5000))
  const solution = await waitForSolution(response.taskId)
  return { solution, taskId: response.taskId }
}

async function waitForSolution(taskId: number) {
  const response = (await fetch('https://api.rucaptcha.com/getTaskResult', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientKey: RUCAPTCHA_KEY,
      taskId,
    }),
  }).then((res) => res.json())) as
    | {
        errorId: 0
        status: 'processing'
      }
    | {
        errorId: 0
        status: 'ready'
        solution: {
          click: number[]
        }
      }
    | {
        errorId: number
        errorCode: string
      }
  if ('errorCode' in response) {
    console.error('RuCaptcha error: ' + response.errorCode)
    throw new Error('RuCaptcha error')
  }
  if (response.status === 'processing') {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    return await waitForSolution(taskId)
  } else if (response.status === 'ready') {
    return response.solution.click
  } else {
    console.error('RuCaptcha unknown status ' + response)
    throw new Error('RuCaptcha error')
  }
}

export async function reportSolutionResult(taskId: number, isValid: boolean) {
  await fetch(
    'https://api.rucaptcha.com/' +
      (isValid ? 'reportCorrect' : 'reportIncorrect'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientKey: RUCAPTCHA_KEY,
        taskId,
      }),
    },
  )
}
