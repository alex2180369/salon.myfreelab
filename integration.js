/* Local backend adapter. Serve the menu with `node server.js`; do not open via file://. */
window.adminRequestAdapter = {
  async send(payload) {
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error('Пустой или некорректный запрос');
    }
    const response = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Сервер не принял заявку');
    return result;
  }
};
