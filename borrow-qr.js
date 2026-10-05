/* MEMs — QR return flow.
 * Accepts links produced by asset-qr.js and input from a USB/Bluetooth 2D scanner.
 */
let memsQrReturnAsset = null;

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

function memsSyncQrScanCard(action) {
  const card = document.getElementById('qrScanCard');
  if (!card) return;
  card.style.display = action === 'return' ? '' : 'none';
}

function memsClearQrReturnContext() {
  memsQrReturnAsset = null;
  const input = document.getElementById('qrScanInput');
  if (input) input.value = '';
  const banner = document.getElementById('qrReturnBanner');
  if (banner) banner.style.display = 'none';
}

function memsAssetIdFromScan(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.searchParams.get('asset') || parsed.searchParams.get('a') || '';
  } catch (err) {
    return /^\d+$/.test(value) ? value : '';
  }
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

async function memsUseQrAssetId(assetId) {
  memsSetQrBanner('กำลังตรวจสอบข้อมูลเครื่องจากทะเบียน…', 'loading');
  try {
    const asset = await memsLoadQrAsset(assetId);
    memsQrReturnAsset = asset;
    const requestedEquip = memsQrEquipmentName(asset.type);
    const equipButton = Array.from(document.querySelectorAll('.equip-btn'))
      .find(button => String(button.dataset.e).toLowerCase() === requestedEquip.toLowerCase());

    setAction('return');
    memsSyncQrScanCard('return');
    if (!equipButton) throw new Error('ไม่พบประเภทเครื่อง “' + requestedEquip + '” ในหน้าคืนเครื่อง');
    const equip = equipButton.dataset.e;
    pickEquip(equipButton, equip);

    const ward = document.getElementById('wardSel').value;
    if (!ward) {
      memsSetQrBanner('สแกนแล้ว: ' + equip + ' No.' + asset.no + ' — กรุณาเลือกหน่วยงานที่นำมาคืน', 'ready');
      return;
    }
    await memsApplyQrReturnSelection();
  } catch (err) {
    console.error(err);
    memsQrReturnAsset = null;
    memsSetQrBanner('⚠️ อ่าน QR ไม่สำเร็จ: ' + (err.message || err), 'error');
  }
}

async function memsProcessQrScan() {
  const input = document.getElementById('qrScanInput');
  const assetId = memsAssetIdFromScan(input && input.value);
  if (!assetId) {
    memsSetQrBanner('⚠️ QR Code นี้ไม่ใช่ป้ายเครื่องจากระบบ MEMs', 'error');
    return;
  }
  if (input) input.value = '';
  await memsUseQrAssetId(assetId);
}

async function memsHandleQrDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') || (params.get('m') === 'r' ? 'return' : '');
  const assetId = params.get('asset') || params.get('a');
  memsSyncQrScanCard(mode === 'return' ? 'return' : S.action);
  if (mode !== 'return' || !assetId) return;
  await memsUseQrAssetId(assetId);
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
    if (equip === 'C2') await loadC2Status();
    else await loadEquipStatus();
    const numberButton = Array.from(document.querySelectorAll('#c2Grid [data-num]'))
      .find(button => String(button.dataset.num) === no);
    if (!numberButton) {
      memsSetQrBanner('⚠️ ' + equip + ' No.' + no + ' ไม่อยู่ในรายการที่หน่วยงานนี้ยืม กรุณาตรวจสอบหน่วยงาน', 'error');
      return;
    }
    if (!c2SelectedNums.has(no)) toggleC2Num(no, numberButton);
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
