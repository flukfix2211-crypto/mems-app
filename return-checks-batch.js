/* Batch physical receipt confirmation for equipment returned by departments. */
let memsReturnChecksLoading = false;
let memsReturnChecksSaving = false;
const memsSelectedReturnChecks = new Set();

async function memsLoadReturnChecks() {
  if (memsReturnChecksLoading || memsReturnChecksSaving) return;
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
    const availableIds = new Set(rows.map(row => String(row.return_id)));
    for (const id of memsSelectedReturnChecks) if (!availableIds.has(id)) memsSelectedReturnChecks.delete(id);
    document.getElementById('returnChecksCount').textContent = `(${rows.length} เครื่อง)`;
    list.replaceChildren();
    if (!rows.length) {
      list.textContent = 'ไม่มีเครื่องรอตรวจและยืนยันการคืน';
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'return-check-toolbar';
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'return-check-select-label';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.setAttribute('aria-label', 'เลือกเครื่องรอตรวจคืนทั้งหมด');
    const selectAllText = document.createElement('span');
    selectAllText.textContent = 'เลือกทั้งหมด';
    selectAllLabel.append(selectAll, selectAllText);
    const selectionSummary = document.createElement('span');
    selectionSummary.className = 'return-check-selection-summary';
    const confirmSelected = document.createElement('button');
    confirmSelected.type = 'button';
    confirmSelected.className = 'return-check-bulk-confirm';
    toolbar.append(selectAllLabel, selectionSummary, confirmSelected);
    list.append(toolbar);

    const checkboxes = [];
    rows.forEach(row => {
      const record = row.record;
      const item = document.createElement('div');
      item.className = 'return-check-item';
      const selectLabel = document.createElement('label');
      selectLabel.className = 'return-check-row-select';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(row.return_id);
      checkbox.checked = memsSelectedReturnChecks.has(checkbox.value);
      checkbox.setAttribute('aria-label', `เลือก ${record.equipment_name} No.${record.equipment_number} เพื่อตรวจรับ`);
      const selectText = document.createElement('span');
      selectText.textContent = 'เลือก';
      selectLabel.append(checkbox, selectText);
      const details = document.createElement('div');
      details.className = 'return-check-details';
      const title = document.createElement('strong');
      title.textContent = `${record.equipment_name} No.${record.equipment_number}`;
      const meta = document.createElement('p');
      const when = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.recorded_at));
      meta.textContent = `หน่วยงาน ${record.ward} · ผู้แจ้งคืน ${record.staff_name} · ${when}`;
      details.append(title, meta);
      item.append(selectLabel, details);
      list.append(item);
      checkboxes.push(checkbox);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) memsSelectedReturnChecks.add(checkbox.value);
        else memsSelectedReturnChecks.delete(checkbox.value);
        updateSelection();
      });
    });

    function updateSelection() {
      const selectedRows = rows.filter(row => memsSelectedReturnChecks.has(String(row.return_id)));
      const count = selectedRows.length;
      selectionSummary.textContent = `เลือก ${count} จาก ${rows.length} เครื่อง`;
      confirmSelected.disabled = count === 0 || memsReturnChecksSaving;
      confirmSelected.textContent = `ตรวจรับเครื่องที่เลือก (${count})`;
      selectAll.checked = count === rows.length;
      selectAll.indeterminate = count > 0 && count < rows.length;
      confirmSelected.onclick = () => memsOpenReturnCheckBatch(selectedRows, confirmSelected);
    }
    selectAll.addEventListener('change', () => {
      checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
        if (checkbox.checked) memsSelectedReturnChecks.add(checkbox.value);
        else memsSelectedReturnChecks.delete(checkbox.value);
      });
      updateSelection();
    });
    updateSelection();
  } catch (error) {
    document.getElementById('returnChecksCount').textContent = '';
    list.textContent = 'โหลดรายการไม่สำเร็จ: ' + (error.message || error) + ' กรุณากดรีเฟรชรายการ';
  } finally {
    refresh.disabled = false;
    memsReturnChecksLoading = false;
  }
}

function memsOpenReturnCheckBatch(rows, opener) {
  if (!rows.length || memsReturnChecksSaving) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'lifecycle-return-confirm return-check-dialog';
  dialog.setAttribute('aria-labelledby', 'returnCheckDialogTitle');
  const form = document.createElement('form');
  const title = document.createElement('h2');
  title.id = 'returnCheckDialogTitle';
  title.textContent = `ยืนยันการรับคืนเครื่อง ${rows.length} เครื่อง`;
  const intro = document.createElement('p');
  intro.textContent = 'ตรวจสอบรายการที่เลือก และลงชื่อยืนยันว่าได้รับเครื่องจริงทุกรายการ';
  const deviceList = document.createElement('ul');
  deviceList.className = 'return-check-device-list';
  rows.forEach(row => {
    const li = document.createElement('li');
    li.textContent = `${row.record.equipment_name} No.${row.record.equipment_number} · ${row.record.ward}`;
    deviceList.append(li);
  });
  const nameLabel = document.createElement('label');
  nameLabel.htmlFor = 'returnCheckName';
  nameLabel.textContent = 'ลงชื่อเจ้าหน้าที่ผู้ตรวจรับ';
  const name = document.createElement('input');
  name.id = 'returnCheckName';
  name.className = 'field';
  name.required = true;
  name.maxLength = 200;
  name.autocomplete = 'name';
  name.placeholder = 'ชื่อ–นามสกุลเจ้าหน้าที่';
  const existing = document.getElementById('preparedBySel');
  name.value = existing?.value === 'อื่นๆ' ? document.getElementById('preparedByOther')?.value.trim() || '' : existing?.value || '';
  const attestLabel = document.createElement('label');
  attestLabel.className = 'return-check-attestation';
  const attest = document.createElement('input');
  attest.type = 'checkbox';
  attest.required = true;
  const attestText = document.createElement('span');
  attestText.textContent = 'ตรวจพบและได้รับเครื่องจริงครบทุกเครื่องที่เลือก';
  attestLabel.append(attest, attestText);
  const error = document.createElement('p');
  error.className = 'return-check-error';
  error.setAttribute('role', 'alert');
  const actions = document.createElement('div');
  actions.className = 'lifecycle-return-confirm-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'ยกเลิก';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'lifecycle-return-confirm-accept';
  submit.textContent = `ยืนยันรับคืน ${rows.length} เครื่อง`;
  actions.append(cancel, submit);
  form.append(title, intro, deviceList, nameLabel, name, attestLabel, error, actions);
  dialog.append(form);
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (memsReturnChecksSaving) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (memsReturnChecksSaving) return;
    if (!name.value.trim()) { error.textContent = 'กรุณาลงชื่อเจ้าหน้าที่ผู้ตรวจรับ'; name.focus(); return; }
    memsReturnChecksSaving = true;
    form.querySelectorAll('button,input').forEach(element => { element.disabled = true; });
    error.textContent = 'กำลังบันทึกการตรวจรับ…';
    let succeeded = 0;
    const failed = [];
    for (const [index, row] of rows.entries()) {
      error.textContent = `กำลังบันทึกการตรวจรับ ${index + 1}/${rows.length} เครื่อง…`;
      try {
        await confirmEquipmentReturn(row.return_id, name.value.trim());
        memsSelectedReturnChecks.delete(String(row.return_id));
        succeeded++;
      } catch (saveError) {
        failed.push(`${row.record.equipment_name} No.${row.record.equipment_number}: ${saveError.message || saveError}`);
      }
    }
    dialog.close();
    memsReturnChecksSaving = false;
    await memsLoadReturnChecks();
    document.dispatchEvent(new CustomEvent('mems-equipment-status-changed'));
    if (failed.length) {
      console.error('ตรวจรับคืนไม่สำเร็จบางรายการ', failed);
      toast(`ยืนยันสำเร็จ ${succeeded} เครื่อง · ไม่สำเร็จ ${failed.length} เครื่อง กรุณาตรวจรายการที่เหลือ`);
    } else toast(`ยืนยันรับคืนแล้ว ${succeeded} เครื่อง สามารถเลือกไปเตรียมได้`);
  });
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}

document.getElementById('refreshReturnChecks').addEventListener('click', async () => {
  await memsLoadReturnChecks();
  document.dispatchEvent(new CustomEvent('mems-equipment-status-changed'));
});

document.addEventListener('DOMContentLoaded', () => { memsLoadReturnChecks(); });
