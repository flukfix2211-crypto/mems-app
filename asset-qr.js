/* MEMs — QR label printing for the asset registry.
 * Each label is exactly 30 x 30 mm. An A4 page contains 6 x 9 labels (54).
 * Requires qrcode-generator, jsPDF, and reports.js.
 */
const selectedQrAssetIds = new Set();
let currentVisibleAssets = [];

function qrAssetKey(asset) {
  return String(asset && asset._rowIndex);
}

function getSelectedQrAssets() {
  const byId = new Map(allAssets.map(asset => [qrAssetKey(asset), asset]));
  return [...selectedQrAssetIds]
    .map(id => byId.get(id))
    .filter(Boolean);
}

function pruneQrSelection() {
  const validIds = new Set(allAssets.map(qrAssetKey));
  [...selectedQrAssetIds].forEach(id => {
    if (!validIds.has(id)) selectedQrAssetIds.delete(id);
  });
  updateQrSelectionBar();
}

function toggleQrAsset(assetId, checked) {
  const id = String(assetId);
  if (checked) selectedQrAssetIds.add(id);
  else selectedQrAssetIds.delete(id);
  updateQrSelectionBar();
}

function toggleAllVisibleQrAssets(checked) {
  currentVisibleAssets.forEach(asset => {
    const id = qrAssetKey(asset);
    if (checked) selectedQrAssetIds.add(id);
    else selectedQrAssetIds.delete(id);
  });
  document.querySelectorAll('.qr-row-check').forEach(input => {
    input.checked = checked;
  });
  updateQrSelectionBar();
}

function selectAllVisibleQrAssets() {
  toggleAllVisibleQrAssets(true);
}

function clearQrAssetSelection() {
  selectedQrAssetIds.clear();
  document.querySelectorAll('.qr-row-check, #qrCheckAll').forEach(input => {
    input.checked = false;
    input.indeterminate = false;
  });
  updateQrSelectionBar();
}

function updateQrSelectionBar() {
  const count = getSelectedQrAssets().length;
  const countEl = document.getElementById('qrSelectedCount');
  const pdfBtn = document.getElementById('qrPdfBtn');
  const headerCheck = document.getElementById('qrCheckAll');
  if (countEl) countEl.textContent = 'เลือกแล้ว ' + count + ' เครื่อง';
  if (pdfBtn) {
    pdfBtn.disabled = count === 0;
    pdfBtn.textContent = count ? '⬇ สร้าง PDF (' + count + ')' : '⬇ สร้าง PDF';
  }
  if (headerCheck) {
    const visibleIds = currentVisibleAssets.map(qrAssetKey);
    const selectedVisible = visibleIds.filter(id => selectedQrAssetIds.has(id)).length;
    headerCheck.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    headerCheck.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  }
}

function buildAssetReturnUrl(asset) {
  const url = new URL('borrow.html', window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('mode', 'return');
  url.searchParams.set('asset', String(asset._rowIndex));
  return url.toString();
}

function fitQrLabelText(doc, text, maxWidth, initialSize, minSize) {
  let size = initialSize;
  doc.setFontSize(size);
  while (size > minSize && doc.getTextWidth(text) > maxWidth) {
    size -= 0.25;
    doc.setFontSize(size);
  }
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && doc.getTextWidth(shortened + '…') > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return shortened + '…';
}

function drawVectorQr(doc, payload, x, y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const moduleSize = size / (count + quiet * 2);
  const startX = x + quiet * moduleSize;
  const startY = y + quiet * moduleSize;

  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, size, size, 'F');
  doc.setFillColor(0, 0, 0);
  for (let row = 0; row < count; row++) {
    let runStart = -1;
    for (let col = 0; col <= count; col++) {
      const dark = col < count && qr.isDark(row, col);
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        doc.rect(
          startX + runStart * moduleSize,
          startY + row * moduleSize,
          (col - runStart) * moduleSize + 0.01,
          moduleSize + 0.01,
          'F'
        );
        runStart = -1;
      }
    }
  }
}

function drawAssetQrLabel(doc, asset, x, y) {
  const labelSize = 30;
  const type = String(asset.ประเภท || 'เครื่องมือแพทย์');
  const no = String(asset['No.'] == null ? '—' : asset['No.']);

  doc.setDrawColor(185, 205, 211);
  doc.setLineWidth(0.12);
  doc.rect(x, y, labelSize, labelSize, 'S');

  if (doc.__memsLogoDataUrl) {
    doc.addImage(doc.__memsLogoDataUrl, 'PNG', x + 1.3, y + 1.0, 4.3, 4.3, 'mems-label-logo', 'FAST');
  } else {
    doc.setTextColor(10, 100, 120);
    doc.setFontSize(6.5);
    doc.text('MEMs', x + 1.4, y + 3.7);
  }

  doc.setFont(PDF_FONT, 'normal');
  doc.setTextColor(25, 45, 53);
  const title = fitQrLabelText(doc, type, 22.2, 7.2, 5.2);
  doc.text(title, x + 6.1, y + 3.55);

  drawVectorQr(doc, buildAssetReturnUrl(asset), x + 5.8, y + 5.5, 18.4);

  doc.setTextColor(10, 100, 120);
  const numberText = fitQrLabelText(doc, 'No. ' + no, 27, 9.2, 7.2);
  doc.text(numberText, x + 15, y + 25.6, { align: 'center' });

  doc.setTextColor(106, 138, 150);
  doc.setFontSize(4.6);
  doc.text('สแกนเพื่อคืนเครื่อง', x + 15, y + 28.35, { align: 'center' });
}

async function createAssetQrPdf() {
  const assets = getSelectedQrAssets();
  if (!assets.length) {
    showToast('กรุณาเลือกเครื่องอย่างน้อย 1 รายการ');
    return;
  }
  if (typeof qrcode !== 'function' || !window.jspdf || typeof newThaiPdf !== 'function') {
    showToast('โหลดเครื่องมือสร้าง PDF ไม่สำเร็จ กรุณารีเฟรชหน้า');
    return;
  }

  const button = document.getElementById('qrPdfBtn');
  const oldText = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = '⏳ กำลังสร้าง PDF…';
  }

  try {
    const doc = await newThaiPdf({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const cols = 6;
    const rows = 9;
    const perPage = cols * rows;
    const cell = 30;
    const marginX = 15;
    const marginY = 13.5;

    assets.forEach((asset, index) => {
      if (index > 0 && index % perPage === 0) doc.addPage('a4', 'portrait');
      const pageIndex = index % perPage;
      const col = pageIndex % cols;
      const row = Math.floor(pageIndex / cols);
      drawAssetQrLabel(doc, asset, marginX + col * cell, marginY + row * cell);
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = 'MEMS_QR_labels_' + stamp + '.pdf';
    rptDeliverPdf(doc, filename, { preview: true });
    showToast('✅ สร้าง PDF ' + assets.length + ' ป้ายแล้ว (พิมพ์ขนาดจริง 100%)');
  } catch (err) {
    console.error(err);
    showToast('❌ สร้าง PDF ไม่สำเร็จ: ' + (err.message || err));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText;
    }
    updateQrSelectionBar();
  }
}
