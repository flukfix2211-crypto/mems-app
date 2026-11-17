// Use the same monochrome icons for static and dynamically rendered controls.
(() => {
  'use strict';
  const ns = 'http://www.w3.org/2000/svg';
  const icons = {
    '💾': ['บันทึก', 'M5 3h12l4 4v14H3V3h2zm2 0v6h10V3M7 21v-7h10v7'],
    '🔄': ['รีเฟรช', 'M20 7v5h-5M4 17v-5h5m-5 0a8 8 0 0 1 14-5l2 5M4 12l2 5a8 8 0 0 0 14-5'],
    '✏': ['แก้ไข', 'm4 16-1 5 5-1L20 8l-4-4L4 16zm10-10 4 4'],
    '🗑': ['ลบ', 'M3 6h18M9 6V3h6v3m4 0-1 15H6L5 6m5 4v7m4-7v7'],
    '🏠': ['หน้าหลัก', 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7'],
    '🔍': ['ค้นหา', 'M15 15l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'],
    '📋': ['รายการ', 'M8 5H5v16h14V5h-3m-8-2h8v4H8zm0 9h8m-8 4h8'],
    '📷': ['กล้อง', 'M3 7h4l2-3h6l2 3h4v13H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
    '🚚': ['ส่งเครื่อง', 'M3 6h11v11H3zm11 4h4l3 4v3h-7M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm11 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'],
    '✅': ['ยืนยัน', 'm4 12 5 5L20 6'],
    '🔧': ['ซ่อม', 'M14 6a5 5 0 0 0-6 6L3 17l4 4 5-5a5 5 0 0 0 6-6l-3 3-4-4z'],
    '📡': ['ติดตามเครื่อง', 'M4 15a5 5 0 0 1 5 5M4 10a10 10 0 0 1 10 10M4 5a15 15 0 0 1 15 15M4 20h.01'],
    '📊': ['แดชบอร์ด', 'M3 3v18h18M8 16v-5m5 5V7m5 9v-3'],
    '🧰': ['เตรียมเครื่องมือ', 'M3 7h18v13H3zM8 7V4h8v3M3 12h18m-13 0v2m8-2v2'],
    '🎲': ['สุ่ม', 'M4 4h16v16H4zm4 4h.01M12 12h.01M16 16h.01'],
    '⏳': ['กำลังดำเนินการ', 'M6 3h12M6 21h12M7 3v5l5 4-5 4v5m10-18v5l-5 4 5 4v5']
  };
  icons['🔁'] = icons['🔄'];
  icons['🛠'] = icons['🔧'];
  icons['🔎'] = icons['🔍'];

  const controls = 'button, a, summary, [role="button"]';
  const decorations = '.menu-icon, .nav-icon, .page-title';
  const selector = `${controls}, ${decorations}`;
  const emoji = /^(\p{Extended_Pictographic})[\uFE0E\uFE0F]?\s*/u;

  function format(element) {
    if (element.closest('.site-footer, .mems-guide-rail')) return;
    const text = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const match = text?.textContent.trimStart().match(emoji);
    if (!match || element.querySelector('svg')) return;
    const rest = text.textContent.trimStart().slice(match[0].length);
    const icon = icons[match[1]];
    const hasLabel = Boolean(rest.trim() || Array.from(element.children).some(child => child.textContent.trim()));
    if (!hasLabel && !icon) return;
    if (icon) {
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'mems-control-icon');
      svg.classList.toggle('mems-control-icon-only', !hasLabel);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', icon[1]);
      svg.append(path);
      text.before(svg);
      if (!hasLabel && element.matches(controls) && !element.hasAttribute('aria-label')) {
        element.setAttribute('aria-label', element.title || icon[0]);
      }
    }
    text.textContent = rest;
  }

  function scan(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches(selector)) format(root);
    root.querySelectorAll(selector).forEach(format);
  }

  scan(document.body);
  new MutationObserver(changes => {
    for (const change of changes) {
      if (change.target.matches?.(selector)) format(change.target);
      change.addedNodes.forEach(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
