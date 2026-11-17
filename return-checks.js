/* Physical receipt confirmation in the preparation workspace. */
let memsReturnChecksLoading = false;
async function memsLoadReturnChecks() {
  if (memsReturnChecksLoading) return;
  memsReturnChecksLoading = true;
  const list = document.getElementById('returnChecksList');
  const refresh = document.getElementById('refreshReturnChecks');
  refresh.disabled = true;
  list.textContent = 'กำลังโหลดรายการรอตรวจรับ…';
  try {
    const enabled = await fetchReturnReceiptEnabled();
    document.querySelector('.return-check-card').hidden = !enabled;
    if (!enabled) return;
    const rows = await fetchPendingEquipmentReturns();
    rows.sort((a, b) => Date.parse(a.record.recorded_at) - Date.parse(b.record.recorded_at) || Number(a.return_id) - Number(b.return_id));
    document.getElementById('returnChecksCount').textContent = `(${rows.length} เครื่อง)`;
    list.replaceChildren();
    if (!rows.length) list.textContent = 'ไม่มีเครื่องรอตรวจและยืนยันการคืน';
    rows.forEach(row => {
      const record = row.record;
      const item = document.createElement('div');
      item.className = 'return-check-item';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${record.equipment_name} No.${record.equipment_number}`;
      const meta = document.createElement('p');
      const when = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.recorded_at));
      meta.textContent = `หน่วยงาน ${record.ward} · ผู้แจ้งคืน ${record.staff_name} · ${when}`;
      details.append(title, meta);
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'mode-btn';
      confirm.textContent = 'ตรวจและยืนยันการคืนเครื่อง';
      confirm.addEventListener('click', () => memsOpenReturnCheck(row, confirm));
      item.append(details, confirm);
      list.append(item);
    });
  } catch (error) {
    document.getElementById('returnChecksCount').textContent = '';
    list.textContent = 'โหลดรายการไม่สำเร็จ: ' + (error.message || error) + ' กรุณากดรีเฟรชรายการ';
  } finally {
    refresh.disabled = false;
    memsReturnChecksLoading = false;
  }
}
function memsOpenReturnCheck(row, opener) {
  const dialog = document.createElement('dialog');
  dialog.className = 'lifecycle-return-confirm return-check-dialog';
  dialog.setAttribute('aria-labelledby', 'returnCheckDialogTitle');
  dialog.innerHTML = `<form><h2 id="returnCheckDialogTitle">ยืนยันการรับคืนเครื่อง</h2>
    <p class="return-check-device"></p><p>ตรวจสอบว่าได้รับเครื่องตามประเภทและหมายเลขนี้จากหน่วยงานจริงแล้ว</p>
    <label for="returnCheckName">ลงชื่อเจ้าหน้าที่ผู้ตรวจรับ</label>
    <input id="returnCheckName" class="field" required maxlength="200" autocomplete="name" placeholder="ชื่อ–นามสกุลเจ้าหน้าที่">
    <label class="return-check-attestation"><input type="checkbox" required> ตรวจพบเครื่องและได้รับคืนจริงแล้ว</label>
    <p class="return-check-error" role="alert"></p>
    <div class="lifecycle-return-confirm-actions"><button type="button">ยกเลิก</button><button type="submit" class="lifecycle-return-confirm-accept">ยืนยันการคืนเครื่อง</button></div></form>`;
  dialog.querySelector('.return-check-device').textContent = `${row.record.equipment_name} No.${row.record.equipment_number} · หน่วยงาน ${row.record.ward}`;
  const name = dialog.querySelector('#returnCheckName');
  const existing = document.getElementById('preparedBySel');
  name.value = existing?.value === 'อื่นๆ' ? document.getElementById('preparedByOther').value.trim() : existing?.value || '';
  let saving = false;
  dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); opener.focus(); });
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    const message = dialog.querySelector('[role="alert"]');
    if (!name.value.trim()) { message.textContent = 'กรุณาลงชื่อเจ้าหน้าที่ผู้ตรวจรับ'; name.focus(); return; }
    saving = true;
    dialog.querySelectorAll('button,input').forEach(el => el.disabled = true);
    message.textContent = 'กำลังบันทึกการตรวจรับ…';
    try {
      await confirmEquipmentReturn(row.return_id, name.value.trim());
    } catch (error) {
      message.textContent = (error.message || error) + ' หากมีการยืนยันแล้ว กรุณาปิดแล้วรีเฟรชรายการ';
      saving = false;
      dialog.querySelectorAll('button,input').forEach(el => el.disabled = false);
      return;
    }
    dialog.close();
    await memsLoadReturnChecks();
    document.dispatchEvent(new CustomEvent('mems-equipment-status-changed'));
    if (typeof toast === 'function') toast('ยืนยันรับคืนแล้ว สามารถเลือกเครื่องไปเตรียมได้');
  });
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}
document.getElementById('refreshReturnChecks').addEventListener('click', async () => {
  await memsLoadReturnChecks();
  document.dispatchEvent(new CustomEvent('mems-equipment-status-changed'));
});
