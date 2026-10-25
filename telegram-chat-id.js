'use strict';
const fs = require('node:fs');
const path = require('node:path');
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('Сначала скопируйте .env.example в .env и укажите TELEGRAM_BOT_TOKEN.');
  process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
if (!env.TELEGRAM_BOT_TOKEN) {
  console.error('В .env не заполнен TELEGRAM_BOT_TOKEN.');
  process.exit(1);
}
(async () => {
  console.log('Отправьте боту сообщение /start, затем запустите эту команду снова.');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error('Telegram не принял токен. Проверьте его в локальном .env.');
  const chats = new Map();
  for (const update of result.result || []) {
    const message = update.message || update.edited_message;
    if (message?.chat?.id != null) chats.set(String(message.chat.id), message.chat);
  }
  if (!chats.size) {
    console.log('Пока не найдено сообщений. Откройте чат с ботом, нажмите Start и повторите.');
    return;
  }
  console.log('Найденные чаты (токен не выводится):');
  for (const chat of chats.values()) console.log(`${chat.id}\t${chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Telegram chat'}`);
  console.log('Скопируйте ID личного чата в TELEGRAM_CHAT_ID в .env, затем перезапустите node server.js.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
