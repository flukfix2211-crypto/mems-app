/* MEMs — camera QR flow for the equipment preparation page. */
let memsPrepareQrScanner = null;
let memsPrepareQrHandling = false;
let memsPrepareQrEnabled = false;

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

function closePrepareQrCamera() {
  if (memsPrepareQrScanner) {
    memsPrepareQrScanner.destroy();
    memsPrepareQrScanner = null;
  }
  memsPrepareQrHandling = false;
  const modal = document.getElementById('prepareQrCameraModal');
  if (modal) modal.classList.remove('show');
  const video = document.getElementById('prepareQrVideo');
  if (video) video.srcObject = null;
}

async function memsHandlePrepareQrResult(raw) {
  if (memsPrepareQrHandling) return;
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

    equipButton.click();
    const no = normalizeMachineNo(asset.no) || String(asset.no);
    const existing = getNumberValues().map(value => normalizeMachineNo(value) || value);
    if (!existing.includes(no)) {
      const emptyInput = Array.from(document.querySelectorAll('.number-input')).find(input => !input.value.trim());
      if (emptyInput) {
        emptyInput.value = no;
        emptyInput.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        addNumberField(no, false);
      }
    }

    closePrepareQrCamera();
    toast((existing.includes(no) ? 'ℹ️ มีเครื่องนี้ในรายการแล้ว: ' : '✅ สแกนแล้ว: ') + equipButton.textContent.trim() + ' No.' + no);
  } catch (err) {
    console.error(err);
    memsSetPrepareQrStatus('สแกนไม่สำเร็จ: ' + (err.message || err), true);
    memsPrepareQrHandling = false;
  }
}

window.addEventListener('pagehide', closePrepareQrCamera);
