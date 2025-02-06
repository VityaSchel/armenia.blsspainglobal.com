import prompts from 'prompts'
import fs from 'fs/promises'
import path from 'path'

export async function getCaptchaSolution({
  task,
  panels,
}: {
  task: string
  panels: { id: string; src: string }[]
}): Promise<string[]> {
  await fs.rmdir('captchas', { recursive: true })
  await fs.mkdir('captchas', { recursive: true })
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]
    await fs.writeFile(
      path.join('captchas', i + 1 + '.gif'),
      panel.src.substring('data:image/gif;base64,'.length),
      'base64',
    )
  }
  const response = await prompts({
    type: 'multiselect',
    name: 'panels',
    message: task,
    choices: panels.map((panel, i) => ({
      title: String(i + 1),
      value: panel.id,
    })),
  })
  return response.panels.map((panelId: string) => panelId)
}
