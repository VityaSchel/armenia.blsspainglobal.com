const notificationBotApiKey =
  process.env.TELEGRAM_BOT_VPN_FAIL_NOTIFICATION_API_KEY
if (!notificationBotApiKey) {
  console.error('TELEGRAM_BOT_VPN_FAIL_NOTIFICATION_API_KEY is required')
  process.exit(1)
}

export async function sendVpnFailNotification() {
  await fetch(
    'https://api.telegram.org/bot' + notificationBotApiKey + '/sendMessage',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: 'Рекомендуется сменить VPN бота BLS на продакшене',
      }),
    },
  )
}
