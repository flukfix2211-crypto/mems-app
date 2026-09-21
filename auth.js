/**
 * MEMs — Auth (Supabase Auth session + สิทธิ์รายหน้า)
 * โหลดหลัง supabase-client.js เสมอ (ต้องใช้ตัวแปร `supabase` global)
 *
 * Session ของ supabase-js persist ใน localStorage + refresh token อัตโนมัติเป็นค่า default
 * อยู่แล้ว จึงล็อกอินค้างไว้ได้จนกว่าจะกด "ออกจากระบบ" (memsLogout) โดยไม่ต้องเขียนเพิ่ม
 */

const MEMS_PAGE_KEYS = ['borrow', 'prepare', 'dashboard', 'assets', 'round', 'fixjob'];

const MEMS_PAGE_LABELS = {
  borrow: 'ยืม-คืนเครื่องมือแพทย์',
  prepare: 'เตรียมเครื่องมือ',
  dashboard: 'แดชบอร์ด',
  assets: 'จัดการเครื่องมือในระบบ',
  round: 'บันทึกการ Round ward',
  fixjob: 'แก้ไขหน้างาน'
};

let MEMS_USER = null; // { id, username, display_name, role, active, permissions }

function memsEmailFor(username) {
  return String(username).trim().toLowerCase() + '@mems.local';
}

async function memsLogin(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: memsEmailFor(username),
    password
  });
  if (error) throw error;
  return data;
}

async function memsLogout() {
  try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
  location.href = 'index.html';
}

/** โหลดโปรไฟล์ของผู้ใช้ที่ login อยู่ (null ถ้าไม่ได้ login หรือหา session ไม่เจอ) */
async function memsLoadProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, display_name, role, active, permissions')
    .eq('id', session.user.id)
    .single();
  if (error || !data) return null;
  return data;
}

function memsHasPermission(profile, pageKey) {
  if (!profile || !profile.active) return false;
  if (profile.role === 'admin') return true;
  return Array.isArray(profile.permissions) && profile.permissions.includes(pageKey);
}

function memsShowLogin() {
  const ov = document.getElementById('loginOverlay');
  const fb = document.getElementById('forbiddenOverlay');
  if (ov) ov.style.display = 'flex';
  if (fb) fb.style.display = 'none';
}

function memsShowForbidden() {
  const ov = document.getElementById('loginOverlay');
  const fb = document.getElementById('forbiddenOverlay');
  if (ov) ov.style.display = 'none';
  if (fb) fb.style.display = 'flex';
}

function memsHideOverlays() {
  const ov = document.getElementById('loginOverlay');
  const fb = document.getElementById('forbiddenOverlay');
  if (ov) ov.style.display = 'none';
  if (fb) fb.style.display = 'none';
}

async function memsHandleLogin() {
  const userEl = document.getElementById('authUser');
  const passEl = document.getElementById('authPass');
  const errEl = document.getElementById('authErr');
  const btn = document.getElementById('authBtn');
  const username = userEl.value.trim();
  const password = passEl.value;
  if (!username || !password) {
    errEl.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'กำลังเข้าสู่ระบบ…';
  try {
    await memsLogin(username, password);
    location.reload();
  } catch (e) {
    errEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    errEl.style.display = 'block';
    passEl.value = '';
    passEl.focus();
    btn.disabled = false;
    btn.textContent = origText;
  }
}

/**
 * เรียกตอนเริ่มหน้าทุกหน้าที่ต้อง login
 * requiredPermission: 'borrow' | 'prepare' | 'dashboard' | 'assets' | 'round' | 'fixjob' | null (แค่ login พอ ไม่เช็คสิทธิ์รายหน้า)
 * คืนค่า profile ถ้าผ่าน, null ถ้าไม่ผ่าน (หน้าที่เรียกต้องหยุดทำงานต่อ — ไม่ init อย่างอื่น)
 */
async function memsGuard(requiredPermission) {
  let profile;
  try {
    profile = await memsLoadProfile();
  } catch (e) {
    profile = null;
  }

  if (!profile) {
    memsShowLogin();
    return null;
  }
  if (!profile.active) {
    await supabase.auth.signOut();
    memsShowLogin();
    return null;
  }
  if (requiredPermission && !memsHasPermission(profile, requiredPermission)) {
    memsShowForbidden();
    return null;
  }

  MEMS_USER = profile;
  memsHideOverlays();
  memsRenderUserBadge(profile);
  return profile;
}

/** แสดงชื่อผู้ใช้ปัจจุบัน + ปุ่มออกจากระบบ ถ้าหน้ามี element id="memsUserBadge" */
function memsRenderUserBadge(profile) {
  const el = document.getElementById('memsUserBadge');
  if (!el) return;
  const roleTag = profile.role === 'admin' ? ' (แอดมิน)' : '';
  el.innerHTML =
    '<span style="opacity:.9">' + memsEsc(profile.display_name || profile.username) + roleTag + '</span>' +
    ' <a href="#" onclick="memsLogout();return false" style="color:inherit;text-decoration:underline;margin-left:6px">ออกจากระบบ</a>';
}

function memsEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** เรียก mems-user-admin edge function (ต้อง login เป็นแอดมิน ยกเว้น action:"bootstrap") */
async function memsUserAdminCall(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/functions/v1/mems-user-admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY),
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'เกิดข้อผิดพลาด');
  return json;
}
