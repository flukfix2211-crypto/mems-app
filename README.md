# MEMs — Medical Equipment Management Systems
**โรงพยาบาลพหลพลพยุหเสนา จ.กาญจนบุรี — ศูนย์เครื่องมือแพทย์**

เว็บแอปสำหรับบันทึกการยืม/คืนเครื่องมือแพทย์ผ่านมือถือ เชื่อมต่อ [Supabase](https://supabase.com) (Postgres + Storage + Edge Functions)

## เครื่องมือที่รองรับ
C2 · High Flow · Brid เขียว · Infusion Pump · Syringe Pump · Monnal T60 · T1

## ฟีเจอร์
- ตรวจจับกะงานอัตโนมัติตามเวลาจริง (เช้า/บ่าย/ดึก)
- บันทึกได้สูงสุด 5 เครื่องต่อครั้ง แยก record ต่อเครื่อง
- ธีมสีเปลี่ยนตามโหมดยืม (เขียว) / คืน (แดง)
- บันทึกข้อมูลลง Supabase (Postgres) อัตโนมัติ พร้อมแจ้งเตือน Telegram
- Dashboard, รายงานประจำเดือน/สรุปผู้บริหาร/สถิติ C2/ภาระงาน พร้อม export PDF
- Animated background

## สถาปัตยกรรม
ทุกหน้าเป็น static HTML (เปิดผ่าน GitHub Pages ได้เลย ไม่ต้อง build) เชื่อมต่อ Supabase โดยตรงผ่าน `supabase-js`
ผู้ใช้ต้องเข้าสู่ระบบ (Supabase Auth) และแต่ละบัญชีเข้าได้เฉพาะหน้าที่ได้รับสิทธิ์:

- **`supabase-client.js`** — Supabase client + ฟังก์ชันร่วม (บันทึกยืม/คืน, สถานะเครื่อง, เวรตามเวลาไทย, แจ้งเตือน Telegram ฯลฯ)
- **`auth.js`** — ล็อกอิน/ออกจากระบบ, ตรวจสิทธิ์รายหน้า (`memsGuard`), `memsEsc` สำหรับ escape ข้อความก่อนใส่ HTML
- **`reports.js`** — คำนวณรายงาน (ภาระงาน, รายงานประจำเดือน, สรุปผู้บริหาร, สถิติ C2) + สร้าง PDF ด้วย jsPDF ในเบราว์เซอร์
- **ตาราง Postgres**: `borrow_records`, `assets`, `prepare_records`, `fixjob_records`, `user_profiles` (บัญชี + สิทธิ์รายหน้า), `audit_log` (ประวัติเพิ่ม/แก้ไข/ลบ)
- **Storage bucket**: `fixjob-photos` (รูปแนบการแก้ไขหน้างาน)
- **Edge Functions**: `telegram-notify` (แจ้งเตือนยืม/คืน + สรุปประจำวัน + สรุปรายเวร), `thai-holidays` (ดึงวันหยุดราชการไทยสำหรับคำนวณภาระงาน), `mems-user-admin` (จัดการบัญชีผู้ใช้ เฉพาะแอดมินหลัก)
- **ตั้งเวลา (`pg_cron`)**: 08:00 สรุปแจ้งเตือนประจำวัน, 08:30 สรุปยืม-คืนรายเวร

> ⚠️ โครงสร้างฐานข้อมูล (ตาราง, RLS policy, trigger, view) และซอร์สของ `thai-holidays` ยังไม่ได้เก็บไว้ใน repo นี้ — อยู่บน Supabase เท่านั้น

**ข้อความที่ผู้ใช้กรอก** (ชื่อ, ตึก, หมายเหตุ ฯลฯ) ต้อง escape ด้วย `memsEsc()` ทุกครั้งก่อนใส่ใน `innerHTML` และค่าที่ส่งเข้า `onclick="fn('...')"` ในแดชบอร์ดต้องผ่าน `jsq()`

โค้ด Google Apps Script เดิม (`gas/`) เก็บไว้เป็นข้อมูลอ้างอิงเชิงประวัติเท่านั้น ระบบไม่ได้ใช้งานแล้ว

### ตั้งค่า Telegram
ตั้งค่า secret ของ Edge Function `telegram-notify` ผ่าน Supabase Dashboard (Project Settings → Edge Functions → Secrets) หรือ Supabase CLI:
```
supabase secrets set TELEGRAM_TOKEN=xxxx TELEGRAM_CHAT_ID=xxxx
```

## การใช้งาน
เปิดผ่าน GitHub Pages ได้เลย ไม่ต้องติดตั้งอะไรเพิ่ม

## Developed by
Pavarit Somchipeng
