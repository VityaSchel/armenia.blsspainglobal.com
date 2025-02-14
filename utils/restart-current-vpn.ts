import { $ } from 'bun'

export async function restartCurrentVpn() {
  const processes = (await $`pm2 jlist`.json()) as {
    pm2_env: { status: 'stopped' | 'online' }
    pm_id: number
  }[]
  const currentVpn = processes.find((p) => p.pm2_env.status === 'online')
  if (currentVpn) {
    await $`pm2 restart ${currentVpn.pm_id}`
  }
}
