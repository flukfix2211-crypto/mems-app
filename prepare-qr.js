/* MEMs — camera QR flow for the equipment preparation page. */
let memsPrepareQrScanner = null;
let memsPrepareQrHandling = false;
let memsPrepareQrEnabled = false;
let memsPrepareQrDraftItems = [];
let memsPrepareQrBatchItems = [];
let memsPrepareQrLastValue = '';
let memsPrepareQrLastReadAt = 0;

function memsPrepareAssetIdFromScan(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const prefixed = value.match(/^MEMS(?:-QR)?:\s*(\d+)$/i);
  if (prefixed) return prefixed[1];
  try {
    const parsed = new URL(value, window.location.href);
    const id = parsed.searchParams.get('asset') || parsed.searchParams.get('a');
    if (id && /^\d+$/.test(id)) return id;
  } catch (err) { /* ตรวจรูปแบบตัวเลขด้านล่าง */ }
  return /^\d+$/.test(value) ? value : '';
}

function memsSetPrepareQrStatus(message, isError) {
  const status = document.getElementById('prepareQrCameraStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', !!isError);
}

function memsRenderPrepareQrDraft() {
  const wrap = document.getElementById('prepareQrCameraBatch');
  const list = document.getElementById('prepareQrCameraList');
  const count = document.getElementById('prepareQrCameraCount');
  const confirm = document.getElementById('prepareQrConfirm');
  if (wrap) wrap.classList.toggle('show', memsPrepareQrDraftItems.length > 0);
  if (count) count.textContent = memsPrepareQrDraftItems.length + ' เครื่อง';
  if (confirm) confirm.disabled = memsPrepareQrDraftItems.length === 0 || memsPrepareQrHandling;
  if (!list) return;
  list.replaceChildren();
  memsPrepareQrDraftItems.forEach((item, index) => {
    const chip = document.createElement('div');
    chip.className = 'prepare-qr-chip';
    const label = document.createElement('span');
    label.textContent = item.equipment + ' · No. ' + item.number;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'นำ ' + item.equipment + ' No. ' + item.number + ' ออกจากรายการ');
    remove.onclick = () => {
      memsPrepareQrDraftItems.splice(index, 1);
      memsRenderPrepareQrDraft();
    };
    chip.append(label, remove);
    list.appendChild(chip);
  });
}

function memsRenderPrepareQrSelection() {
  const summary = document.getElementById('prepareQrSelection');
  if (!summary) return;
  summary.classList.toggle('show', memsPrepareQrBatchItems.length > 0);
  summary.textContent = memsPrepareQrBatchItems.length
    ? '✓ เลือกแล้ว ' + memsPrepareQrBatchItems.length + ' เครื่อง: ' +
      memsPrepareQrBatchItems.map(item => item.equipment + ' No.' + item.number).join(', ')
    : '';
}

function memsResetPrepareQrBatch() {
  memsPrepareQrDraftItems = [];
  memsPrepareQrBatchItems = [];
  memsPrepareQrLastValue = '';
  memsPrepareQrLastReadAt = 0;
  memsRenderPrepareQrDraft();
  memsRenderPrepareQrSelection();
}

async function memsInitPrepareQrCamera() {
  try {
    memsPrepareQrEnabled = await fetchQrScannerEnabled();
  } catch (err) {
    console.error('โหลดการตั้งค่า QR ไม่สำเร็จ', err);
    memsPrepareQrEnabled = true;
  }
  const card = document.getElementById('prepareQrCameraCard');
  if (card) card.style.display = memsPrepareQrEnabled ? '' : 'none';
  if (!memsPrepareQrEnabled) closePrepareQrCamera();
  return memsPrepareQrEnabled;
}

async function openPrepareQrCamera() {
  if (!memsPrepareQrEnabled) {
    toast('โหมดสแกน QR ถูกปิดโดยแอดมิน');
    return;
  }
  const modal = document.getElementById('prepareQrCameraModal');
  const video = document.getElementById('prepareQrVideo');
  memsPrepareQrDraftItems = memsPrepareQrBatchItems.slice();
  memsPrepareQrLastValue = '';
  memsPrepareQrLastReadAt = 0;
  memsRenderPrepareQrDraft();
  modal.classList.add('show');
  memsSetPrepareQrStatus('กำลังเปิดกล้อง…', false);

  if (!window.isSecureContext || !navigator.mediaDevices) {
    memsSetPrepareQrStatus('เปิดกล้องไม่ได้ กรุณาใช้งานผ่าน HTTPS และอนุญาตสิทธิ์กล้อง', true);
    return;
  }
  if (typeof QrScanner === 'undefined') {
    memsSetPrepareQrStatus('โหลดตัวอ่าน QR ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', true);
    return;
  }

  try {
    if (!(await QrScanner.hasCamera())) throw new Error('ไม่พบกล้องในอุปกรณ์นี้');
    if (memsPrepareQrScanner) memsPrepareQrScanner.destroy();
    memsPrepareQrScanner = new QrScanner(video, result => {
      const value = result && typeof result === 'object' ? result.data : result;
      memsHandlePrepareQrResult(value);
    }, {
      preferredCamera: 'environment',
      maxScansPerSecond: 10,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true
    });
    await memsPrepareQrScanner.start();
    memsSetPrepareQrStatus('เล็งกรอบไปที่ QR บนตัวเครื่อง', false);
  } catch (err) {
    console.error(err);
    memsSetPrepareQrStatus('เปิดกล้องไม่สำเร็จ: ' + (err.message || err), true);
  }
}

function closePrepareQrCamera(clearDraft = true) {
  if (memsPrepareQrScanner) {
    memsPrepareQrScanner.destroy();
    memsPrepareQrScanner = null;
  }
  memsPrepareQrHandling = false;
  const modal = document.getElementById('prepareQrCameraModal');
  if (modal) modal.classList.remove('show');
  const video = document.getElementById('prepareQrVideo');
  if (video) video.srcObject = null;
  if (clearDraft) {
    memsPrepareQrDraftItems = [];
    memsRenderPrepareQrDraft();
  }
}

function memsConfirmPrepareQrBatch() {
  if (memsPrepareQrHandling || !memsPrepareQrDraftItems.length) return;
  memsPrepareQrBatchItems = memsPrepareQrDraftItems.slice();
  memsRenderPrepareQrSelection();
  closePrepareQrCamera(false);
  toast('✅ เลือกจากกล้องแล้ว ' + memsPrepareQrBatchItems.length + ' เครื่อง');
}

async function memsHandlePrepareQrResult(raw) {
  if (memsPrepareQrHandling) return;
  const now = Date.now();
  if (raw === memsPrepareQrLastValue && now - memsPrepareQrLastReadAt < 1500) return;
  memsPrepareQrLastValue = raw;
  memsPrepareQrLastReadAt = now;
  const assetId = memsPrepareAssetIdFromScan(raw);
  if (!assetId) {
    memsSetPrepareQrStatus('QR นี้ไม่ใช่ป้ายเครื่องจากระบบ MEMs กรุณาลองใหม่', true);
    return;
  }

  memsPrepareQrHandling = true;
  memsSetPrepareQrStatus('กำลังตรวจสอบข้อมูลเครื่อง…', false);
  try {
    const { data, error } = await supabase
      .from('assets')
      .select('id,no,type,status')
      .eq('id', assetId)
      .limit(1);
    if (error) throw error;
    if (!data || !data.length) throw new Error('ไม่พบเครื่องนี้ในทะเบียนครุภัณฑ์');

    const asset = data[0];
    const requestedEquip = asset.type === 'อื่นๆ' ? 'เครื่องมืออื่นๆ' : String(asset.type || '');
    const equipButton = Array.from(document.querySelectorAll('.equip-chip'))
      .find(button => button.textContent.trim().toLowerCase() === requestedEquip.toLowerCase());
    if (!equipButton) throw new Error('ไม่พบประเภทเครื่อง “' + requestedEquip + '” ในหน้าเตรียมเครื่อง');

    const no = normalizeMachineNo(asset.no) || String(asset.no);
    const duplicate = memsPrepareQrDraftItems.some(item => item.equipment === requestedEquip && item.number === no);
    if (!duplicate) {
      memsPrepareQrDraftItems.push({ asset, equipment: requestedEquip, number: no });
      memsRenderPrepareQrDraft();
    }
    memsSetPrepareQrStatus(
      (duplicate ? 'มีเครื่องนี้ในรายการแล้ว: ' : 'รับแล้ว: ') + requestedEquip + ' No.' + no +
      ' — สแกนเครื่องถัดไป หรือกดยืนยันเมื่อครบ',
      false
    );
    memsPrepareQrHandling = false;
    memsRenderPrepareQrDraft();
  } catch (err) {
    console.error(err);
    memsSetPrepareQrStatus('สแกนไม่สำเร็จ: ' + (err.message || err), true);
    memsPrepareQrHandling = false;
  }
}

window.addEventListener('pagehide', closePrepareQrCamera);
