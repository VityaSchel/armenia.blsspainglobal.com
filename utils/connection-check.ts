import { userAgent } from '../consts'

export async function checkIfBlocked() {
  const request = await fetch(
    'https://armenia.blsspainglobal.com/assets/images/logo.png',
    {
      headers: {
        'User-Agent': userAgent,
      },
    },
  )
  const blocked = request.status === 403
  return blocked === true
}
