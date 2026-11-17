(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches || !('IntersectionObserver' in window) || !Element.prototype.animate) return;

  const sections = document.querySelectorAll([
    '.mems-home-hero',
    '.home-actions > .menu-card',
    '.mems-operation > .content > .card',
    '.mems-operation > .content > .prepared-panel',
    '.mems-dashboard #viewHome > :is(.dash-page-heading, .dash-summary, .card)',
    '.dash-home-panels > .card',
    '.mems-dashboard .nav-grid .nav-card',
    '.report-intro',
    '.report-actions > .action-card',
    '.mems-report .history-card',
    '.stats-intro',
    '.mems-c2-stats .analysis-section',
    '.pm-intro',
    '.pm-shell .pm-card',
    '.cal-picker-heading',
    '.cal-type-grid > .cal-type',
    '.mems-calibration .cal-catalogue',
    '.mems-tag > .main > .card',
  ].join(','));
  if (!sections.length) return;

  const animations = new Set();
  const observer = new IntersectionObserver(entries => {
    const entering = entries.filter(({ isIntersecting }) => isIntersecting);
    entering.forEach(({ target }, index) => {
      observer.unobserve(target);
      if (target.contains(document.activeElement) || document.hidden || reducedMotion.matches ||
          document.body.classList.contains('mems-no-motion')) return;

      const animation = target.animate(
        [{ translate: '0 9px', opacity: 0.72 }, { translate: '0 0', opacity: 1 }],
        { duration: 380, delay: Math.min(index, 3) * 36, easing: 'cubic-bezier(.2,.75,.2,1)' },
      );
      const clear = () => {
        animations.delete(animation);
        target.removeEventListener('focusin', stop);
      };
      const stop = () => animation.cancel();
      animations.add(animation);
      target.addEventListener('focusin', stop, { once: true });
      animation.addEventListener('finish', clear, { once: true });
      animation.addEventListener('cancel', clear, { once: true });
    });
  });

  reducedMotion.addEventListener('change', ({ matches }) => {
    if (!matches) return;
    for (const animation of animations) animation.cancel();
  });
  document.addEventListener('mems:motion-change', () => {
    if (!document.body.classList.contains('mems-no-motion')) return;
    for (const animation of animations) animation.cancel();
  });
  for (const section of sections) observer.observe(section);
})();
(() => {
  const stage = document.querySelector('.dash-motion-art');
  if (!stage) return;

  const wheel = stage.querySelector('.dash-motion-orbit');
  const angle = wheel.querySelector('.dash-wheel-angle');
  let rotation = 0;
  let gesture = null;
  let dragged = false;

  const rotate = degrees => {
    rotation = degrees % 360;
    angle.style.rotate = rotation + 'deg';
  };

  wheel.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    dragged = false;
    gesture = { id: event.pointerId, x: event.clientX, angle: rotation };
    wheel.setPointerCapture(event.pointerId);
  });

  wheel.addEventListener('pointermove', event => {
    if (event.pointerId !== gesture?.id) return;
    const delta = event.clientX - gesture.x;
    if (!dragged && Math.abs(delta) < 5) return;
    dragged = true;
    rotate(gesture.angle + delta * 1.5);
  });

  wheel.addEventListener('lostpointercapture', () => { gesture = null; });

  wheel.addEventListener('click', event => {
    if (event.detail === 0 || !dragged) rotate(rotation + 36);
  });

  stage.querySelector('.dash-motion-reset').addEventListener('click', () => {
    rotate(0);
    const spin = angle.querySelector('img').getAnimations().find(animation => animation.animationName === 'mems-wheel-turn');
    if (spin) spin.currentTime = 0;
  });
})();
(() => {
  const routes = [
    ['index.html', 'หน้าหลัก', ''],
    ['dashboard.html', 'ภาพรวม', 'dashboard'],
    ['assets.html', 'ทะเบียนเครื่องมือ', 'assets'],
    ['borrow.html', 'ยืม–คืนเครื่องมือ', 'borrow'],
    ['prepare.html', 'เตรียมเครื่องมือ', 'prepare'],
    ['round.html', 'Round Ward', 'round'],
    ['fixjob.html', 'แก้ไขหน้างาน', 'fixjob'],
    ['pm-reports.html', 'PM และตรวจรับ', 'pm_reports'],
    ['calibration.html', 'สอบเทียบ', 'calibration'],
    ['admin_report.html', 'รายงานประจำเดือน', 'dashboard'],
    ['c2-statistics.html', 'สถิติยืม–คืน', 'dashboard'],
    ['memstag.html', 'MEMSTAG', 'super_admin'],
    ['settings.html', 'ตั้งค่า', 'super_admin'],
  ];
  const page = location.pathname.split('/').pop() || 'index.html';
  const storageKey = 'mems-motion-paused';
  let paused = false;
  try { paused = localStorage.getItem(storageKey) === 'true'; } catch { /* Storage is optional. */ }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function setMotionPreference() {
    document.body.classList.toggle('mems-no-motion', paused || reducedMotion.matches);
    document.dispatchEvent(new Event('mems:motion-change'));
  }
  setMotionPreference();

  function mountWorkspace() {
    const profile = typeof MEMS_USER === 'undefined' ? null : MEMS_USER;
    if (!profile || document.body.classList.contains('mems-control-room')) return;

    const sidebar = document.querySelector('.dash-sidebar') || document.createElement('aside');
    sidebar.classList.add('mems-control-sidebar');
    sidebar.setAttribute('aria-label', 'เมนู MEMS');
    if (!sidebar.isConnected) {
      sidebar.innerHTML = '<a class="dash-brand" href="index.html"><img src="logo.png" width="46" height="46" alt=""><span><strong>MEMS</strong><small>ศูนย์เครื่องมือแพทย์</small></span></a>';
      document.body.prepend(sidebar);
    }

    const menu = document.createElement('details');
    menu.className = 'mems-control-menu';
    const summary = document.createElement('summary');
    summary.textContent = 'เมนูหลัก';
    menu.append(summary);

    const links = document.createElement('nav');
    links.className = 'mems-control-links';
    links.setAttribute('aria-label', 'หน้าต่าง ๆ ของ MEMS');
    for (const [href, label, permission] of routes) {
      const allowed = permission === 'super_admin'
        ? memsIsSuperAdmin(profile)
        : !permission || memsHasPermission(profile, permission);
      if (!allowed) continue;

      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      if (page === href) link.setAttribute('aria-current', 'page');
      links.append(link);
      if (permission === 'pm_reports' && profile.role !== 'admin') {
        link.hidden = true;
        memsShowPmNavigation(profile).then(enabled => { link.hidden = !enabled; });
      }
    }
    menu.append(links);

    const motion = document.createElement('label');
    motion.className = 'mems-control-motion';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const updateMotionControl = () => {
      checkbox.checked = paused || reducedMotion.matches;
      checkbox.disabled = reducedMotion.matches;
      setMotionPreference();
    };
    checkbox.addEventListener('change', () => {
      paused = checkbox.checked;
      try { localStorage.setItem(storageKey, String(paused)); } catch { /* Storage is optional. */ }
      updateMotionControl();
    });
    reducedMotion.addEventListener('change', updateMotionControl);
    updateMotionControl();
    motion.append(checkbox, ' ลดการเคลื่อนไหว');
    menu.append(motion);

    const desktop = matchMedia('(min-width: 901px)');
    const updateMenu = () => { menu.open = desktop.matches && page !== 'dashboard.html'; };
    desktop.addEventListener('change', updateMenu);
    updateMenu();
    sidebar.insertBefore(menu, sidebar.querySelector('.dash-sidebar-foot'));
    document.body.classList.add('mems-control-room');
  }

  document.addEventListener('mems:profile-ready', mountWorkspace);
  mountWorkspace();
})();
