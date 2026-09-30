/* Shared status presentation. Images are the same assets used by borrow.html. */
const EQUIPMENT_STATUS_IMAGES = {
  'C2': 'img/equipment/c2.jpg',
  'High Flow': 'img/equipment/high-flow.jpg',
  'Brid เขียว': 'img/equipment/brid-green.jpg'
};
const EQUIPMENT_STATUS_LABELS = { avail: 'พร้อมใช้', borrowed: 'ยืมอยู่', repair: 'ซ่อม', sold: 'จำหน่าย' };
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
    const tag = interactive ? 'button' : 'article';
    const location = u.status === 'borrowed' ? u.ward || 'ไม่ระบุหน่วยงาน'
      : u.status === 'repair' ? u.assetStatus : u.status === 'sold' ? 'จำหน่ายออกจากระบบ' : 'พร้อมสำหรับยืม';
    const image = EQUIPMENT_STATUS_IMAGES[type];
    return `<${tag} class="eq-machine eq-${u.status}" ${interactive ? `type="button" data-index="${index}" title="บันทึกการเปลี่ยน Circuit"` : ''}>
      <div class="eq-machine-heading"><strong>No.${esc(u.number)}</strong><span class="eq-status-badge"><i class="eq-dot" aria-hidden="true"></i>${EQUIPMENT_STATUS_LABELS[u.status]}</span></div>
      <div class="eq-machine-body"><div class="eq-image">${image ? `<img src="${image}" alt="${esc(type)}" loading="lazy" decoding="async">` : '<span>MEMs</span>'}</div><div class="eq-machine-info"><small>${esc(type)}</small><span>${esc(location)}</span></div></div>
      ${interactive ? '<div class="eq-machine-action">บันทึกเปลี่ยน Circuit <span aria-hidden="true">→</span></div>' : ''}
    </${tag}>`;
  }).join('');
  grid.querySelectorAll('button[data-index]').forEach(button => {
    button.addEventListener('click', () => onBorrowedClick(items[Number(button.dataset.index)]));
  });
}
