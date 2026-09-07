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
ทุกหน้าเป็น static HTML (เปิดผ่าน GitHub Pages ได้เลย ไม่ต้อง build) เชื่อมต่อ Supabase โดยตรงผ่าน `supabase-js` (ไม่มี login — ใช้ RLS policy แบบ public เหมือนพฤติกรรมเดิมของ Apps Script "Anyone" access):

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
