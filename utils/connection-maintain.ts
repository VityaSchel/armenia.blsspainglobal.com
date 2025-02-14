import { checkIfBlocked } from './connection-check'
import yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import { resolveNewIps } from './ovpn-ip-fixer'
import { restartCurrentVpn } from './restart-current-vpn'
import { sendVpnFailNotification } from './fail-notification'

const argv = await yargs(hideBin(process.argv))
  .positional('path-to-ovpn', {
    describe:
      'Path to the directory containing the OpenVPN configuration files',
    type: 'string',
    demandOption: true,
  })
  .parse()

if (!argv.pathToOvpn) {
  console.error('--path-to-ovpn is required')
  process.exit(1)
}

const isBlocked = await checkIfBlocked()
if (isBlocked) {
  const hasNewIps = await resolveNewIps(argv.pathToOvpn)
  if (hasNewIps) {
    await restartCurrentVpn()
    await new Promise((resolve) => setTimeout(resolve, 15 * 1000))
    const isBlocked = await checkIfBlocked()
    if (isBlocked) {
      await sendVpnFailNotification()
    }
  } else {
    await sendVpnFailNotification()
  }
}
