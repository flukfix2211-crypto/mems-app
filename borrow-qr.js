/* MEMs � QR return flow.
 * Accepts links produced by asset-qr.js and input from a USB/Bluetooth 2D scanner.
 */
let memsQrReturnAsset = null;
let memsGlobalScannerInstalled = false;
let memsScanIntendedAction = null;
let memsQrScannerEnabled = true;
let memsPromptScanTimer = null;
let memsPromptScanProcessing = false;
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

// ����ͧ�᡹Ẻ keyboard wedge �о���������Ҥ�����촢ͧ����ͧ
// �֧��ͧ�ŧ�ѡ��� Thai Kedmanee ��Ѻ�繻��� US ��͹��ҹ URL �ҡ QR
const memsThaiKedmaneeToAscii = Object.freeze({
  '�': '1', '/': '2', '-': '3', '�': '4', '�': '5', '�': '6', '�': '7', '�': '8', '�': '9', '�': '0',
  '�': '-', '�': '=',
  '�': 'q', '�': 'w', '�': 'e', '�': 'r', '�': 't', '�': 'y', '�': 'u', '�': 'i', '�': 'o', '�': 'p',
  '�': '[', '�': ']', '�': '\\',
  '�': 'a', '�': 's', '�': 'd', '�': 'f', '�': 'g', '�': 'h', '�': 'j', '�': 'k', '�': 'l', '�': ';', '�': "'",
  '�': 'z', '�': 'x', '�': 'c', '�': 'v', '�': 'b', '�': 'n', '�': 'm', '�': ',', '�': '.', '�': '/',
  '�': ':', '�': '?', '�': '&'
});

function memsNormalizeScannerText(raw) {
  const value = String(raw || '').trim();
  if (!/[\u0E00-\u0E7F]/.test(value)) return value;
  return Array.from(value, character => memsThaiKedmaneeToAscii[character] || character).join('');
}

function memsQrEquipmentName(type) {
  return type === '����' ? '����ͧ�������' : String(type || '');
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
    typeEl.textContent = '';
    noEl.textContent = '';
    return;
  }
  typeEl.textContent = equipmentName || memsQrEquipmentName(asset.type);
  noEl.textContent = 'No. ' + asset.no;
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
    console.error('��Ŵ��õ�駤�� QR ��������', err);
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
  if (actionEl) actionEl.textContent = action === 'borrow' ? '����¡���������ͧ' : '����¡�ä׹����ͧ';
  if (hint) {
    hint.textContent = '�ԧ����ͧ�᡹��ѹ�� ����ͧ��ԡ��ͧ��͡������';
    hint.classList.remove('error');
  }
  if (memsPromptScanTimer) clearTimeout(memsPromptScanTimer);
  memsPromptScanTimer = null;
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
  if (clearIntent) memsScanIntendedAction = null;
}

function memsSetQrScanPromptProcessing(processing) {
  const prompt = document.getElementById('qrScanPrompt');
  const input = document.getElementById('qrScanPromptInput');
  const cancel = document.getElementById('qrScanPromptCancel');
  const hint = document.getElementById('qrScanPromptHint');
  memsPromptScanProcessing = Boolean(processing);
  if (prompt) prompt.classList.toggle('processing', memsPromptScanProcessing);
  if (input) input.readOnly = memsPromptScanProcessing;
  if (cancel) cancel.disabled = memsPromptScanProcessing;
  if (hint && memsPromptScanProcessing) {
    hint.textContent = '���ѧ�����żŢ���������ͧ�';
    hint.classList.remove('error');
  }
}

function memsSetQrScanPromptError(message) {
  const hint = document.getElementById('qrScanPromptHint');
  if (!hint) return;
  hint.textContent = message;
  hint.classList.add('error');
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
    memsSetQrScanPromptError('QR Code ���������������ͧ�ҡ�к� MEMs � ��س��ͧ�ա����');
    input.focus({ preventScroll: true });
    return;
  }
  input.value = '';
  memsSetQrScanPromptProcessing(true);
  const success = await memsUseQrAssetId(assetId);
  memsSetQrScanPromptProcessing(false);
  if (!success && document.getElementById('qrScanPrompt')?.classList.contains('show')) {
    input.focus({ preventScroll: true });
  }
}

function memsClearQrReturnContext() {
  memsQrReturnAsset = null;
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
  } catch (err) { /* ��Ǩ�ٻẺ����Ţ��ҹ��ҧ */ }
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
  const payload = memsScannerState.buffer.trim();
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
  memsUseQrAssetId(assetId);
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
  if (!assetId) throw new Error('��辺��������ͧ� QR Code');
  const { data, error } = await supabase
    .from('assets')
    .select('id,no,asset_code,type,status')
    .eq('id', assetId)
    .limit(1);
  if (error) throw error;
  if (!data || !data.length) throw new Error('��辺����ͧ���㹷���¹����ѳ��');
  return data[0];
}

function memsSelectBorrowedWard(ward) {
  const wardSelect = document.getElementById('wardSel');
  if (!wardSelect || !ward) throw new Error('��辺˹��§ҹ����������ͧ���');
  let option = Array.from(wardSelect.options).find(item => item.value === ward);
  if (!option) {
    option = new Option(ward, ward);
    option.dataset.memsAutoWard = 'true';
    const otherOption = Array.from(wardSelect.options)
      .find(item => item.value === '���� �ô�кت��͵֡');
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
    throw new Error('����ͧ����������¡�������ҧ���� �֧�ѧ�׹�����');
  }
  if (!status.ward) throw new Error('��¡���������ش����բ����ŵ֡/˹��§ҹ');
  return status;
}

async function memsUseQrAssetId(assetId, options) {
  const targetAction = (options && options.action) || memsScanIntendedAction || S.action || 'return';
  if (S.action !== targetAction) setAction(targetAction);
  memsSetQrDevice(null);
  memsSetQrBanner('���ѧ��Ǩ�ͺ����������ͧ�ҡ����¹�', 'loading');
  try {
    const asset = await memsLoadQrAsset(assetId);
    memsQrReturnAsset = asset;
    const requestedEquip = memsQrEquipmentName(asset.type);
    const equipButton = Array.from(document.querySelectorAll('.equip-btn'))
      .find(button => String(button.dataset.e).toLowerCase() === requestedEquip.toLowerCase());

    memsSyncQrScanCard(targetAction);
    if (!equipButton) throw new Error('��辺����������ͧ �' + requestedEquip + '� �˹�ҷ���¡��');
    const equip = equipButton.dataset.e;
    if (targetAction === 'return') {
      memsSetQrBanner('���ѧ����˹��§ҹ����������ͧ���', 'loading');
      const borrowedStatus = await memsLoadBorrowedStatus(equip, asset.no);
      memsSelectBorrowedWard(borrowedStatus.ward);
    }
    memsHideQrScanPrompt(true);
    memsSetQrDevice(asset, equip);
    pickEquip(equipButton, equip);
    memsPrimeQrNumber(equip, asset.no);

    const ward = document.getElementById('wardSel').value;
    if (!ward) {
      memsSetQrBanner('�᡹����: ' + equip + ' No.' + asset.no + ' � ��س����͡˹��§ҹ����ͧ������', 'ready');
      return true;
    }
    await memsApplyQrSelection();
    return true;
  } catch (err) {
    console.error(err);
    memsQrReturnAsset = null;
    memsSetQrDevice(null);
    memsSetQrBanner('?? ��ҹ QR ��������: ' + (err.message || err), 'error');
    if (document.getElementById('qrScanPrompt')?.classList.contains('show')) {
      memsSetQrScanPromptError('�᡹��������: ' + (err.message || err) + ' � ��س��ͧ�ա����');
    }
    return false;
  }
}

function memsPrimeQrNumber(equip, number) {
  const no = String(number);
  if (GRID_EQUIPS.has(equip)) {
    c2SelectedNums.clear();
    c2SelectedNums.add(no);
    updateC2SelInfo();
    return;
  }
  resetEquipFields();
  const numberInput = document.getElementById('equipNum1');
  if (!numberInput) return;
  numberInput.value = no;
  numberInput.dispatchEvent(new Event('input', { bubbles: true }));
}

async function memsProcessQrScan() {
  if (!memsQrScannerEnabled) return;
  const input = document.getElementById('qrScanInput');
  const assetId = memsAssetIdFromScan(input && input.value);
  if (!assetId) {
    memsSetQrBanner('?? QR Code ���������������ͧ�ҡ�к� MEMs', 'error');
    return;
  }
  if (input) input.value = '';
  await memsUseQrAssetId(assetId, { action: 'return' });
}

async function memsApplyQrSelection() {
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
    memsSetQrBanner('�᡹����: ' + requestedEquip + ' No.' + no + ' � ��س����͡˹��§ҹ����ͧ������', 'ready');
    return;
  }

  try {
    preparedList = await fetchPreparedList();
    renderPreparedBanner();
    filterEquipButtons();
  } catch (err) {
    console.error(err);
    memsSetQrBanner('?? ��Ǩ�ͺ��¡������ͧ������������������� ��س��ͧ����', 'error');
    return;
  }

  const prepared = preparedList.find(item =>
    item.ward === ward &&
    String(item.equipment || '').toLowerCase() === requestedEquip.toLowerCase() &&
    (normalizeMachineNo(item.number) || String(item.number)) === no
  );
  if (!prepared) {
    clearPreparedSelection();
    memsSetQrBanner('?? ' + requestedEquip + ' No.' + no + ' �ѧ�����١������������Ѻ˹��§ҹ���', 'error');
    return;
  }

  const equipButton = Array.from(document.querySelectorAll('.equip-btn'))
    .find(button => String(button.dataset.e).toLowerCase() === requestedEquip.toLowerCase());
  if (!equipButton) {
    memsSetQrBanner('?? ��辺����������ͧ �' + requestedEquip + '� �˹�ҷ���¡��', 'error');
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

  memsSetQrBanner('? ���͡����: ' + equip + ' No.' + no + ' � ��͡���ͼ��������ǡ��ѹ�֡', 'success');
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
    memsSetQrBanner('�᡹����: ' + requestedEquip + ' No.' + no + ' � ��س����͡˹��§ҹ�����Ҥ׹', 'ready');
    return;
  }

  const equipButton = Array.from(document.querySelectorAll('.equip-btn'))
    .find(button => String(button.dataset.e).toLowerCase() === requestedEquip.toLowerCase());
  if (!equipButton) {
    memsSetQrBanner('?? ��辺����������ͧ �' + requestedEquip + '� �˹�Ҥ׹����ͧ', 'error');
    return;
  }
  const equip = equipButton.dataset.e;
  if (S.equip !== equip) pickEquip(equipButton, equip);

  if (GRID_EQUIPS.has(equip)) {
    // No. ����ʴ��ѹ����ѧ�᡹����§ preview � ��ͧ��ҧ�������͡����
    // �ҡ��¡�÷�������ԧ�ͧ˹��§ҹ ���������������ԡҡ�ä׹����ͧ
    c2SelectedNums.clear();
    updateC2SelInfo();
    if (equip === 'C2') await loadC2Status();
    else await loadEquipStatus();
    const numberButton = Array.from(document.querySelectorAll('#c2Grid [data-num]'))
      .find(button => String(button.dataset.num) === no);
    if (!numberButton) {
      memsSetQrBanner('?? ' + equip + ' No.' + no + ' ����������¡�÷��˹��§ҹ������ ��سҵ�Ǩ�ͺ˹��§ҹ', 'error');
      return;
    }
    toggleC2Num(no, numberButton);
  } else {
    resetEquipFields();
    const numberInput = document.getElementById('equipNum1');
    numberInput.value = no;
    numberInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  memsSetQrBanner('? ���͡����: ' + equip + ' No.' + no + ' � ��͡���ͼ��׹���ǡ��ѹ�֡', 'success');
  const staffInput = document.getElementById('staffName');
  if (staffInput) staffInput.focus({ preventScroll: true });
}

