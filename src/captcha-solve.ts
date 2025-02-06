import { createCanvas, loadImage } from 'canvas'
/** MANUAL SOLVING: */
import prompts from 'prompts'
import fs from 'fs/promises'

export async function getCaptchaSolution({
  task,
  panels,
}: {
  task: string
  panels: { id: string; src: string }[]
}): Promise<string[]> {
  const gridImage = await drawGrid({ panels: panels.map((panel) => panel.src) })
  const panelsSelection = await getPanelsSelection({ task, gridImage })
  return panelsSelection.map((panelIndex) => {
    const selectedPanel = panels[panelIndex - 1]
    if (!selectedPanel) {
      throw new Error('Could not find selected panel by captcha solver')
    }
    return selectedPanel.id
  })
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
  return canvas.toDataURL()
}

async function getPanelsSelection({
  task,
  gridImage,
}: {
  task: string
  gridImage: string
}): Promise<number[]> {
  /** MANUAL SOLVING: */
  await fs.writeFile(
    'captcha.png',
    gridImage.substring('data:image/png;base64,'.length),
    'base64',
  )
  const response = await prompts({
    type: 'multiselect',
    name: 'panels',
    message: task,
    choices: new Array(9).fill('').map((_, i) => ({
      title: String(i + 1),
      value: i + 1,
    })),
  })
  return response.panels.map((panelId: number) => panelId)

  // await fetch('https://api.rucaptcha.com/createTask', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     clientKey: 'YOUR_API_KEY',
  //     task: {
  //       type: 'GridTask',
  //       body: '',
  //       comment: task,
  //       rows: 3,
  //       columns: 3,
  //     },
  //   }),
  // })
}
