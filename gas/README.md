# MEMs — Google Apps Script Backend

## วิธีติดตั้ง

### 1. สร้าง Google Sheets
1. ไปที่ [sheets.google.com](https://sheets.google.com) → สร้าง Spreadsheet ใหม่
2. คัดลอก **Spreadsheet ID** จาก URL:  
   `https://docs.google.com/spreadsheets/d/**[COPY_THIS_ID]**/edit`

### 2. สร้าง Google Apps Script
1. ไปที่ [script.google.com](https://script.google.com) → New project
2. ลบโค้ดเดิมออกทั้งหมด
3. วางโค้ดจากไฟล์ `Code.gs` นี้
4. แก้ไขบรรทัด `SPREADSHEET_ID`:
   ```js
   const SPREADSHEET_ID = 'ใส่_ID_ที่_copy_มา';
   ```
5. บันทึก (Ctrl+S)

### 3. Deploy เป็น Web App
1. คลิก **Deploy** → **New deployment**
2. เลือก type: **Web app**
3. ตั้งค่า:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. คลิก **Deploy** → อนุญาต permissions
5. คัดลอก **Web app URL**

### 4. ใส่ URL ใน index.html
เปิด `index.html` แก้บรรทัด:
```js
const SCRIPT_URL = 'วาง_URL_ที่_copy_มา';
```

---

## API Endpoints

### POST /exec — บันทึกรายการ
```json
{
  "action": "🟩 ยืม",
  "shift": "เวรเช้า",
  "equipment": "C2",
  "equipmentNumber": "12345",
  "ward": "ตึก ICU",
  "name": "นายสมชาย",
  "timestamp": "2024-01-01T08:00:00.000Z"
}
```
Response:
```json
{ "ok": true, "id": 5, "timestamp": "2024-01-01T08:00:00.000Z" }
```

### GET /exec?action=records — ดึงรายการ
| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit`   | 50      | จำนวนรายการ |
| `offset`  | 0       | ข้ามรายการแรก N รายการ |
| `filter`  | ''      | ค้นหาข้อความ |

### GET /exec?action=summary — สรุปรายวัน
ได้สรุปจำนวนยืม/คืนแยกตามวันที่

### GET /exec?action=equipment — สถานะเครื่อง
สถานะล่าสุดของแต่ละหมายเลขเครื่อง (ยืมอยู่/คืนแล้ว)

---

## โครงสร้าง Google Sheets

Sheet **ยืม-คืน** มีคอลัมน์:
| ลำดับ | วันที่ | เวลา | เวร | ประเภท | ชื่อเครื่อง | หมายเลขเครื่อง | ตึก/Ward | ชื่อผู้ยืม | Timestamp |

- แถวสีเขียว = ยืม
- แถวสีแดง = คืน
