/*
 * Server integration boundary.
 * Статическая витрина салона отправляет запрос гостя в Google Таблицу
 * через Google Apps Script (см. google-apps-script/Code.gs).
 *
 * Пока адрес пустой, запрос никуда не уходит, и меню показывает
 * сообщение, что это демонстрационная версия.
 * Никогда не помещайте в код страницы секреты (токены, ключи YCLIENTS).
 */
window.adminRequestAdapter = {
  SHEETS_URL: '',

  async send(payload) {
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error('Пустой или некорректный запрос');
    }
    if (!this.SHEETS_URL) {
      return { accepted: false, reason: 'not_configured' };
    }

    var body = Object.assign({}, payload, {
      site: 'salon.myfreelab.ru',
      page: window.location.href,
      submittedAtLocal: new Date().toLocaleString('ru-RU')
    });

    // text/plain, чтобы браузер не делал предварительный CORS-запрос: Apps Script его не обрабатывает.
    var response = await fetch(this.SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    return { accepted: true };
  }
};
