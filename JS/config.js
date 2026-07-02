(() => {
  const DEFAULT_REMOTE_API_BASE = 'https://hwaolunch.o-r.kr/api';

  const API_BASE_URL = globalThis.LUNCH_CHECK_API_BASE
    || (globalThis.location?.protocol === 'file:' ? DEFAULT_REMOTE_API_BASE : '/api');

  const getTodayStr = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  };

  const isWeekend = (dateStr) => {
    const [year, month, day] = String(dateStr || '').split('-').map(Number);
    if (!year || !month || !day) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekDay = date.getUTCDay();
    return weekDay === 0 || weekDay === 6;
  };

  const normalizePhoneLast4 = (value) => String(value || '').replace(/\D/g, '').slice(-4);

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[ch]));

  globalThis.LunchCheckConfig = Object.freeze({
    API_BASE_URL,
    getTodayStr,
    isWeekend,
    normalizePhoneLast4,
    escapeHTML
  });
})();
