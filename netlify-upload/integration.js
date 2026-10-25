/*
 * Server integration boundary.
 * Replace this adapter only after a real server endpoint and its authorization
 * flow have been configured. Never put YCLIENTS credentials in browser code.
 */
window.adminRequestAdapter = {
  async send(payload) {
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error('Пустой или некорректный запрос');
    }
    // Deliberately no network request: this project has no configured backend.
    return { accepted: false, reason: 'not_configured' };
  }
};
