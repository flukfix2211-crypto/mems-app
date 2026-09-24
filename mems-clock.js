/* MEMs Bangkok clock with Thai public-holiday and office-hours status. */
(function () {
  'use strict';
  const zone = 'Asia/Bangkok';
  let holidays = new Set();
  let holidayDataReady = false;
  let timer = 0;

  const format = (locale, options) => new Intl.DateTimeFormat(locale, { timeZone: zone, ...options });
  const thaiDate = format('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const englishDate = format('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = format('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const dateKey = format('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const weekday = format('en-US', { weekday: 'short' });

  function text(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function render() {
    const now = new Date();
    const timeParts = time.format(now).split(':');
    const key = dateKey.format(now);
    const day = weekday.format(now);
    const minutes = Number(timeParts[0]) * 60 + Number(timeParts[1]);
    const weekend = day === 'Sat' || day === 'Sun';
    const publicHoliday = holidays.has(key);
    const inOfficeHours = minutes >= 510 && minutes < 990;

    text('clockDateTh', thaiDate.format(now));
    text('clockDateEn', englishDate.format(now));
    text('clockTime', `${timeParts[0]}:${timeParts[1]}`);
    text('clockSeconds', `:${timeParts[2]}`);

    const status = document.getElementById('clockStatus');
    if (!status) return;
    status.className = 'mems-clock-status';
    if (weekend || publicHoliday) {
      status.classList.add('is-holiday');
      status.textContent = publicHoliday ? 'วันหยุดราชการ · นอกเวลาราชการ' : 'วันหยุดสุดสัปดาห์ · นอกเวลาราชการ';
    } else if (inOfficeHours) {
      status.classList.add('is-working');
      status.textContent = 'วันทำการ · ในเวลาราชการ';
    } else {
      status.classList.add('is-offhours');
      status.textContent = 'วันทำการ · นอกเวลาราชการ';
    }
    if (!holidayDataReady && !weekend) status.title = 'กำลังตรวจสอบวันหยุดราชการไทย';
    else status.removeAttribute('title');
  }

  async function loadHolidays() {
    if (typeof SUPABASE_URL !== 'string' || typeof SUPABASE_ANON_KEY !== 'string') {
      holidayDataReady = true;
      return;
    }
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/thai-holidays`, {
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY }
      });
      if (!response.ok) throw new Error('Holiday service unavailable');
      const data = await response.json();
      holidays = new Set(Array.isArray(data.dates) ? data.dates : []);
    } catch (_error) {
      holidays = new Set();
    } finally {
      holidayDataReady = true;
      render();
    }
  }

  function start() {
    if (!document.getElementById('clock')) return;
    render();
    loadHolidays();
    clearInterval(timer);
    timer = setInterval(render, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  addEventListener('pagehide', () => clearInterval(timer));
})();

