import path from 'path'
import { glob } from 'glob'
import fs from 'fs/promises'
import { $ } from 'bun'

export async function resolveNewIps(pathToOvpn: string) {
  const ovpnDiscoveryDirectory = path.resolve(__dirname, pathToOvpn)

  const ovpnFiles = await glob('*.ovpn', {
    cwd: ovpnDiscoveryDirectory,
  })

  console.log(
    'Found',
    ovpnFiles.length,
    'OpenVPN configuration files in',
    ovpnDiscoveryDirectory,
  )

  const currentIpsResponse =
    await $`dig +short armenia.blsspainglobal.com`.text()
  const currentIps = currentIpsResponse
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  let hasNewIps = false
  for (const ovpnFile of ovpnFiles) {
    const config = await fs.readFile(
      path.resolve(ovpnDiscoveryDirectory, ovpnFile),
      'utf-8',
    )
    const lines = config.split('\n').map((l) => l.trim())
    const start = lines.indexOf('route-nopull')
    const end = lines.indexOf('key-direction 1')
    const linesBetween = lines.slice(start + 1, end)
    const existingIps = linesBetween
      .filter((l) => l.startsWith('route '))
      .map((l) => l.split(' ')[1])
    const missingIps = currentIps.filter((ip) => !existingIps.includes(ip))
    if (missingIps.length > 0) {
      hasNewIps = true
    }
    const newLines = lines.slice(0, start + 1).concat(
      missingIps.map((ip) => `route ${ip} 255.255.255.255`),
      linesBetween,
      lines.slice(end),
    )
    const newConfig = newLines.join('\n')
    await fs.writeFile(
      path.resolve(ovpnDiscoveryDirectory, ovpnFile),
      newConfig,
      'utf-8',
    )
  }

  return hasNewIps
}
