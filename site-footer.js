(function renderSiteFooter() {
  'use strict';

  if (document.querySelector('.site-footer')) return;

  document.body.classList.add('mems-has-site-footer');

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.setAttribute('aria-label', 'ข้อมูลระบบและเครดิต');

  if (document.querySelector('.submit-bar')) {
    footer.classList.add('site-footer--with-sticky-action');
  }

  footer.innerHTML = `
    <div class="site-footer__inner">
      <div class="site-footer__primary">
        <div class="site-footer__brand">
          <img src="logo.png" alt="" width="48" height="48">
          <div class="site-footer__brand-copy">
            <strong>MEMs</strong>
            <span>Medical Equipment Management Systems</span>
          </div>
        </div>
        <div class="site-footer__organization">
          <span class="site-footer__label">หน่วยงานเจ้าของระบบ</span>
          <strong>งานศูนย์เครื่องมือแพทย์</strong>
          <span>โรงพยาบาลพหลพลพยุหเสนา จังหวัดกาญจนบุรี</span>
        </div>
      </div>
      <div class="site-footer__meta">
        <span>© 2026 งานศูนย์เครื่องมือแพทย์</span>
        <div class="site-footer__credits">
          <span class="site-footer__version">Version 1.0</span>
          <span>พัฒนาและดูแลระบบโดย <strong>Pawarit Somchipeng</strong></span>
        </div>
      </div>
    </div>`;

  document.body.appendChild(footer);
})();
