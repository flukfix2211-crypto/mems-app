/* MEMs — QR return flow.
 * Accepts links produced by asset-qr.js and input from a USB/Bluetooth 2D scanner.
 */
let memsQrReturnAsset = null;
let memsGlobalScannerInstalled = false;
let memsScanIntendedAction = null;
let memsQrScannerEnabled = true;
let memsPromptScanTimer = null;
let memsPromptScanProcessing = false;
let memsPromptScannedItems = [];
let memsQrBatchItems = [];
const memsScannerState = {
  buffer: '',
  startedAt: 0,
  lastKeyAt: 0,
  target: null,
  originalValue: null,
  selectionStart: null,
  selectionEnd: null,
  idleTimer: null,
  lastPayload: '',
  lastProcessedAt: 0
};

// เครื่องสแกนแบบ keyboard wedge จะพิมพ์ตามภาษาคีย์บอร์ดของเครื่อง
// จึงต้องแปลงอักขระ Thai Kedmanee กลับเป็นปุ่ม US ก่อนอ่าน URL จาก QR
const memsThaiKedmaneeToAscii = Object.freeze({
  'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0',
  'ข': '-', 'ช': '=',
  'ๆ': 'q', 'ไ': 'w', 'ำ': 'e', 'พ': 'r', 'ะ': 't', 'ั': 'y', 'ี': 'u', 'ร': 'i', 'น': 'o', 'ย': 'p',
  'บ': '[', 'ล': ']', 'ฃ': '\\',
  'ฟ': 'a', 'ห': 's', 'ก': 'd', 'ด': 'f', 'เ': 'g', '้': 'h', '่': 'j', 'า': 'k', 'ส': 'l', 'ว': ';', 'ง': "'",
  'ผ': 'z', 'ป': 'x', 'แ': 'c', 'อ': 'v', 'ิ': 'b', 'ื': 'n', 'ท': 'm', 'ม': ',', 'ใ': '.', 'ฝ': '/',
  'ซ': ':', 'ฦ': '?', '฿': '&'
});

function memsNormalizeScannerText(raw) {
  const value = String(raw || '').trim();
  if (!/[\u0E00-\u0E7F]/.test(value)) return value;
  return Array.from(value, character => memsThaiKedmaneeToAscii[character] || character).join('');
}

function memsQrEquipmentName(type) {
  return type === 'อื่นๆ' ? 'เครื่องมืออื่นๆ' : String(type || '');
}

function memsSetQrBanner(message, state) {
  const banner = document.getElementById('qrReturnBanner');
  if (!banner) return;
  banner.style.display = '';
  banner.className = 'qr-return-banner ' + (state || 'ready');
  const messageEl = document.getElementById('qrReturnMessage');
  if (messageEl) messageEl.textContent = message;
}

function memsSetQrDevice(asset, equipmentName) {
  const device = document.getElementById('qrReturnDevice');
  const typeEl = document.getElementById('qrReturnType');
  const noEl = document.getElementById('qrReturnNo');
  if (!device || !typeEl || !noEl) return;
  if (!asset) {
    device.style.display = 'none';
    device.classList.remove('batch');
    typeEl.textContent = '';
    noEl.textContent = '';
    return;
  }
  typeEl.textContent = equipmentName || memsQrEquipmentName(asset.type);
  noEl.textContent = 'No. ' + asset.no;
  device.classList.remove('batch');
  device.style.display = 'flex';
}

function memsSetQrBatchDevice(items) {
  const device = document.getElementById('qrReturnDevice');
  const typeEl = document.getElementById('qrReturnType');
  const noEl = document.getElementById('qrReturnNo');
  if (!device || !typeEl || !noEl || !items || !items.length) return;
  const equipmentTypes = [...new Set(items.map(item => item.equipment))];
  typeEl.textContent = equipmentTypes.length === 1
    ? equipmentTypes[0]
    : equipmentTypes.length + ' ประเภท';
  noEl.textContent = items.map(item => item.equipment + ' No.' + item.number).join(' · ');
  device.classList.toggle('batch', items.length > 1 || equipmentTypes.length > 1);
  device.style.display = 'flex';
}

function memsSyncQrScanCard(action) {
  const card = document.getElementById('qrScanCard');
  if (!card) return;
  card.style.display = memsQrScannerEnabled && action === 'return' ? '' : 'none';
}

async function memsLoadQrScannerSetting() {
  try {
    memsQrScannerEnabled = await fetchQrScannerEnabled();
  } catch (err) {
    console.error('โหลดการตั้งค่า QR ไม่สำเร็จ', err);
    memsQrScannerEnabled = true;
  }
  if (!memsQrScannerEnabled) memsClearQrReturnContext();
  memsSyncQrScanCard(S.action);
  return memsQrScannerEnabled;
}

function memsSelectAction(action) {
  if (!memsQrScannerEnabled) {
    setAction(action);
    return;
  }
  memsChooseActionAndScan(action);
}

function memsShowQrScanPrompt(action) {
  const prompt = document.getElementById('qrScanPrompt');
  const actionEl = document.getElementById('qrScanPromptAction');
  const hint = document.getElementById('qrScanPromptHint');
  const input = document.getElementById('qrScanPromptInput');
  if (!prompt) return;
  if (actionEl) actionEl.textContent = action === 'borrow' ? 'ทำรายการยืมเครื่อง' : 'ทำรายการคืนเครื่อง';
  if (hint) {
    hint.textContent = 'ยิงเครื่องสแกนได้ทันที ไม่ต้องคลิกช่องกรอกข้อมูล';
    hint.classList.remove('error');
  }
  if (memsPromptScanTimer) clearTimeout(memsPromptScanTimer);
  memsPromptScanTimer = null;
  memsResetPromptScans();
  memsSetQrScanPromptProcessing(false);
  if (input) input.value = '';
  prompt.classList.add('show');
  if (input) input.focus({ preventScroll: true });
}

function memsHideQrScanPrompt(clearIntent) {
  const prompt = document.getElementById('qrScanPrompt');
  const input = document.getElementById('qrScanPromptInput');
  if (memsPromptScanTimer) clearTimeout(memsPromptScanTimer);
  memsPromptScanTimer = null;
  if (prompt) prompt.classList.remove('show');
  if (input) {
    input.value = '';
    input.blur();
  }
  if (clearIntent) {
    memsScanIntendedAction = null;
    memsQrBatchItems = [];
    memsResetPromptScans();
  }
}

function memsSetQrScanPromptProcessing(processing) {
  const prompt = document.getElementById('qrScanPrompt');
  const input = document.getElementById('qrScanPromptInput');
  const cancel = document.getElementById('qrScanPromptCancel');
  const confirm = document.getElementById('qrScanPromptConfirm');
  const hint = document.getElementById('qrScanPromptHint');
  memsPromptScanProcessing = Boolean(processing);
  if (prompt) prompt.classList.toggle('processing', memsPromptScanProcessing);
  if (input) input.readOnly = memsPromptScanProcessing;
  if (cancel) cancel.disabled = memsPromptScanProcessing;
  if (confirm) confirm.disabled = memsPromptScanProcessing || !memsPromptScannedItems.length;
  if (hint && memsPromptScanProcessing) {
    hint.textContent = 'กำลังประมวลผลข้อมูลเครื่อง…';
    hint.classList.remove('error');
  }
}

function memsSetQrScanPromptError(message) {
  const hint = document.getElementById('qrScanPromptHint');
  if (!hint) return;
  hint.textContent = message;
  hint.classList.add('error');
}

function memsPromptScanLimit(equipment, action) {
  if (action === 'return') return Infinity;
  return equipment === 'Infusion Pump' ? 10 : 5;
}

function memsRenderPromptScans() {
  const prompt = document.getElementById('qrScanPrompt');
  const list = document.getElementById('qrScanBatchList');
  const count = document.getElementById('qrScanBatchCount');
  const confirm = document.getElementById('qrScanPromptConfirm');
  if (prompt) prompt.classList.toggle('has-scans', memsPromptScannedItems.length > 0);
  if (count) count.textContent = memsPromptScannedItems.length + ' เครื่อง';
  if (confirm) confirm.disabled = memsPromptScanProcessing || !memsPromptScannedItems.length;
  if (!list) return;
  list.replaceChildren();
  memsPromptScannedItems.forEach((item, index) => {
    const chip = document.createElement('div');
    chip.className = 'qr-scan-chip';
    const label = document.createElement('span');
    const showEquipment = (memsScanIntendedAction || S.action) === 'return';
    label.textContent = (showEquipment ? item.equipment + ' · ' : '') + 'No. ' + item.number;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'qr-scan-chip-remove';
    remove.setAttribute('aria-label', 'นำ ' + item.equipment + ' No. ' + item.number + ' ออกจากรายการ');
    remove.textContent = '×';
    remove.onclick = () => memsRemovePromptScan(index);
    chip.append(label, remove);
    list.appendChild(chip);
  });
}

function memsResetPromptScans() {
  memsPromptScannedItems = [];
  memsRenderPromptScans();
}

function memsRemovePromptScan(index) {
  if (memsPromptScanProcessing) return;
  memsPromptScannedItems.splice(index, 1);
  memsRenderPromptScans();
  const hint = document.getElementById('qrScanPromptHint');
  if (hint) {
    hint.textContent = memsPromptScannedItems.length
      ? 'ยิงเครื่องถัดไปได้เลย หรือกดยืนยันเมื่อครบแล้ว'
      : 'ยิงเครื่องสแกนได้ทันที ไม่ต้องคลิกช่องกรอกข้อมูล';
    hint.classList.remove('error');
  }
  document.getElementById('qrScanPromptInput')?.focus({ preventScroll: true });
}

function memsChooseActionAndScan(action) {
  if (!memsQrScannerEnabled) {
    setAction(action);
    return;
  }
  memsClearQrReturnContext();
  setAction(action);
  memsScanIntendedAction = action;
  memsShowQrScanPrompt(action);
}

function memsHandlePromptScannerInput() {
  if (memsPromptScanTimer) clearTimeout(memsPromptScanTimer);
  memsPromptScanTimer = setTimeout(memsProcessPromptScan, 320);
}

async function memsProcessPromptScan() {
  if (memsPromptScanProcessing) return;
  if (memsPromptScanTimer) clearTimeout(memsPromptScanTimer);
  memsPromptScanTimer = null;
  const input = document.getElementById('qrScanPromptInput');
  const raw = input && input.value.trim();
  if (!raw) return;
  const assetId = memsAssetIdFromScan(raw);
  if (!assetId) {
    input.value = '';
    memsSetQrScanPromptError('QR Code นี้ไม่ใช่ป้ายเครื่องจากระบบ MEMs — กรุณาลองอีกครั้ง');
    input.focus({ preventScroll: true });
    return;
  }
  input.value = '';
  memsSetQrScanPromptProcessing(true);
  await memsAddPromptScan(assetId);
  memsSetQrScanPromptProcessing(false);
  if (document.getElementById('qrScanPrompt')?.classList.contains('show')) {
    input.focus({ preventScroll: true });
  }
}

async function memsAddPromptScan(assetId) {
  const targetAction = memsScanIntendedAction || S.action || 'return';
  try {
    const asset = await memsLoadQrAsset(assetId);
    const equipment = memsQrEquipmentName(asset.type);
    const equipmentButton = Array.from(document.querySelectorAll('.equip-btn'))
      .find(button => String(button.dataset.e).toLowerCase() === equipment.toLowerCase());
    if (!equipmentButton) throw new Error('ไม่พบประเภทเครื่อง “' + equipment + '” ในหน้าทำรายการ');

    const number = normalizeMachineNo(asset.no) || String(asset.no);
    const first = memsPromptScannedItems[0];
    if (targetAction !== 'return' && first && first.equipment !== equipment) {
      throw new Error('สแกนรวมกันได้เฉพาะเครื่องชนิดเดียวกัน กรุณายืนยันรายการเดิมก่อน');
    }
    if (memsPromptScannedItems.some(item => item.equipment === equipment && item.number === number)) {
      const hint = document.getElementById('qrScanPromptHint');
      if (hint) {
        hint.textContent = 'No. ' + number + ' อยู่ในรายการแล้ว — ยิงเครื่องถัดไปได้เลย';
        hint.classList.remove('error');
      }
      return true;
    }
    const scanLimit = memsPromptScanLimit(equipment, targetAction);
    if (memsPromptScannedItems.length >= scanLimit) {
      throw new Error('เลือกได้สูงสุด ' + scanLimit + ' เครื่องต่อรายการ');
    }

    let borrowedStatus = null;
    if (targetAction === 'return') {
      borrowedStatus = await memsLoadBorrowedStatus(equipment, number);
      const firstWard = first && first.borrowedStatus && first.borrowedStatus.ward;
      if (firstWard && borrowedStatus.ward !== firstWard) {
        throw new Error('เครื่องนี้ยืมจากคนละหน่วยงานกับรายการที่สแกนไว้ กรุณายืนยันแยกรายการ');
      }
    }

    memsPromptScannedItems.push({ asset, equipment, number, borrowedStatus });
    memsRenderPromptScans();
    const hint = document.getElementById('qrScanPromptHint');
    if (hint) {
      hint.textContent = 'รับ ' + equipment + ' No. ' + number + ' แล้ว — ยิงเครื่องถัดไป หรือกดยืนยันเมื่อครบ';
      hint.classList.remove('error');
    }
    return true;
  } catch (err) {
    console.error(err);
    memsSetQrScanPromptError('สแกนไม่สำเร็จ: ' + (err.message || err) + ' — กรุณาลองอีกครั้ง');
    return false;
  }
}

async function memsConfirmPromptScans() {
  if (memsPromptScanProcessing || !memsPromptScannedItems.length) return;
  const input = document.getElementById('qrScanPromptInput');
  memsSetQrScanPromptProcessing(true);
  try {
    const items = memsPromptScannedItems.slice();
    const targetAction = memsScanIntendedAction || S.action || 'return';
    const applied = await memsApplyQrBatchItems(items, targetAction);
    if (!applied) {
      memsSetQrScanPromptError('ยังยืนยันรายการไม่ได้ กรุณาตรวจสอบหน่วยงานหรือรายการเครื่องที่เตรียมไว้');
      return;
    }
    memsResetPromptScans();
    memsScanIntendedAction = null;
    memsHideQrScanPrompt(false);
  } catch (err) {
    console.error(err);
    memsSetQrScanPromptError('ยืนยันรายการไม่สำเร็จ: ' + (err.message || err));
  } finally {
    memsSetQrScanPromptProcessing(false);
    if (document.getElementById('qrScanPrompt')?.classList.contains('show')) {
      input?.focus({ preventScroll: true });
    }
  }
}

function memsClearQrReturnContext() {
  memsQrReturnAsset = null;
  memsQrBatchItems = [];
  memsResetPromptScans();
  memsScanIntendedAction = null;
  memsHideQrScanPrompt(false);
  memsResetScannerBuffer();
  memsScannerState.lastPayload = '';
  memsScannerState.lastProcessedAt = 0;
  memsSetQrDevice(null);
  const input = document.getElementById('qrScanInput');
  if (input) input.value = '';
  const banner = document.getElementById('qrReturnBanner');
  if (banner) banner.style.display = 'none';
}

function memsAssetIdFromScan(raw) {
  const value = memsNormalizeScannerText(raw);
  if (!value) return '';
  const prefixed = value.match(/^MEMS(?:-QR)?:\s*(\d+)$/i);
  if (prefixed) return prefixed[1];
  try {
    const parsed = new URL(value, window.location.href);
    const id = parsed.searchParams.get('asset') || parsed.searchParams.get('a');
    if (id) return id;
  } catch (err) { /* ตรวจรูปแบบตัวเลขด้านล่าง */ }
  return /^\d+$/.test(value) ? value : '';
}

function memsLooksLikeQrPayload(raw) {
  const value = String(raw || '').trim();
  return /^MEMS(?:-QR)?:\s*\d+$/i.test(value) ||
    /[?&](?:asset|a)=\d+(?:[&#]|$)/i.test(value);
}

function memsScannerInputSnapshot(target) {
  if (!target || !/^(INPUT|TEXTAREA)$/.test(target.tagName)) return null;
  return {
    target,
    value: target.value,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd
  };
}

function memsRestoreScannerInput() {
  const target = memsScannerState.target;
  if (!target || memsScannerState.originalValue === null || !target.isConnected) return;
  target.value = memsScannerState.originalValue;
  if (typeof target.setSelectionRange === 'function' && memsScannerState.selectionStart !== null) {
    target.setSelectionRange(memsScannerState.selectionStart, memsScannerState.selectionEnd);
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function memsResetScannerBuffer() {
  if (memsScannerState.idleTimer) clearTimeout(memsScannerState.idleTimer);
  memsScannerState.buffer = '';
  memsScannerState.startedAt = 0;
  memsScannerState.lastKeyAt = 0;
  memsScannerState.target = null;
  memsScannerState.originalValue = null;
  memsScannerState.selectionStart = null;
  memsScannerState.selectionEnd = null;
  memsScannerState.idleTimer = null;
}

function memsFinishGlobalScan() {
  const payload = memsNormalizeScannerText(memsScannerState.buffer.trim());
  if (!memsLooksLikeQrPayload(payload)) return false;
  const assetId = memsAssetIdFromScan(payload);
  if (!assetId) return false;

  const now = performance.now();
  const duplicate = payload === memsScannerState.lastPayload &&
    now - memsScannerState.lastProcessedAt < 1000;
  memsRestoreScannerInput();
  memsResetScannerBuffer();
  if (duplicate) return true;

  memsScannerState.lastPayload = payload;
  memsScannerState.lastProcessedAt = now;
  const prompt = document.getElementById('qrScanPrompt');
  if (prompt?.classList.contains('show')) {
    memsSetQrScanPromptProcessing(true);
    memsAddPromptScan(assetId).finally(() => {
      memsSetQrScanPromptProcessing(false);
      document.getElementById('qrScanPromptInput')?.focus({ preventScroll: true });
    });
  } else {
    memsUseQrAssetId(assetId);
  }
  return true;
}

function memsHandleGlobalScannerKey(event) {
  if (!memsQrScannerEnabled) return;
  if (event.target && event.target.id === 'qrScanPromptInput') return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const now = performance.now();

  if (event.key === 'Enter') {
    if (memsFinishGlobalScan()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else {
      memsResetScannerBuffer();
    }
    return;
  }
  if (event.key.length !== 1) return;

  if (!memsScannerState.buffer || now - memsScannerState.lastKeyAt > 180) {
    memsResetScannerBuffer();
    const snapshot = memsScannerInputSnapshot(event.target);
    memsScannerState.startedAt = now;
    memsScannerState.target = snapshot && snapshot.target;
    memsScannerState.originalValue = snapshot ? snapshot.value : null;
    memsScannerState.selectionStart = snapshot ? snapshot.selectionStart : null;
    memsScannerState.selectionEnd = snapshot ? snapshot.selectionEnd : null;
  }
  memsScannerState.buffer += event.key;
  memsScannerState.lastKeyAt = now;
  if (memsScannerState.idleTimer) clearTimeout(memsScannerState.idleTimer);
  memsScannerState.idleTimer = setTimeout(() => {
    const duration = memsScannerState.lastKeyAt - memsScannerState.startedAt;
    const maxScannerDuration = Math.max(1200, memsScannerState.buffer.length * 90);
    if (duration <= maxScannerDuration && memsFinishGlobalScan()) return;
    memsResetScannerBuffer();
  }, 220);
}

function memsInstallGlobalScanner() {
  if (!memsQrScannerEnabled || memsGlobalScannerInstalled) return;
  document.addEventListener('keydown', memsHandleGlobalScannerKey, true);
  memsGlobalScannerInstalled = true;
}

async function memsLoadQrAsset(assetId) {
  if (!assetId) throw new Error('ไม่พบรหัสเครื่องใน QR Code');
  const { data, error } = await supabase
    .from('assets')
    .select('id,no,asset_code,type,status')
    .eq('id', assetId)
    .limit(1);
  if (error) throw error;
  if (!data || !data.length) throw new Error('ไม่พบเครื่องนี้ในทะเบียนครุภัณฑ์');
  return data[0];
}

function memsSelectBorrowedWard(ward) {
  const wardSelect = document.getElementById('wardSel');
  if (!wardSelect || !ward) throw new Error('ไม่พบหน่วยงานที่ยืมเครื่องนี้');
  let option = Array.from(wardSelect.options).find(item => item.value === ward);
  if (!option) {
    option = new Option(ward, ward);
    option.dataset.memsAutoWard = 'true';
    const otherOption = Array.from(wardSelect.options)
      .find(item => item.value === 'อื่นๆ โปรดระบุชื่อตึก');
    wardSelect.insertBefore(option, otherOption || null);
  }
  wardSelect.value = ward;
  const otherWrap = document.getElementById('otherWrap');
  const otherInput = document.getElementById('otherWard');
  if (otherWrap) otherWrap.classList.add('hidden');
  if (otherInput) otherInput.value = '';
}

async function memsLoadBorrowedStatus(equipment, number) {
  const status = await fetchEquipmentStatusForMachine(equipment, number);
  if (!status || !status.isBorrowed) {
    throw new Error('เครื่องนี้ไม่มีรายการยืมค้างอยู่ จึงยังคืนไม่ได้');
  }
  if (!status.ward) throw new Error('รายการยืมล่าสุดไม่มีข้อมูลตึก/หน่วยงาน');
  return status;
}

async function memsApplyQrBatchItems(items, targetAction) {
  if (!items || !items.length) return false;
  if (S.action !== targetAction) setAction(targetAction);
  const first = items[0];
  const equipment = first.equipment;
  const equipmentButton = Array.from(document.querySelectorAll('.equip-btn'))
    .find(button => String(button.dataset.e).toLowerCase() === equipment.toLowerCase());
  if (!equipmentButton) throw new Error('ไม่พบประเภทเครื่อง “' + equipment + '” ในหน้าทำรายการ');

  memsQrBatchItems = items.slice();
  memsQrReturnAsset = first.asset;
  memsSyncQrScanCard(targetAction);
  if (targetAction === 'return') {
    const ward = first.borrowedStatus && first.borrowedStatus.ward;
    memsSelectBorrowedWard(ward);
  }
  memsSetQrDevice(first.asset, equipment);
  pickEquip(equipmentButton, equipment);

  if (targetAction === 'borrow') {
    const ward = document.getElementById('wardSel').value;
    if (!ward) {
      memsSetQrBanner(
        'สแกนแล้ว ' + items.length + ' เครื่อง: ' + equipment + ' ' +
        items.map(item => 'No.' + item.number).join(', ') + ' — กรุณาเลือกหน่วยงานที่ต้องการยืม',
        'ready'
      );
      return true;
    }
    return memsApplyQrBorrowBatchItems(items);
  }

  const returnTypes = [...new Set(items.map(item => item.equipment))];
  if (returnTypes.length === 1) {
    memsPrimeQrNumbers(equipment, items.map(item => item.number));
  } else {
    memsSetQrBatchDevice(items);
  }
  memsSetQrBanner(
    '✓ เลือกคืนแล้ว ' + items.length + ' เครื่อง: ' +
    items.map(item => item.equipment + ' No.' + item.number).join(', ') +
    ' — กรอกชื่อผู้คืนแล้วกดบันทึกครั้งเดียว',
    'success'
  );
  document.getElementById('staffName')?.focus({ preventScroll: true });
  return true;
}

async function memsApplyQrBorrowBatchItems(items) {
  if (!items || !items.length || S.action !== 'borrow') return false;
  const ward = document.getElementById('wardSel').value;
  const equipment = items[0].equipment;
  if (!ward) return false;

  try {
    preparedList = await fetchPreparedList();
    renderPreparedBanner();
    filterEquipButtons();
  } catch (err) {
    console.error(err);
    memsSetQrBanner('⚠️ ตรวจสอบรายการเครื่องที่เตรียมไว้ไม่สำเร็จ กรุณาลองใหม่', 'error');
    return false;
  }

  const missing = items.filter(item => !preparedList.some(prepared =>
    prepared.ward === ward &&
    String(prepared.equipment || '').toLowerCase() === equipment.toLowerCase() &&
    (normalizeMachineNo(prepared.number) || String(prepared.number)) === item.number
  ));
  if (missing.length) {
    clearPreparedSelection();
    memsSetQrBanner(
      '⚠️ เครื่องที่ยังไม่ได้เตรียมไว้สำหรับหน่วยงานนี้: ' +
      missing.map(item => 'No.' + item.number).join(', '),
      'error'
    );
    return false;
  }

  selectedPrepared.clear();
  items.forEach(item => {
    selectedPrepared.set(
      preparedSelectionKey(equipment, item.number),
      { equipment, number: item.number }
    );
  });
  document.querySelectorAll('.equip-btn').forEach(button => button.classList.remove('active'));
  const equipmentButton = Array.from(document.querySelectorAll('.equip-btn'))
    .find(button => String(button.dataset.e).toLowerCase() === equipment.toLowerCase());
  if (equipmentButton) equipmentButton.classList.add('active');
  S.equip = equipment;
  syncPreparedNumbersToForm();
  updatePreparedSelectionUI();
  renderPreparedBanner();
  memsSetQrBanner(
    '✓ เลือกแล้ว ' + items.length + ' เครื่อง: ' + equipment + ' ' +
    items.map(item => 'No.' + item.number).join(', ') + ' — กรอกชื่อผู้ยืมแล้วกดบันทึก',
    'success'
  );
  memsQrBatchItems = [];
  document.getElementById('staffName')?.focus({ preventScroll: true });
  return true;
}

async function memsUseQrAssetId(assetId, options) {
  const targetAction = (options && options.action) || memsScanIntendedAction || S.action || 'return';
  memsQrBatchItems = [];
  if (S.action !== targetAction) setAction(targetAction);
  memsSetQrDevice(null);
  memsSetQrBanner('กำลังตรวจสอบข้อมูลเครื่องจากทะเบียน…', 'loading');
  try {
    const asset = await memsLoadQrAsset(assetId);
    memsQrReturnAsset = asset;
    const requestedEquip = memsQrEquipmentName(asset.type);
    const equipButton = Array.from(document.querySelectorAll('.equip-btn'))
      .find(button => String(button.dataset.e).toLowerCase() === requestedEquip.toLowerCase());

    memsSyncQrScanCard(targetAction);
    if (!equipButton) throw new Error('ไม่พบประเภทเครื่อง “' + requestedEquip + '” ในหน้าทำรายการ');
    const equip = equipButton.dataset.e;
    if (targetAction === 'return') {
      memsSetQrBanner('กำลังค้นหาหน่วยงานที่ยืมเครื่องนี้…', 'loading');
      const borrowedStatus = await memsLoadBorrowedStatus(equip, asset.no);
      memsSelectBorrowedWard(borrowedStatus.ward);
    }
    memsHideQrScanPrompt(true);
    memsSetQrDevice(asset, equip);
    pickEquip(equipButton, equip);
    memsPrimeQrNumber(equip, asset.no);

    const ward = document.getElementById('wardSel').value;
    if (!ward) {
      memsSetQrBanner('สแกนแล้ว: ' + equip + ' No.' + asset.no + ' — กรุณาเลือกหน่วยงานที่ต้องการยืม', 'ready');
      return true;
    }
    await memsApplyQrSelection();
    return true;
  } catch (err) {
    console.error(err);
    memsQrReturnAsset = null;
    memsSetQrDevice(null);
    memsSetQrBanner('⚠️ อ่าน QR ไม่สำเร็จ: ' + (err.message || err), 'error');
    if (document.getElementById('qrScanPrompt')?.classList.contains('show')) {
      memsSetQrScanPromptError('สแกนไม่สำเร็จ: ' + (err.message || err) + ' — กรุณาลองอีกครั้ง');
    }
    return false;
  }
}

function memsPrimeQrNumber(equip, number) {
  memsPrimeQrNumbers(equip, [number]);
}

function memsPrimeQrNumbers(equip, numbers) {
  const normalized = numbers.map(number => normalizeMachineNo(number) || String(number));
  if (GRID_EQUIPS.has(equip)) {
    c2SelectedNums.clear();
    normalized.forEach(number => c2SelectedNums.add(number));
    updateC2SelInfo();
    return;
  }
  resetEquipFields();
  const inputs = () => [...document.querySelectorAll('#enumRows .enum-input')];
  if (inputs()[0]) inputs()[0].value = normalized[0] || '';
  for (let index = 1; index < normalized.length; index++) {
    addEquipField();
    if (inputs()[index]) inputs()[index].value = normalized[index];
  }
  inputs().forEach(input => input.dispatchEvent(new Event('input', { bubbles: true })));
}

async function memsProcessQrScan() {
  if (!memsQrScannerEnabled) return;
  const input = document.getElementById('qrScanInput');
  const assetId = memsAssetIdFromScan(input && input.value);
  if (!assetId) {
    memsSetQrBanner('⚠️ QR Code นี้ไม่ใช่ป้ายเครื่องจากระบบ MEMs', 'error');
    return;
  }
  if (input) input.value = '';
  await memsUseQrAssetId(assetId, { action: 'return' });
}

async function memsApplyQrSelection() {
  if (memsQrBatchItems.length) {
    if (S.action === 'borrow') return memsApplyQrBorrowBatchItems(memsQrBatchItems.slice());
    return true;
  }
  if (S.action === 'borrow') return memsApplyQrBorrowSelection();
  if (S.action === 'return') return memsApplyQrReturnSelection();
}

async function memsApplyQrBorrowSelection() {
  const asset = memsQrReturnAsset;
  if (!asset || S.action !== 'borrow') return;

  const ward = document.getElementById('wardSel').value;
  const requestedEquip = memsQrEquipmentName(asset.type);
  const no = normalizeMachineNo(asset.no) || String(asset.no);
  if (!ward) {
    memsSetQrBanner('สแกนแล้ว: ' + requestedEquip + ' No.' + no + ' — กรุณาเลือกหน่วยงานที่ต้องการยืม', 'ready');
    return;
  }

  try {
    preparedList = await fetchPreparedList();
    renderPreparedBanner();
    filterEquipButtons();
  } catch (err) {
    console.error(err);
    memsSetQrBanner('⚠️ ตรวจสอบรายการเครื่องที่เตรียมไว้ไม่สำเร็จ กรุณาลองใหม่', 'error');
    return;
  }

  const prepared = preparedList.find(item =>
    item.ward === ward &&
    String(item.equipment || '').toLowerCase() === requestedEquip.toLowerCase() &&
    (normalizeMachineNo(item.number) || String(item.number)) === no
  );
  if (!prepared) {
    clearPreparedSelection();
    memsSetQrBanner('⚠️ ' + requestedEquip + ' No.' + no + ' ยังไม่ได้ถูกเตรียมไว้สำหรับหน่วยงานนี้', 'error');
    return;
  }

  const equipButton = Array.from(document.querySelectorAll('.equip-btn'))
    .find(button => String(button.dataset.e).toLowerCase() === requestedEquip.toLowerCase());
  if (!equipButton) {
    memsSetQrBanner('⚠️ ไม่พบประเภทเครื่อง “' + requestedEquip + '” ในหน้าทำรายการ', 'error');
    return;
  }
  const equip = equipButton.dataset.e;
  selectedPrepared.clear();
  selectedPrepared.set(preparedSelectionKey(equip, no), { equipment: equip, number: no });
  document.querySelectorAll('.equip-btn').forEach(button => button.classList.remove('active'));
  equipButton.classList.add('active');
  syncPreparedNumbersToForm();
  updatePreparedSelectionUI();
  renderPreparedBanner();

  memsSetQrBanner('✓ เลือกแล้ว: ' + equip + ' No.' + no + ' — กรอกชื่อผู้ยืมแล้วกดบันทึก', 'success');
  const staffInput = document.getElementById('staffName');
  if (staffInput) staffInput.focus({ preventScroll: true });
}

async function memsHandleQrDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') || (params.get('m') === 'r' ? 'return' : '');
  const assetId = params.get('asset') || params.get('a');
  if (!memsQrScannerEnabled) {
    if (mode === 'return') setAction('return');
    memsSyncQrScanCard(S.action);
    return;
  }
  memsInstallGlobalScanner();
  memsSyncQrScanCard(mode === 'return' ? 'return' : S.action);
  if (mode !== 'return' || !assetId) return;
  await memsUseQrAssetId(assetId, { action: 'return' });
}

async function memsApplyQrReturnSelection() {
  const asset = memsQrReturnAsset;
  if (!asset || S.action !== 'return') return;

  const ward = document.getElementById('wardSel').value;
  const requestedEquip = memsQrEquipmentName(asset.type);
  const no = String(asset.no);
  if (!ward) {
    memsSetQrBanner('สแกนแล้ว: ' + requestedEquip + ' No.' + no + ' — กรุณาเลือกหน่วยงานที่นำมาคืน', 'ready');
    return;
  }

  const equipButton = Array.from(document.querySelectorAll('.equip-btn'))
    .find(button => String(button.dataset.e).toLowerCase() === requestedEquip.toLowerCase());
  if (!equipButton) {
    memsSetQrBanner('⚠️ ไม่พบประเภทเครื่อง “' + requestedEquip + '” ในหน้าคืนเครื่อง', 'error');
    return;
  }
  const equip = equipButton.dataset.e;
  if (S.equip !== equip) pickEquip(equipButton, equip);

  if (GRID_EQUIPS.has(equip)) {
    // No. ที่แสดงทันทีหลังสแกนเป็นเพียง preview — ต้องล้างแล้วเลือกใหม่
    // จากรายการที่ยืมจริงของหน่วยงาน เพื่อไม่ให้ข้ามกติกาการคืนเครื่อง
    c2SelectedNums.clear();
    updateC2SelInfo();
    if (equip === 'C2') await loadC2Status();
    else await loadEquipStatus();
    const numberButton = Array.from(document.querySelectorAll('#c2Grid [data-num]'))
      .find(button => String(button.dataset.num) === no);
    if (!numberButton) {
      memsSetQrBanner('⚠️ ' + equip + ' No.' + no + ' ไม่อยู่ในรายการที่หน่วยงานนี้ยืม กรุณาตรวจสอบหน่วยงาน', 'error');
      return;
    }
    toggleC2Num(no, numberButton);
  } else {
    resetEquipFields();
    const numberInput = document.getElementById('equipNum1');
    numberInput.value = no;
    numberInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  memsSetQrBanner('✓ เลือกแล้ว: ' + equip + ' No.' + no + ' — กรอกชื่อผู้คืนแล้วกดบันทึก', 'success');
  const staffInput = document.getElementById('staffName');
  if (staffInput) staffInput.focus({ preventScroll: true });
}
