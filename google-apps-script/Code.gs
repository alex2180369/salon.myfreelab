/**
 * Универсальный приём заявок с сайтов myfreelab в одну Google Таблицу.
 * Подходит для club, psy и salon. Каждая строка помечена сайтом.
 *
 * УСТАНОВКА (один раз, около 5 минут):
 * 1. sheets.google.com -> «Создать» -> пустая таблица. Назовите, например, «Заявки myfreelab».
 * 2. Расширения -> Apps Script. Удалите весь код в редакторе и вставьте этот файл целиком.
 * 3. Нажмите «Сохранить» (значок дискеты).
 * 4. «Развернуть» -> «Новое развёртывание» -> шестерёнка -> «Веб-приложение».
 *    Выполнять от имени: «Я». У кого есть доступ: «Все».
 *    Нажмите «Развернуть» и разрешите доступ к таблице (Google покажет предупреждение,
 *    выберите «Дополнительно» -> «Перейти на страницу…»).
 * 5. Скопируйте «URL веб-приложения», он заканчивается на /exec.
 *    Этот URL нужен для настройки сайтов. Секретом он не является, но не публикуйте его
 *    без нужды: по нему можно присылать заявки.
 *
 * ОБНОВЛЕНИЕ КОДА: после правок -> «Развернуть» -> «Управление развёртываниями» ->
 * карандаш -> версия «Новая версия». URL при этом не меняется.
 *
 * УВЕДОМЛЕНИЯ В TELEGRAM (необязательно). Токен хранится у Google, не на сайте:
 * Apps Script -> «Настройки проекта» (шестерёнка слева) -> «Свойства скрипта» ->
 * добавить TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
 *
 * КАК ЗАБИРАТЬ ЗАЯВКИ: лист «Заявки». Фильтр по колонке «Сайт» отделяет проекты друг от друга.
 * Заявки содержат личные данные, не открывайте таблицу посторонним.
 */

var SHEET_NAME = 'Заявки';
var HEADERS = ['Время', 'Сайт', 'Имя', 'Контакт', 'Детали', 'Комментарий', 'Страница'];

// Эти поля идут в свои колонки, всё остальное попадает в «Детали».
var KNOWN = ['site', 'name', 'contact', 'comment', 'page', 'submittedAtLocal', 'submittedAt', 'website'];
var LABELS = {
  experience: 'Опыт в трейдинге',
  topic: 'С чем пришли',
  shoot: 'Формат съёмки',
  tipAmount: 'Чаевые, ₽',
  status: 'Статус',
  createdAt: 'Создан'
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.website) {
      // Заполнена ловушка для ботов: молча игнорируем.
      return json_({ ok: true });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    }

    var details = detailsOf_(data);
    sheet.appendRow([
      clean_(data.submittedAtLocal) || new Date().toLocaleString('ru-RU'),
      clean_(data.site),
      clean_(data.name),
      clean_(data.contact),
      clean_(details),
      clean_(data.comment),
      clean_(data.page)
    ]);

    notifyTelegram_(data, details);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json_({ ok: true, message: 'Заявки принимаются методом POST' });
}

function detailsOf_(data) {
  var lines = [];
  Object.keys(data).forEach(function (key) {
    if (KNOWN.indexOf(key) !== -1) return;
    var value = data[key];
    if (value === null || value === '' || value === undefined) return;

    if (key === 'items' && Array.isArray(value)) {
      value.forEach(function (it) {
        var line = (it.name || '?') + ' x' + (it.quantity || 1);
        if (it.price) line += ', ' + it.price + ' ₽';
        if (it.comment) line += ' (' + it.comment + ')';
        lines.push(line);
      });
    } else {
      lines.push((LABELS[key] || key) + ': ' + (typeof value === 'object' ? JSON.stringify(value) : value));
    }
  });
  return lines.join('\n');
}

// Защита от формул: значение, начинающееся с = + - @, превращаем в обычный текст.
function clean_(v) {
  var s = String(v == null ? '' : v).slice(0, 2000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function notifyTelegram_(data, details) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  var chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;

  var text = [
    'Новая заявка: ' + (data.site || 'сайт'),
    'Имя: ' + (data.name || '-'),
    'Контакт: ' + (data.contact || '-'),
    details ? details : '',
    data.comment ? 'Комментарий: ' + data.comment : ''
  ].filter(String).join('\n');

  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: text }),
      muteHttpExceptions: true
    });
  } catch (e) {
    // Сбой уведомления не должен ломать запись в таблицу.
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
