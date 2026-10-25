'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'requests.sqlite');
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 64 * 1024;
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadLocalEnv();

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    total INTEGER NOT NULL DEFAULT 0,
    tip_amount INTEGER,
    comment TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS request_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price INTEGER,
    comment TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS requests_customer_date ON requests(customer_id, created_at DESC);
`);

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };
const statuses = new Set(['new', 'accepted', 'completed', 'cancelled']);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY) { reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(Object.assign(new Error('Некорректный JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function normalizePhone(value) { return String(value || '').replace(/\D/g, ''); }
function safeText(value, limit = 500) { return String(value || '').trim().slice(0, limit); }
function telegramReady() { return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID); }
async function notifyTelegram(request) {
  if (!telegramReady()) return false;
  const lines = [
    `Новая заявка №${request.id}`,
    `Клиент: ${request.customer.name}`,
    `Телефон: ${request.customer.phone}`,
    '',
    ...request.items.map(item => `• ${item.name} × ${item.quantity} — ${item.price == null ? 'цена уточняется' : `${item.price * item.quantity} ₽`}${item.comment ? ` (${item.comment})` : ''}`),
    '', `Сумма: ${request.total} ₽`,
    `Предыдущих заявок: ${request.customer.previousRequests}`,
  ];
  if (request.comment) lines.push('', `Комментарий: ${request.comment}`);
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: lines.join('\n') }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error('Telegram API rejected the message');
  return true;
}

function requestDetails(id) {
  const row = db.prepare(`SELECT r.id, r.created_at AS createdAt, r.status, r.total, r.tip_amount AS tipAmount, r.comment,
    c.id AS customerId, c.name AS customerName, c.phone AS customerPhone,
    (SELECT COUNT(*) FROM requests old WHERE old.customer_id=c.id AND old.id<r.id) AS previousRequests
    FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=?`).get(id);
  if (!row) return null;
  const items = db.prepare('SELECT item_name AS name, item_type AS type, quantity, price, comment FROM request_items WHERE request_id=? ORDER BY id').all(id);
  const history = db.prepare(`SELECT r.id, r.created_at AS createdAt, r.status, r.total,
    (SELECT group_concat(item_name || ' × ' || quantity, ', ') FROM request_items WHERE request_id=r.id) AS summary
    FROM requests r WHERE r.customer_id=? AND r.id<? ORDER BY r.id DESC LIMIT 5`).all(row.customerId, id);
  return { id: row.id, createdAt: row.createdAt, status: row.status, total: row.total, tipAmount: row.tipAmount,
    comment: row.comment, items, customer: { id: row.customerId, name: row.customerName, phone: row.customerPhone, previousRequests: row.previousRequests, history } };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, telegramConfigured: telegramReady() });
  if (url.pathname === '/api/requests' && req.method === 'POST') {
    const body = await readBody(req);
    const customerName = safeText(body.customer?.name, 80);
    const phone = normalizePhone(body.customer?.phone);
    if (customerName.length < 2) return send(res, 400, { error: 'Укажите имя клиента (не менее двух символов).' });
    if (phone.length < 10 || phone.length > 15) return send(res, 400, { error: 'Проверьте номер телефона: нужно от 10 до 15 цифр.' });
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40) return send(res, 400, { error: 'В заявке должно быть от 1 до 40 позиций.' });
    const items = body.items.map(item => ({
      name: safeText(item.name, 120), type: safeText(item.type, 20), quantity: Math.max(1, Math.min(20, Math.floor(Number(item.quantity) || 1))),
      price: item.price == null ? null : Math.max(0, Math.floor(Number(item.price) || 0)), comment: safeText(item.comment, 500),
    }));
    if (items.some(item => !item.name || !['drink','service','product','tip'].includes(item.type))) return send(res, 400, { error: 'В заявке есть некорректная позиция.' });
    const createdAt = new Date().toISOString();
    const total = items.reduce((sum, item) => sum + (item.price == null ? 0 : item.price * item.quantity), 0);
    let requestId, customerId, previousRequests;
    db.exec('BEGIN IMMEDIATE');
    try {
      let customer = db.prepare('SELECT id, name FROM customers WHERE phone=?').get(phone);
      if (customer) {
        customerId = customer.id;
        previousRequests = db.prepare('SELECT COUNT(*) AS count FROM requests WHERE customer_id=?').get(customerId).count;
        db.prepare('UPDATE customers SET name=?, last_seen=? WHERE id=?').run(customerName, createdAt, customerId);
      } else {
        const result = db.prepare('INSERT INTO customers(name, phone, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(customerName, phone, createdAt, createdAt);
        customerId = Number(result.lastInsertRowid); previousRequests = 0;
      }
      const inserted = db.prepare('INSERT INTO requests(customer_id, created_at, total, tip_amount, comment) VALUES (?, ?, ?, ?, ?)')
        .run(customerId, createdAt, total, body.tipAmount == null ? null : Math.max(0, Math.floor(Number(body.tipAmount) || 0)), safeText(body.comment, 2000));
      requestId = Number(inserted.lastInsertRowid);
      const insertItem = db.prepare('INSERT INTO request_items(request_id, item_name, item_type, quantity, price, comment) VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of items) insertItem.run(requestId, item.name, item.type, item.quantity, item.price, item.comment);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const request = requestDetails(requestId);
    let telegramSent = false, telegramError = '';
    try { telegramSent = await notifyTelegram(request); }
    catch (error) { telegramError = error.message; console.error('Telegram notification failed:', telegramError); }
    return send(res, 201, { accepted: true, requestId, telegramSent, telegramConfigured: telegramReady(), telegramError: telegramError ? 'Не удалось отправить Telegram-уведомление; заявка сохранена в базе.' : undefined, customer: { previousRequests } });
  }
  if (url.pathname === '/api/requests' && req.method === 'GET') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const ids = db.prepare('SELECT id FROM requests ORDER BY id DESC LIMIT ?').all(limit);
    return send(res, 200, { requests: ids.map(row => requestDetails(row.id)), telegramConfigured: telegramReady() });
  }
  const statusMatch = url.pathname.match(/^\/api\/requests\/(\d+)\/status$/);
  if (statusMatch && req.method === 'PATCH') {
    const body = await readBody(req); const status = safeText(body.status, 20);
    if (!statuses.has(status)) return send(res, 400, { error: 'Недопустимый статус.' });
    const result = db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, Number(statusMatch[1]));
    if (!result.changes) return send(res, 404, { error: 'Заявка не найдена.' });
    return send(res, 200, { accepted: true });
  }
  if (req.method !== 'GET') return send(res, 404, { error: 'Маршрут не найден.' });
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;
  let filePath;
  try { filePath = path.resolve(ROOT, `.${decodeURIComponent(requestPath)}`); } catch { return send(res, 400, { error: 'Некорректный путь.' }); }
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.startsWith(`data${path.sep}`) || ['server.js','.env','.env.example'].includes(relative)) return send(res, 404, { error: 'Файл не найден.' });
  fs.readFile(filePath, (error, content) => {
    if (error) return send(res, 404, { error: 'Файл не найден.' });
    send(res, 200, content, mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Внутренняя ошибка сервера.' });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`Maison de beauté: http://127.0.0.1:${PORT}  |  Админ: http://127.0.0.1:${PORT}/admin`));

function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
