/* Shared status presentation. Images are the same assets used by borrow.html. */
const EQUIPMENT_STATUS_IMAGES = {
  'C2': 'img/equipment/c2.jpg',
  'High Flow': 'img/equipment/high-flow.jpg',
  'Brid เขียว': 'img/equipment/brid-green.jpg'
};
const EQUIPMENT_STATUS_LABELS = { avail: 'พร้อมใช้', borrowed: 'ยืมอยู่', repair: 'ซ่อม', pending: 'รอเลขครุภัณฑ์', sold: 'จำหน่าย' };
function equipmentStatusEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function equipmentStatusSummary(counts) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return Object.entries(EQUIPMENT_STATUS_LABELS).map(([status, label]) =>
    `<article class="eq-stat eq-${status}"><span class="eq-stat-label"><i class="eq-dot" aria-hidden="true"></i>${label}</span><strong>${counts[status]}</strong><small>เครื่อง · ${total ? Math.round(counts[status] / total * 100) : 0}% ของทั้งหมด</small></article>`
  ).join('');
}
function renderEquipmentStatusGrid(grid, items, type, onBorrowedClick) {
  const esc = equipmentStatusEscape;
  grid.innerHTML = items.map((u, index) => {
    const interactive = u.status === 'borrowed' && !!onBorrowedClick;
    const tag = 'article';
    const location = u.status === 'borrowed' ? u.ward || 'ไม่ระบุหน่วยงาน'
      : u.status === 'repair' ? u.assetStatus
      : u.status === 'pending' ? ASSET_STATUS_WAITING_FOR_NUMBER
      : u.status === 'sold' ? 'จำหน่ายออกจากระบบ' : 'พร้อมสำหรับยืม';
    const image = EQUIPMENT_STATUS_IMAGES[type];
    return `<${tag} class="eq-machine eq-${u.status}">
      <button type="button" class="eq-history-open" data-history-index="${index}" aria-label="ดูประวัติ ${esc(type)} หมายเลข ${esc(u.number)}">
      <div class="eq-machine-heading"><strong>No.${esc(u.number)}</strong><span class="eq-status-badge"><i class="eq-dot" aria-hidden="true"></i>${EQUIPMENT_STATUS_LABELS[u.status]}</span></div>
      <div class="eq-machine-body"><div class="eq-image">${image ? `<img src="${image}" alt="${esc(type)}" loading="lazy" decoding="async">` : '<span>MEMs</span>'}</div><div class="eq-machine-info"><small>${esc(type)}</small><span>${esc(location)}</span></div></div>
      <div class="eq-machine-action">ดูประวัติการยืม–คืน <span aria-hidden="true">→</span></div>
      </button>
      ${interactive ? `<button type="button" class="eq-machine-action eq-circuit-open" data-index="${index}">บันทึกเปลี่ยน Circuit <span aria-hidden="true">→</span></button>` : ''}
    </${tag}>`;
  }).join('');
  grid.querySelectorAll('button[data-history-index]').forEach(button => {
    button.addEventListener('click', () => openEquipmentHistory(type, items[Number(button.dataset.historyIndex)].number));
  });
  grid.querySelectorAll('button[data-index]').forEach(button => {
    button.addEventListener('click', () => onBorrowedClick(items[Number(button.dataset.index)]));
  });
}


function equipmentHistoryRecords(records, type, number) {
  const normalizedType = String(type || '').trim().toLocaleLowerCase('th-TH');
  const no = normalizeMachineNo(number);
  if (!normalizedType || !no) return [];
  return records.filter(record =>
    String(record['ชื่อเครื่อง'] || '').trim().toLocaleLowerCase('th-TH') === normalizedType &&
    normalizeMachineNo(record['หมายเลขเครื่อง']) === no &&
    /ยืม|คืน|ย้าย/.test(String(record['ประเภท (ยืม/คืน)'] || ''))
  ).slice().sort((a, b) =>
    (parseThaiDT(b)?.getTime() || 0) - (parseThaiDT(a)?.getTime() || 0));
}

function openEquipmentHistory(type, number) {
  let dialog = document.getElementById('equipmentHistoryDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'equipmentHistoryDialog';
    dialog.className = 'eq-history-dialog';
    dialog.setAttribute('aria-labelledby', 'equipmentHistoryTitle');
    dialog.innerHTML = '<div class="eq-history-heading"><h2 id="equipmentHistoryTitle"></h2><button type="button" autofocus aria-label="ปิดประวัติ">ปิด ×</button></div><p id="equipmentHistoryCount"></p><div class="table-wrap" id="equipmentHistoryBody" tabindex="0"></div>';
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    document.body.appendChild(dialog);
  }
  const esc = equipmentStatusEscape;
  const records = equipmentHistoryRecords(allRecords, type, number);
  dialog.querySelector('h2').textContent = `ประวัติการยืม–คืน ${type} No.${number}`;
  dialog.querySelector('p').textContent = `ทั้งหมด ${records.length} รายการ · เรียงจากล่าสุด`;
  dialog.querySelector('#equipmentHistoryBody').innerHTML = records.length
    ? `<table><thead><tr><th>วันที่</th><th>เวลา</th><th>รายการ</th><th>หน่วยงาน</th><th>ผู้บันทึก</th><th>หมายเหตุ</th></tr></thead><tbody>${records.map(record => `<tr>
      <td>${esc(fmtDate(record['วันที่']))}</td><td>${esc(fmtTime(record['เวลา']))}</td>
      <td>${esc(classifyAction(record['ประเภท (ยืม/คืน)']).label)}</td><td>${esc(record['ตึก/Ward'])}</td>
      <td>${esc(record['ชื่อผู้ยืม'])}</td><td>${esc(record['หมายเหตุ'])}</td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="empty">ยังไม่มีประวัติการยืม–คืนของเครื่องนี้</div>';
  if (!dialog.open) dialog.showModal();
}
