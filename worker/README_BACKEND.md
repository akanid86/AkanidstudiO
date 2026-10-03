# Mae Klong API — Cloudflare Worker + D1

Backend นี้แยกจาก GERARAI/Supabase โดยสมบูรณ์

## สิ่งที่มี
- D1 เก็บรายงานส่วนกลาง
- เจ้าของรายงานได้ owner token เพื่อแก้/ลบหมุดของตัวเอง
- Admin token อยู่ใน Worker secret เท่านั้น ไม่ฝังใน GitHub Pages
- Admin แก้/คลี่คลาย/ลบรายงานทุกหมุด และล้างรายงานทั้งหมดได้
- rate limit เบื้องต้น 20 รายงาน/ชั่วโมง/IP (เก็บเฉพาะ hash)
- CORS จำกัด maeklong.online และ GitHub Pages สำหรับทดสอบ

## Secrets ที่ต้องตั้ง
- `ADMIN_TOKEN` — สุ่มยาวอย่างน้อย 32 ตัวอักษร
- `RATE_SALT` — สุ่มยาวอย่างน้อย 32 ตัวอักษร

## ก่อนเปิด public จริง
เพิ่ม Cloudflare Turnstile ฝั่ง POST /api/reports เพื่อกัน bot เพิ่มอีกชั้น
