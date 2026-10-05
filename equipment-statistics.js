const EQUIPMENT_TYPES = ['C2', 'High Flow', 'Bird'];
const RAW_EQUIPMENT_TYPES = ['C2', 'High Flow', 'Brid เขียว', 'Bird'];
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const statsState = {
  view: 'daily', raw: [], assets: [], current: [], sessions: [], anomalies: [],
  selectedMachine: null, exportData: null
};
let statsPdfUrl = '';
let statsPdfName = '';

const byId = id => document.getElementById(id);

function statsEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function normalizeEquipmentType(value) {
  const compact = String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'c2') return 'C2';
  if (compact.includes('highflow')) return 'High Flow';
  if (compact.includes('bird') || compact.includes('brid')) return 'Bird';
  return String(value || '').trim();
}

function isBorrowAction(value) { return String(value || '').includes('ยืม'); }
function isReturnAction(value) { return String(value || '').includes('คืน'); }

function bangkokParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
}

function dateKey(date) {
  const p = bangkokParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function monthKey(date) {
  const p = bangkokParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function dateBounds(value) {
  const [year, month, day] = value.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) - BANGKOK_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86400000) };
}

function monthBounds(value) {
  const [year, month] = value.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - BANGKOK_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - BANGKOK_OFFSET_MS)
  };
}

function fiscalYearFor(date) {
  const p = bangkokParts(date);
  return (p.month >= 10 ? p.year + 1 : p.year) + 543;
}

function fiscalBounds(fiscalYear) {
  const endYear = Number(fiscalYear) - 543;
  return {
    start: new Date(Date.UTC(endYear - 1, 9, 1) - BANGKOK_OFFSET_MS),
    end: new Date(Date.UTC(endYear, 9, 1) - BANGKOK_OFFSET_MS)
  };
}

function fiscalMonths(fiscalYear) {
  const { start } = fiscalBounds(fiscalYear);
  return Array.from({ length: 12 }, (_, index) => {
    const shifted = new Date(start.getTime() + BANGKOK_OFFSET_MS);
    return `${shifted.getUTCFullYear() + Math.floor((shifted.getUTCMonth() + index) / 12)}-${String(((shifted.getUTCMonth() + index) % 12) + 1).padStart(2, '0')}`;
  });
}

function thaiDate(value) {
  const date = typeof value === 'string' ? dateBounds(value).start : value;
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function thaiDateTime(date) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date) + ' น.';
}

function thaiMonth(value) {
  const { start } = monthBounds(value);
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', month: 'long', year: 'numeric' }).format(start);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 ชม.';
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(days + ' วัน');
  if (hours) parts.push(hours + ' ชม.');
  if (!days && minutes) parts.push(minutes + ' นาที');
  return parts.join(' ') || '< 1 นาที';
}

function formatHours(ms) { return (ms / 3600000).toLocaleString('th-TH', { maximumFractionDigits: 1 }); }

function overlapMs(session, start, end) {
  const finish = session.end || new Date();
  return Math.max(0, Math.min(finish.getTime(), end.getTime(), Date.now()) - Math.max(session.start.getTime(), start.getTime()));
}

function sessionize(events) {
  const groups = new Map();
  const sessions = [];
  const anomalies = [];
  events.forEach(event => {
    const key = `${event.type}::${event.no}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  groups.forEach(machineEvents => {
    machineEvents.sort((a, b) => a.ts - b.ts || a.id - b.id);
    let open = null;
    machineEvents.forEach(event => {
      if (event.isBorrow) {
        if (open) anomalies.push({ kind: 'borrow-before-return', event, previous: open });
        open = event;
        return;
      }
      if (!event.isReturn) return;
      if (!open || event.ts <= open.ts) {
        anomalies.push({ kind: 'return-without-borrow', event });
        return;
      }
      sessions.push({
        type: open.type, no: open.no, ward: open.ward, returnWard: event.ward,
        start: open.ts, end: event.ts, completed: true, borrowId: open.id, returnId: event.id
      });
      open = null;
    });
    if (open) sessions.push({
      type: open.type, no: open.no, ward: open.ward, returnWard: '',
      start: open.ts, end: null, completed: false, borrowId: open.id, returnId: null
    });
  });
  sessions.sort((a, b) => b.start - a.start);
  return { sessions, anomalies };
}

function machineKey(type, no) { return `${type}::${normalizeMachineNo(no)}`; }

function filteredSessions(start, end, options = {}) {
  const type = options.type ?? byId('typeSelect').value;
  const ward = options.ward ?? byId('wardSelect').value;
  const no = options.no ?? '';
  return statsState.sessions.filter(session => {
    const finish = session.end || new Date();
    return session.start < end && finish > start &&
      (!type || session.type === type) && (!ward || session.ward === ward) &&
      (!no || session.no.includes(normalizeMachineNo(no)));
  });
}

function blankMetric() {
  return { machines: new Set(), machineDays: new Set(), patients: 0, usageMs: 0, active: 0 };
}

function addMachineDays(metric, session, start, end) {
  let cursor = dateBounds(dateKey(new Date(Math.max(session.start.getTime(), start.getTime())))).start;
  const finish = session.end || new Date();
  while (cursor < end && cursor < finish) {
    const next = new Date(cursor.getTime() + 86400000);
    if (session.start < next && finish > cursor) metric.machineDays.add(`${session.type}:${session.no}:${dateKey(cursor)}`);
    cursor = next;
  }
}

function summarize(sessions, start, end) {
  const metric = blankMetric();
  sessions.forEach(session => {
    metric.machines.add(machineKey(session.type, session.no));
    metric.usageMs += overlapMs(session, start, end);
    if (session.completed && session.start >= start && session.start < end) metric.patients++;
    if (!session.completed) metric.active++;
    addMachineDays(metric, session, start, end);
  });
  return metric;
}

function aggregateWards(start, end) {
  const wardMap = new Map();
  const sessions = filteredSessions(start, end);
  sessions.forEach(session => {
    if (!wardMap.has(session.ward)) wardMap.set(session.ward, Object.fromEntries(EQUIPMENT_TYPES.map(type => [type, blankMetric()])));
    const metric = wardMap.get(session.ward)[session.type];
    metric.machines.add(machineKey(session.type, session.no));
    metric.usageMs += overlapMs(session, start, end);
    if (session.completed && session.start >= start && session.start < end) metric.patients++;
    if (!session.completed) metric.active++;
    addMachineDays(metric, session, start, end);
  });
  return [...wardMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'));
}

function setLoading(loading) {
  byId('refreshBtn').disabled = loading;
  byId('refreshBtn').textContent = loading ? 'กำลังอัปเดต…' : 'อัปเดตข้อมูล';
}

async function loadStatistics() {
  setLoading(true);
  try {
    const [records, assets, current] = await Promise.all([
      fetchAllPages(() => supabase.from('borrow_records')
        .select('id, action, equipment_name, equipment_number, ward, recorded_at')
        .in('equipment_name', RAW_EQUIPMENT_TYPES).order('recorded_at').order('id')),
      fetchAllPages(() => supabase.from('assets').select('no, type, status').in('type', RAW_EQUIPMENT_TYPES).order('type').order('no')),
      fetchAllPages(() => supabase.from('equipment_status')
        .select('equipment_name, equipment_number, ward, recorded_at, is_borrowed')
        .in('equipment_name', RAW_EQUIPMENT_TYPES).order('recorded_at'))
    ]);

    statsState.raw = records.map(row => ({
      id: Number(row.id), type: normalizeEquipmentType(row.equipment_name), no: normalizeMachineNo(row.equipment_number),
      ward: row.ward || 'ไม่ระบุหน่วยงาน', ts: new Date(row.recorded_at),
      isBorrow: isBorrowAction(row.action), isReturn: isReturnAction(row.action)
    })).filter(row => EQUIPMENT_TYPES.includes(row.type) && row.no && !Number.isNaN(row.ts.getTime()) && (row.isBorrow || row.isReturn));
    statsState.assets = assets.map(row => ({ type: normalizeEquipmentType(row.type), no: normalizeMachineNo(row.no), status: row.status || 'ใช้งานได้' }))
      .filter(row => EQUIPMENT_TYPES.includes(row.type) && row.no);
    statsState.current = current.map(row => ({
      type: normalizeEquipmentType(row.equipment_name), no: normalizeMachineNo(row.equipment_number),
      ward: row.ward || '', recordedAt: new Date(row.recorded_at), isBorrowed: Boolean(row.is_borrowed)
    })).filter(row => EQUIPMENT_TYPES.includes(row.type) && row.no);
    const built = sessionize(statsState.raw);
    statsState.sessions = built.sessions;
    statsState.anomalies = built.anomalies;

    buildFilters();
    renderEquipmentStatus();
    renderView();
    byId('lastUpdated').textContent = 'อัปเดตล่าสุด ' + thaiDateTime(new Date());
  } catch (error) {
    console.error(error);
    byId('viewOutput').innerHTML = `<div class="state-panel state-error">โหลดข้อมูลไม่สำเร็จ: ${statsEsc(error.message)}</div>`;
    showToast('โหลดข้อมูลสถิติไม่สำเร็จ');
  } finally {
    setLoading(false);
  }
}

function buildFilters() {
  const years = new Set([fiscalYearFor(new Date())]);
  statsState.raw.forEach(row => years.add(fiscalYearFor(row.ts)));
  const fiscalSelect = byId('fiscalSelect');
  const previousFiscal = fiscalSelect.value;
  fiscalSelect.innerHTML = [...years].sort((a, b) => b - a).map(year => `<option value="${year}">ปีงบประมาณ ${year}</option>`).join('');
  fiscalSelect.value = previousFiscal && years.has(Number(previousFiscal)) ? previousFiscal : String(fiscalYearFor(new Date()));

  const wards = [...new Set(statsState.sessions.map(session => session.ward))].sort((a, b) => a.localeCompare(b, 'th'));
  const previousWard = byId('wardSelect').value;
  byId('wardSelect').innerHTML = '<option value="">ทุกหน่วยงาน</option>' + wards.map(ward => `<option value="${statsEsc(ward)}">${statsEsc(ward)}</option>`).join('');
  byId('wardSelect').value = wards.includes(previousWard) ? previousWard : '';

  rebuildMonthOptions();
  if (!byId('dayInput').value) byId('dayInput').value = dateKey(new Date());
}

function rebuildMonthOptions() {
  const fiscal = Number(byId('fiscalSelect').value || fiscalYearFor(new Date()));
  const current = byId('monthSelect').value;
  const months = fiscalMonths(fiscal);
  byId('monthSelect').innerHTML = months.map(month => `<option value="${month}">${thaiMonth(month)}</option>`).join('');
  const preferred = months.includes(current) ? current : (months.includes(monthKey(new Date())) ? monthKey(new Date()) : months[0]);
  byId('monthSelect').value = preferred;
}

function renderEquipmentStatus() {
  const borrowed = new Map(statsState.current.filter(row => row.isBorrowed).map(row => [machineKey(row.type, row.no), row]));
  byId('equipmentStatusGrid').innerHTML = EQUIPMENT_TYPES.map(type => {
    const items = statsState.assets.filter(asset => asset.type === type);
    const usable = items.filter(asset => asset.status === 'ใช้งานได้').length;
    const repair = items.filter(asset => asset.status === 'ส่งซ่อม' || asset.status === 'ชำรุด').length;
    const active = items.filter(asset => borrowed.has(machineKey(type, asset.no))).length;
    const ready = Math.max(0, usable - active);
    return `<article class="equipment-card equipment-${type.replace(/\s/g, '-').toLowerCase()}">
      <div class="equipment-card-head"><span>${statsEsc(type)}</span><strong>${items.length}</strong></div>
      <div class="equipment-card-grid"><div><b>${active}</b><span>ใช้งานอยู่</span></div><div><b>${ready}</b><span>พร้อมใช้</span></div><div><b>${repair}</b><span>ซ่อม/ชำรุด</span></div></div>
    </article>`;
  }).join('');
  const activeSessions = statsState.sessions.filter(session => !session.completed).length;
  const bar = byId('qualityBar');
  bar.hidden = false;
  bar.innerHTML = `<strong>กติกาข้อมูล:</strong> ยืม–คืนครบ 1 รอบ = ผู้ป่วย 1 ราย <span>•</span> รอบกำลังใช้งาน ${activeSessions.toLocaleString('th-TH')} รอบ <span>•</span> รายการผิดลำดับ ${statsState.anomalies.length.toLocaleString('th-TH')} รายการ`;
}

function selectedTypes() {
  const selected = byId('typeSelect').value;
  return selected ? [selected] : EQUIPMENT_TYPES;
}

function renderMetricCards(items) {
  byId('summaryGrid').innerHTML = items.map(item => `<article><span>${statsEsc(item.label)}</span><strong>${statsEsc(item.value)}</strong><small>${statsEsc(item.unit || '')}</small></article>`).join('');
}

function renderGroupedWardTable(start, end, mode) {
  const rows = aggregateWards(start, end);
  const types = selectedTypes();
  const metricLabel = mode === 'daily' ? 'เครื่อง' : 'เครื่อง-วัน';
  const head1 = `<tr><th rowspan="2">หน่วยงาน</th>${types.map(type => `<th colspan="3" class="type-head type-${type.replace(/\s/g, '-').toLowerCase()}">${statsEsc(type)}</th>`).join('')}</tr>`;
  const head2 = `<tr>${types.map(() => `<th>${metricLabel}</th><th>ผู้ป่วย</th><th>ชม.</th>`).join('')}</tr>`;
  const body = rows.map(([ward, metrics]) => `<tr><td class="ward-cell">${statsEsc(ward)}</td>${types.map(type => {
    const metric = metrics[type];
    const machines = mode === 'daily' ? metric.machines.size : metric.machineDays.size;
    return `<td class="number-cell">${machines}</td><td class="number-cell patient-cell">${metric.patients}</td><td class="number-cell">${formatHours(metric.usageMs)}</td>`;
  }).join('')}</tr>`).join('');
  const totals = types.map(type => {
    const total = blankMetric();
    rows.forEach(([, metrics]) => {
      metrics[type].machines.forEach(key => total.machines.add(key));
      metrics[type].machineDays.forEach(key => total.machineDays.add(key));
      total.patients += metrics[type].patients;
      total.usageMs += metrics[type].usageMs;
    });
    const machines = mode === 'daily' ? total.machines.size : total.machineDays.size;
    return `<td class="number-cell">${machines}</td><td class="number-cell patient-cell">${total.patients}</td><td class="number-cell">${formatHours(total.usageMs)}</td>`;
  }).join('');
  byId('viewOutput').innerHTML = rows.length ? `<table class="stats-data-table"><thead>${head1}${head2}</thead><tbody>${body}</tbody><tfoot><tr><th>รวม</th>${totals}</tr></tfoot></table>` : '<div class="state-panel">ไม่พบการใช้งานในช่วงที่เลือก</div>';
  statsState.exportData = {
    title: mode === 'daily' ? 'สถิติการใช้งานรายวัน' : 'สถิติการใช้งานรายเดือน',
    head: ['หน่วยงาน', ...types.flatMap(type => [`${type} ${metricLabel}`, `${type} ผู้ป่วย`, `${type} ชั่วโมง`])],
    body: rows.map(([ward, metrics]) => [ward, ...types.flatMap(type => {
      const metric = metrics[type];
      return [mode === 'daily' ? metric.machines.size : metric.machineDays.size, metric.patients, formatHours(metric.usageMs)];
    })])
  };
}

function renderDaily() {
  const value = byId('dayInput').value || dateKey(new Date());
  const { start, end } = dateBounds(value);
  const sessions = filteredSessions(start, end);
  const summary = summarize(sessions, start, end);
  byId('viewTitle').textContent = 'สถิติรายวัน';
  byId('viewCaption').textContent = thaiDate(value) + ' · นับเครื่องไม่ซ้ำที่มีการใช้งานในวันนั้น';
  renderMetricCards([
    { label: 'เครื่องที่ใช้งาน', value: summary.machines.size, unit: 'เครื่อง' },
    { label: 'ผู้ป่วยครบวงรอบ', value: summary.patients, unit: 'ราย' },
    { label: 'เวลาใช้งาน', value: formatDuration(summary.usageMs) },
    { label: 'กำลังใช้งาน', value: summary.active, unit: 'รอบ' }
  ]);
  renderGroupedWardTable(start, end, 'daily');
  statsState.exportData.subtitle = thaiDate(value);
}

function renderMonthly() {
  const value = byId('monthSelect').value;
  const { start, end } = monthBounds(value);
  const sessions = filteredSessions(start, end);
  const summary = summarize(sessions, start, end);
  byId('viewTitle').textContent = 'สถิติรายเดือน';
  byId('viewCaption').textContent = thaiMonth(value) + ' · เครื่อง-วัน = ผลรวมจำนวนเครื่องที่มีการใช้งานในแต่ละวัน';
  renderMetricCards([
    { label: 'เครื่องที่ถูกใช้งาน', value: summary.machines.size, unit: 'เครื่อง' },
    { label: 'เครื่อง-วัน', value: summary.machineDays.size, unit: 'เครื่อง-วัน' },
    { label: 'ผู้ป่วยครบวงรอบ', value: summary.patients, unit: 'ราย' },
    { label: 'เวลาใช้งานรวม', value: formatDuration(summary.usageMs) }
  ]);
  renderGroupedWardTable(start, end, 'monthly');
  statsState.exportData.subtitle = thaiMonth(value);
}

function renderFiscal() {
  const fiscal = Number(byId('fiscalSelect').value);
  const { start, end } = fiscalBounds(fiscal);
  const sessions = filteredSessions(start, end);
  const summary = summarize(sessions, start, end);
  byId('viewTitle').textContent = `ปีงบประมาณ ${fiscal}`;
  byId('viewCaption').textContent = `1 ตุลาคม ${fiscal - 1} – 30 กันยายน ${fiscal}`;
  renderMetricCards([
    { label: 'เครื่องที่ถูกใช้งาน', value: summary.machines.size, unit: 'เครื่อง' },
    { label: 'เครื่อง-วัน', value: summary.machineDays.size, unit: 'เครื่อง-วัน' },
    { label: 'ผู้ป่วยครบวงรอบ', value: summary.patients, unit: 'ราย' },
    { label: 'เวลาใช้งานรวม', value: formatDuration(summary.usageMs) }
  ]);
  renderGroupedWardTable(start, end, 'fiscal');
  statsState.exportData.title = `สถิติปีงบประมาณ ${fiscal}`;
  statsState.exportData.subtitle = `1 ตุลาคม ${fiscal - 1} – 30 กันยายน ${fiscal}`;

  const types = selectedTypes();
  const monthRows = fiscalMonths(fiscal).map(month => {
    const bounds = monthBounds(month);
    const row = types.map(type => summarize(filteredSessions(bounds.start, bounds.end, { type }), bounds.start, bounds.end));
    return { month, row };
  });
  const monthlyTable = `<div class="subtable-heading"><h3>แนวโน้ม 12 เดือน</h3><p>ผู้ป่วยและชั่วโมงแยกตามประเภทเครื่อง</p></div><div class="table-scroll"><table class="stats-data-table compact-table"><thead><tr><th>เดือน</th>${types.map(type => `<th>${statsEsc(type)} ผู้ป่วย</th><th>${statsEsc(type)} ชม.</th>`).join('')}</tr></thead><tbody>${monthRows.map(item => `<tr><td class="ward-cell">${thaiMonth(item.month)}</td>${item.row.map(metric => `<td class="number-cell patient-cell">${metric.patients}</td><td class="number-cell">${formatHours(metric.usageMs)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  byId('viewOutput').insertAdjacentHTML('afterend', `<div id="fiscalTrend" class="fiscal-trend">${monthlyTable}</div>`);
}

function currentStatusMap() {
  return new Map(statsState.current.map(row => [machineKey(row.type, row.no), row]));
}

function machineMetrics(type, no, start, end) {
  const sessions = filteredSessions(start, end, { type, ward: byId('wardSelect').value, no }).filter(session => session.type === type && session.no === no);
  return summarize(sessions, start, end);
}

function renderMachine() {
  const fiscal = Number(byId('fiscalSelect').value);
  const fiscalRange = fiscalBounds(fiscal);
  const month = byId('monthSelect').value;
  const monthRange = monthBounds(month);
  const typeFilter = byId('typeSelect').value;
  const noFilter = normalizeMachineNo(byId('machineInput').value);
  const currentMap = currentStatusMap();
  const assetMap = new Map(statsState.assets.map(asset => [machineKey(asset.type, asset.no), asset]));
  const keys = new Set([...assetMap.keys(), ...statsState.sessions.map(session => machineKey(session.type, session.no))]);
  const rows = [...keys].map(key => {
    const [type, no] = key.split('::');
    if ((typeFilter && type !== typeFilter) || (noFilter && !no.includes(noFilter))) return null;
    const current = currentMap.get(key);
    const asset = assetMap.get(key);
    const monthMetric = machineMetrics(type, no, monthRange.start, monthRange.end);
    const fiscalMetric = machineMetrics(type, no, fiscalRange.start, fiscalRange.end);
    if (byId('wardSelect').value && !monthMetric.machines.size && !fiscalMetric.machines.size) return null;
    return { type, no, current, asset, monthMetric, fiscalMetric };
  }).filter(Boolean).sort((a, b) => EQUIPMENT_TYPES.indexOf(a.type) - EQUIPMENT_TYPES.indexOf(b.type) || Number(a.no) - Number(b.no));

  const activeCount = rows.filter(row => row.current?.isBorrowed).length;
  const monthPatients = rows.reduce((sum, row) => sum + row.monthMetric.patients, 0);
  const fiscalUsage = rows.reduce((sum, row) => sum + row.fiscalMetric.usageMs, 0);
  renderMetricCards([
    { label: 'เครื่องตามตัวกรอง', value: rows.length, unit: 'เครื่อง' },
    { label: 'กำลังใช้งาน', value: activeCount, unit: 'เครื่อง' },
    { label: `ผู้ป่วย ${thaiMonth(month)}`, value: monthPatients, unit: 'ราย' },
    { label: `ชั่วโมงปีงบ ${fiscal}`, value: formatDuration(fiscalUsage) }
  ]);
  byId('viewTitle').textContent = 'สถิติรายเครื่อง';
  byId('viewCaption').textContent = `${thaiMonth(month)} และปีงบประมาณ ${fiscal} · กดหมายเลขเครื่องเพื่อดูแต่ละรอบ`;
  byId('viewOutput').innerHTML = rows.length ? `<table class="stats-data-table machine-table"><thead><tr><th>เครื่อง</th><th>สถานะปัจจุบัน</th><th>เดือนนี้</th><th>ชั่วโมงเดือนนี้</th><th>ปีงบประมาณ</th><th>ชั่วโมงปีงบ</th><th></th></tr></thead><tbody>${rows.map(row => {
    const status = row.current?.isBorrowed ? `ใช้งานอยู่ · ${row.current.ward || 'ไม่ระบุวอร์ด'}` : (row.asset?.status || 'พร้อมใช้');
    return `<tr><td><button class="machine-link" type="button" data-machine-type="${statsEsc(row.type)}" data-machine-no="${statsEsc(row.no)}"><span>${statsEsc(row.type)}</span><strong>No.${statsEsc(row.no)}</strong></button></td><td>${statsEsc(status)}</td><td class="number-cell patient-cell">${row.monthMetric.patients} ครั้ง</td><td class="number-cell">${formatDuration(row.monthMetric.usageMs)}</td><td class="number-cell patient-cell">${row.fiscalMetric.patients} ครั้ง</td><td class="number-cell">${formatDuration(row.fiscalMetric.usageMs)}</td><td><button class="detail-btn" type="button" data-machine-type="${statsEsc(row.type)}" data-machine-no="${statsEsc(row.no)}">ดูรอบใช้งาน</button></td></tr>`;
  }).join('')}</tbody></table>` : '<div class="state-panel">ไม่พบเครื่องตามตัวกรอง</div>';
  statsState.exportData = {
    title: 'สถิติรายเครื่อง', subtitle: `${thaiMonth(month)} · ปีงบประมาณ ${fiscal}`,
    head: ['ประเภท', 'No.', 'สถานะ', 'เดือนนี้ (ครั้ง)', 'เดือนนี้ (ชั่วโมง)', 'ปีงบ (ครั้ง)', 'ปีงบ (ชั่วโมง)'],
    body: rows.map(row => [row.type, row.no, row.current?.isBorrowed ? `ใช้งานอยู่ ${row.current.ward || ''}` : (row.asset?.status || 'พร้อมใช้'), row.monthMetric.patients, formatHours(row.monthMetric.usageMs), row.fiscalMetric.patients, formatHours(row.fiscalMetric.usageMs)])
  };
  if (statsState.selectedMachine) showMachineDetail(statsState.selectedMachine.type, statsState.selectedMachine.no);
  else byId('machineDetail').hidden = true;
}

function showMachineDetail(type, no) {
  statsState.selectedMachine = { type, no };
  const fiscal = Number(byId('fiscalSelect').value);
  const { start, end } = fiscalBounds(fiscal);
  const sessions = statsState.sessions.filter(session => session.type === type && session.no === no && session.start < end && (session.end || new Date()) > start);
  const detail = byId('machineDetail');
  detail.hidden = false;
  detail.innerHTML = `<div class="machine-detail-head"><div><span>${statsEsc(type)}</span><h3>No.${statsEsc(no)} — รอบใช้งานปีงบประมาณ ${fiscal}</h3></div><button type="button" id="closeMachineDetail" aria-label="ปิดรายละเอียด">×</button></div>
    <div class="table-scroll"><table class="stats-data-table"><thead><tr><th>ครั้ง</th><th>หน่วยงาน</th><th>เริ่มยืม</th><th>คืน</th><th>ระยะเวลา</th><th>สถานะ</th></tr></thead><tbody>${sessions.length ? sessions.map((session, index) => `<tr><td>${index + 1}</td><td class="ward-cell">${statsEsc(session.ward)}</td><td>${thaiDateTime(session.start)}</td><td>${session.end ? thaiDateTime(session.end) : '—'}</td><td class="number-cell">${formatDuration(overlapMs(session, session.start, session.end || new Date()))}</td><td><span class="status-badge ${session.completed ? 'is-complete' : 'is-active'}">${session.completed ? 'คืนแล้ว · ผู้ป่วย 1 ราย' : 'กำลังใช้งาน'}</span></td></tr>`).join('') : '<tr><td colspan="6">ไม่พบประวัติในปีงบประมาณนี้</td></tr>'}</tbody></table></div>`;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  byId('closeMachineDetail').addEventListener('click', () => { detail.hidden = true; statsState.selectedMachine = null; });
}

function renderView() {
  byId('fiscalTrend')?.remove();
  byId('machineDetail').hidden = statsState.view !== 'machine';
  document.querySelectorAll('.view-filter').forEach(field => { field.hidden = !field.dataset.views.split(' ').includes(statsState.view); });
  document.querySelectorAll('.stats-tab').forEach(tab => {
    const active = tab.dataset.view === statsState.view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  if (!statsState.sessions.length && !statsState.assets.length) return;
  if (statsState.view === 'daily') renderDaily();
  else if (statsState.view === 'monthly') renderMonthly();
  else if (statsState.view === 'fiscal') renderFiscal();
  else renderMachine();
  const enabled = Boolean(statsState.exportData?.body?.length);
  byId('pdfBtn').disabled = !enabled;
  byId('csvBtn').disabled = !enabled;
}

function exportCsv() {
  const data = statsState.exportData;
  if (!data?.body?.length) return;
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [[data.title], [data.subtitle || ''], [], data.head, ...data.body];
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MEMs_Statistics_${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportPdf() {
  const data = statsState.exportData;
  if (!data?.body?.length) return;
  const button = byId('pdfBtn');
  button.disabled = true;
  button.textContent = 'กำลังสร้าง PDF…';
  try {
    const doc = await newThaiPdf({ orientation: 'landscape' });
    const generatedAt = thaiDateTime(new Date());
    const y = rptPdfHeader(doc, data.title, data.subtitle || 'สถิติการใช้เครื่องช่วยหายใจ', generatedAt);
    thaiTable(doc, {
      startY: y, head: [data.head], body: data.body,
      styles: { fontSize: data.head.length > 9 ? 8.5 : 10 },
      margin: { top: 55 },
      didDrawPage: tableData => { if (tableData.pageNumber > 1) rptPdfContinuationHeader(doc, data.title); }
    });
    rptPdfFooter(doc);
    await rptDeliverPdf(doc, `MEMs_Equipment_Statistics_${Date.now()}.pdf`, { preview: true });
  } catch (error) {
    console.error(error);
    showToast('สร้าง PDF ไม่สำเร็จ: ' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'พรีวิว PDF';
  }
}

window.memsOpenPdfPreview = function(blob, filename) {
  if (statsPdfUrl) URL.revokeObjectURL(statsPdfUrl);
  statsPdfUrl = URL.createObjectURL(blob);
  statsPdfName = filename || 'MEMs_Statistics.pdf';
  byId('pdfPreviewFilename').textContent = statsPdfName;
  byId('pdfPreviewFrame').src = statsPdfUrl;
  byId('pdfPreviewModal').hidden = false;
  document.body.classList.add('pdf-preview-open');
  document.querySelector('.pdf-preview-close').focus();
};

function closePdfPreview() {
  byId('pdfPreviewModal').hidden = true;
  document.body.classList.remove('pdf-preview-open');
  byId('pdfPreviewFrame').src = 'about:blank';
  if (statsPdfUrl) URL.revokeObjectURL(statsPdfUrl);
  statsPdfUrl = '';
}

function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

function bindStatisticsEvents() {
  byId('refreshBtn').addEventListener('click', loadStatistics);
  document.querySelectorAll('.stats-tab').forEach(tab => tab.addEventListener('click', () => { statsState.view = tab.dataset.view; renderView(); }));
  ['dayInput', 'monthSelect', 'typeSelect', 'wardSelect'].forEach(id => byId(id).addEventListener('change', renderView));
  byId('fiscalSelect').addEventListener('change', () => { rebuildMonthOptions(); renderView(); });
  byId('machineInput').addEventListener('input', renderView);
  byId('pdfBtn').addEventListener('click', exportPdf);
  byId('csvBtn').addEventListener('click', exportCsv);
  byId('viewOutput').addEventListener('click', event => {
    const button = event.target.closest('[data-machine-type][data-machine-no]');
    if (button) showMachineDetail(button.dataset.machineType, button.dataset.machineNo);
  });
  document.querySelectorAll('[data-close-pdf]').forEach(button => button.addEventListener('click', closePdfPreview));
  byId('pdfPreviewModal').addEventListener('click', event => { if (event.target.id === 'pdfPreviewModal') closePdfPreview(); });
  byId('printPdfBtn').addEventListener('click', () => { const frame = byId('pdfPreviewFrame'); if (frame.src !== 'about:blank') { frame.contentWindow.focus(); frame.contentWindow.print(); } });
  byId('downloadPdfBtn').addEventListener('click', () => { if (!statsPdfUrl) return; const link = document.createElement('a'); link.href = statsPdfUrl; link.download = statsPdfName; link.click(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !byId('pdfPreviewModal').hidden) closePdfPreview(); });
}

window.addEventListener('DOMContentLoaded', async () => {
  bindStatisticsEvents();
  const profile = await memsGuard('dashboard');
  if (profile) loadStatistics();
});
