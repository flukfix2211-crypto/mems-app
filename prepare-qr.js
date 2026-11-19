/* MEMs — camera QR flow for the equipment preparation page. */
let memsPrepareQrScanner = null;
let memsPrepareQrHandling = false;
let memsPrepareQrEnabled = false;
let memsPrepareQrDraftItems = [];
let memsPrepareQrBatchItems = [];
let memsPrepareQrLastValue = '';
let memsPrepareQrLastReadAt = 0;

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
  if (modal.classList.contains('show')) return;
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

  let scanner;
  try {
    let decoderFailed = false;
    scanner = new QrScanner(video, result => {
      if (memsPrepareQrScanner !== scanner) return;
      decoderFailed = false;
      memsHandlePrepareQrResult(result.data, scanner);
    }, {
      preferredCamera: 'environment',
      maxScansPerSecond: 8,
      calculateScanRegion: ({ videoWidth, videoHeight }) => {
        const size = Math.round(Math.min(videoWidth, videoHeight) * 2 / 3);
        const decodeSize = Math.min(size, 800);
        return {
          x: Math.round((videoWidth - size) / 2),
          y: Math.round((videoHeight - size) / 2),
          width: size,
          height: size,
          downScaledWidth: decodeSize,
          downScaledHeight: decodeSize
        };
      },
      onDecodeError: error => {
        if (memsPrepareQrScanner !== scanner || decoderFailed || error === QrScanner.NO_QR_CODE_FOUND) return;
        decoderFailed = true;
        console.error('อ่าน QR จากกล้องไม่สำเร็จ', error);
        memsSetPrepareQrStatus('ตัวอ่าน QR มีปัญหา กรุณาปิดแล้วเปิดกล้องใหม่ หรือเลือกเครื่องจากรายการ', true);
      },
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true
    });
    memsPrepareQrScanner = scanner;
    memsSetPrepareQrStatus('ให้ QR อยู่กลางกรอบและถือกล้องนิ่งจนภาพชัด', false);
    await scanner.start();
  } catch (err) {
    if (scanner && memsPrepareQrScanner !== scanner) return;
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

async function memsHandlePrepareQrResult(raw, scanner) {
  if (memsPrepareQrHandling) return;
  const now = Date.now();
  if (raw === memsPrepareQrLastValue && now - memsPrepareQrLastReadAt < 1500) return;
  memsPrepareQrLastValue = raw;
  memsPrepareQrLastReadAt = now;
  const assetId = memsReadAssetQr(raw);
  if (!assetId) {
    memsSetPrepareQrStatus('QR นี้ไม่ใช่ป้ายเครื่องจากระบบ MEMs กรุณาลองใหม่', true);
    return;
  }

  memsPrepareQrHandling = true;
  memsSetPrepareQrStatus('กำลังตรวจสอบข้อมูลเครื่อง…', false);
  try {
    const asset = await memsResolveAssetQr(assetId);
    const requestedEquip = String(asset.type || '').trim();
    const equipButton = Array.from(document.querySelectorAll('.equip-chip'))
      .find(button => memsTypeKey(button.textContent) === memsTypeKey(requestedEquip));
    if (!equipButton) throw new Error('ไม่พบประเภทเครื่อง “' + requestedEquip + '” ในหน้าเตรียมเครื่อง');

    const no = normalizeMachineNo(asset.no);
    if (asset.status !== 'ใช้งานได้') throw new Error('เครื่องไม่พร้อมใช้');
    const [prepared,statuses] = await Promise.all([fetchPreparedList(),fetchEquipmentStatus()]);
    if (memsPrepareQrScanner !== scanner) return;
    const machineKey = memsMachineKey(requestedEquip,no);
    if(statuses.some(s=>s.isReturnPending && memsMachineKey(s.equipment,s.number)===machineKey)) throw new Error('เครื่องรอตรวจและยืนยันการคืน กรุณาตรวจรับก่อนเตรียม');
    if(prepared.some(p=>memsMachineKey(p.equipment,p.number)===machineKey)) throw new Error('เครื่องถูกเตรียมหรือถูกยืมอยู่');
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
    if (memsPrepareQrScanner !== scanner) return;
    console.error(err);
    memsSetPrepareQrStatus('สแกนไม่สำเร็จ: ' + (err.message || err), true);
    memsPrepareQrHandling = false;
  }
}

window.addEventListener('pagehide', () => closePrepareQrCamera());
