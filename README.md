# MEMs — Medical Equipment Management Systems
**โรงพยาบาลพหลพลพยุหเสนา จ.กาญจนบุรี — ศูนย์เครื่องมือแพทย์**

เว็บแอปสำหรับบันทึกการยืม/คืนเครื่องมือแพทย์ผ่านมือถือ เชื่อมต่อ [Supabase](https://supabase.com) (Postgres + Storage + Edge Functions)

## เครื่องมือที่รองรับ
ทุกประเภทและหมายเลขจากทะเบียน assets เช่น C2 · High Flow · Brid เขียว · Infusion Pump · Syringe Pump · Patient Monitor · NIBP · Defibrillator · Monnal T60 · T1

## ฟีเจอร์
- ตรวจจับกะงานอัตโนมัติตามเวลาจริง (เช้า/บ่าย/ดึก)
- บันทึกได้สูงสุด 5 เครื่องต่อครั้ง แยก record ต่อเครื่อง
- ธีมสีเปลี่ยนตามโหมดยืม (เขียว) / คืน (แดง)
- รองรับ QR แบบ 2D: กด “ยืม” หรือ “คืน” แล้วป๊อปอัปจะโฟกัสช่องรับเครื่องสแกนอัตโนมัติ, แปลงข้อมูลจากแป้นไทย Kedmanee กลับเป็น URL ได้, โหมดคืนเลือกหน่วยงานที่ยืมเครื่องนั้นให้อัตโนมัติ, หน้าเตรียมเครื่องสแกนผ่านกล้องได้ และแอดมินหลักเปิด/ปิดโหมด QR จากหน้าตั้งค่าได้
- บันทึกข้อมูลลง Supabase (Postgres) อัตโนมัติ พร้อมแจ้งเตือน Telegram
- Dashboard, รายงานประจำเดือน/สรุปผู้บริหาร/สถิติ C2/ภาระงาน พร้อม export PDF
- Animated background

## สถาปัตยกรรม
ทุกหน้าเป็น static HTML (เปิดผ่าน GitHub Pages ได้เลย ไม่ต้อง build) เชื่อมต่อ Supabase โดยตรงผ่าน `supabase-js` (ใช้ Supabase Auth และ RLS ตามบัญชีและสิทธิ์เดิม):

- **`supabase-client.js`** — Supabase client + ฟังก์ชันร่วม (บันทึกยืม/คืน, สถานะเครื่อง, แจ้งเตือน Telegram ฯลฯ)
- **`reports.js`** — คำนวณรายงาน (ภาระงาน, รายงานประจำเดือน, สรุปผู้บริหาร, สถิติ C2) + สร้าง PDF ด้วย jsPDF ในเบราว์เซอร์
- **ตาราง Postgres**: `borrow_records`, `assets`, `prepare_records`, `fixjob_records`
- **Storage bucket**: `fixjob-photos` (รูปแนบการแก้ไขหน้างาน)
- **Edge Functions**: `telegram-notify` (แจ้งเตือนยืม/คืน + สรุปประจำวัน), `thai-holidays` (ดึงวันหยุดราชการไทยสำหรับคำนวณภาระงาน) — ตั้งเวลาส่งสรุปทุกวัน 08:00 ผ่าน `pg_cron`

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

## แบบฟอร์ม PM และตรวจรับ

เมนู `pm-reports.html` ดึงเครื่องหลาย No. จากทะเบียน บันทึกผลตรวจรายเครื่องและประวัติในฐานข้อมูล สร้างสำเนา Google Slides/PDF ลง Drive เมื่อเจ้าของเชื่อม Apps Script แล้ว ฟังก์ชันเริ่มต้นปิดและต้องมีสิทธิ์ `pm_reports` (แอดมินเข้าถึงได้) ดูขั้นตอนติดตั้งและข้อจำกัดที่ [docs/pm-reports-setup.md](docs/pm-reports-setup.md)

## กระบวนการเตรียม → ยืม → คืน → สถิติ

ประเภทและหมายเลขอ้างอิงทะเบียนเดียวกัน (`assets`) ทุกหน้า เครื่องหมายเลขเดียวกันต่างประเภทเป็นคนละเครื่อง เลือกหลายประเภทได้ โดยยืม/คืนได้สูงสุด 5 เครื่องต่อครั้ง หรือ Infusion Pump อย่างเดียว 10 เครื่อง การเตรียมไม่จำกัดไว้ที่ 5 เครื่อง ส่วนเตรียมพร้อมส่งใช้ข้อจำกัดเดียวกับยืม

- `equipment-lifecycle.js` / `.css`: ปุ่มเลือกเครื่องจากทะเบียนและรายการเฉพาะตึก คง QR และใบยืนยันเดิม
- `equipment-ledger.js`: จับคู่รอบใช้งาน แบ่งช่วงย้ายตึก ตัดเวลาตามช่วงรายงาน และระบุข้อมูลไม่ครบ
- `supabase/migrations/20261022031655_registry_equipment_lifecycle.sql`: ล็อกเครื่อง บันทึกทั้งชุด เชื่อมเตรียมกับยืม และป้องกันการบันทึกซ้ำ
- `c2-statistics.html`: URL เดิม รองรับสถิติยืม–คืนทุกประเภท รวม CSV/PDF/พิมพ์

ดูขั้นตอนตรวจและนำขึ้นใช้งานใน [docs/equipment-lifecycle-delivery.md](docs/equipment-lifecycle-delivery.md)

### ทดสอบโดยไม่แตะระบบจริง

```sh
npm ci
npm test
# PostgreSQL ที่ทิ้งข้อมูลได้เท่านั้น ผู้ใช้ต้องสร้าง/ลบฐานข้อมูลทดสอบได้:
MEMS_TEST_PG=postgresql://postgres@127.0.0.1:55432/postgres npm test
MEMS_TEST_PG=postgresql://postgres@127.0.0.1:55432/postgres npm run test:browser
```

`npm test` ใช้ PostgreSQL WASM เมื่อไม่ระบุ `MEMS_TEST_PG` และข้ามเฉพาะการทดสอบสอง connection จริง ส่วน browser tests ใช้ Chromium (`CHROMIUM_PATH` ปรับ path ได้) กับ API adapter และฐานข้อมูลทดสอบที่สร้าง/ลบทิ้งเอง ไม่เรียกเขียน Supabase จริง
