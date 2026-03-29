# Sticker Print Station

WPF .NET 10 application สำหรับ print sticker อัตโนมัติจาก Firebase Realtime Database เมื่อมีการ scan QR code เข้างาน

## Architecture

แต่ละเครื่อง PC ทำหน้าที่เป็น **1 Station** โดยระบุตัวเองว่าเป็น Printer เบอร์อะไร (1, 2, หรือ 3)

| เครื่อง | ตั้งค่า Station | ผลลัพธ์ |
|---------|----------------|---------|
| PC-A | Printer Station #1 | รับ print เฉพาะ job ที่ `printerId=1` |
| PC-B | Printer Station #2 | รับ print เฉพาะ job ที่ `printerId=2` |
| PC-C | Printer Station #3 | รับ print เฉพาะ job ที่ `printerId=3` |

- ทุกเครื่องเชื่อม Firebase URL เดียวกัน listen ที่ path `/print_queue`
- แต่ละเครื่อง filter เฉพาะ job ที่ `printerId` ตรงกับ Station ID ของตัวเอง
- หลัง print สำเร็จจะ mark `printed: true` ใน Firebase อัตโนมัติ

## Project Structure

```
StickerPrintApp/
├── Models/
│   └── PrintJob.cs              — Firebase data model
├── Services/
│   ├── FirebaseService.cs       — Firebase listener + mark as printed
│   └── StickerPrintService.cs   — Sticker layout & print via System.Drawing
├── MainWindow.xaml              — Dashboard UI
├── MainWindow.xaml.cs           — Main logic
└── StickerPrintApp.csproj       — .NET 10 project file
```

## Tech Stack

- **WPF** (.NET 10, C#)
- **FirebaseDatabase.net** 5.0.0 — Firebase Realtime Database listener
- **Newtonsoft.Json** — JSON serialization
- **System.Drawing.Common** — Sticker print layout

## Firebase Data Structure

Path: `/print_queue`

```json
{
  "print_queue": {
    "-unique_key_1": {
      "name": "John Doe",
      "ticketType": "VIP",
      "printerId": 1,
      "printed": false,
      "qrData": "TICKET-001-ABC",
      "timestamp": 1710900000000
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | ชื่อผู้เข้างาน |
| `ticketType` | string | ประเภทบัตร (VIP, General, etc.) |
| `printerId` | int | เครื่อง printer ที่จะ print (1, 2, 3) |
| `printed` | bool | สถานะ — `false` = รอ print, `true` = print แล้ว |
| `qrData` | string | ข้อมูลจาก QR code |
| `timestamp` | long | Unix timestamp (milliseconds) |

## วิธีใช้งาน

### 1. ตั้งค่า Firebase
สร้าง Realtime Database ใน Firebase Console แล้วนำ URL มาใส่ในช่อง **Database URL**

### 2. ตั้งค่า Station
- เลือก **Printer Station #1, #2, หรือ #3** ตามที่ต้องการให้เครื่องนี้รับผิดชอบ
- เลือก **Printer device** ที่ต่อกับเครื่องนี้

### 3. เริ่มทำงาน
กด **Start Listening** — ระบบจะ listen Firebase และ print อัตโนมัติเมื่อมี job เข้ามา

### 4. Activity Log
- `MATCH [key] "Name" (Type) — printing now...` = job ตรงกับ station นี้ กำลัง print
- `SKIP [key] printerId=X — not for this station` = job ของ station อื่น ข้ามไป

## Build & Run

```bash
cd StickerPrintApp
dotnet build
dotnet run
```

## UI

Dashboard style — white cards, stat boxes, light gray background
- 4 Stat Cards: Station, Status (Online/Offline), Jobs Printed, Skipped
- 2 Config Cards: Firebase Connection + Station Identity
- Activity Log panel
