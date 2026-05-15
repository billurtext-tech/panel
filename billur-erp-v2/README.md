# BILLUR ERP — v3 (full production workflow + BoxApp integration)

AND BILLUR TEXTILE — Production ERP/MES with QR-driven workflow, real-time
traceability, piece-rate payroll, file uploads, SSE realtime, and BoxApp integration.

## Stack
- **Backend**: Node.js 20 + Express + TypeScript + PostgreSQL + qrcode + exceljs + multer
- **Frontend**: Next.js 14 (App Router) + shadcn/ui + Tailwind 3 + TanStack Query + html5-qrcode
- **Database**: PostgreSQL 16

## Imkoniyatlar

### Production workflow (asosiy biznes logikasi)
1. **Order yaratish** — Speka/SET/Standard tiplari, SET parser bilan
2. **QR yaratish** — bichuvdan boshlanadi, har order_item uchun alohida
3. **Stage scanning** — ishchi har bosqichda **START** + **FINISH** qiladi
4. **Worker lock** — bitta QR bir vaqtning o'zida faqat bitta ishchiga biriktirilgan
5. **Anti-cheating** — juda tez (stagega qarab 5-60 sek) scanlar **shubhali** belgilanadi
6. **Race-safe** — `SELECT ... FOR UPDATE` + UNIQUE indekslar
7. **Quality check** — Passed/1st sort/2nd sort/Defect/Rework/Reject + aybi qaysi bosqichda
8. **Traceability** — QR uchun to'liq tarix
9. **Admin override** — lock buzish (audit log bilan)

### Order parsers
- **SET kod parser**: `SET86288828-LRTT-275-BLU-XL` → `{set_number, model, color, size}`
- **Speka multi-model**: bir order'da bir necha model × rang × size breakdown
- **Bulk SET upload**: ko'p SET kod'ni bir vaqtda parse qilib order yaratish

### Payroll
- **Piece rates** — model + bosqich bo'yicha, DEFAULT fallback
- **Real-time hisoblash** — finished scanlardan
- **Bonus/penalty/advance**
- **Approve → Pay workflow** — draft → approved → paid
- **Excel export** — har davr uchun

### BoxApp integratsiya
- **Async sync queue** — barcha box/shipment o'zgarishlar queue'ga tushadi
- **Exponential backoff** — 1m / 5m / 15m / 1h / 6h, 10 marta urinishdan keyin failed
- **Background worker** — har 60 sekundda
- **Monitoring UI** — `/boxapp-sync` real-time stats + retry/cancel
- **BoxApp tomonidan kerakli endpoint'lar**:
  ```
  POST   /api/erp/boxes
  PUT    /api/erp/boxes/:uid
  POST   /api/erp/shipments
  PUT    /api/erp/shipments/:id
  ```
  Auth: `Authorization: Bearer <BOXAPP_API_KEY>`

### File uploads (Multer)
- **Worker hujjatlari** — pasport, shartnoma, sertifikat (JPG/PNG/PDF, 10 MB)
- **Worker rasm** — profil fotosi
- **Quality defekt rasmlari** — QC bosqichida dalil
- **Secure download** — permission check bilan
- **Persistent disk** — Render'da `/var/data/uploads` mount

### Worker self-service
- **Mening Profilim** — telefon/address/photo, productivity, scans, documents
- **Mening Oyligim** — scan asosida hisoblangan oylik tafsilotlari
- **Real upload** — hujjat fayllarini o'zi yuklay oladi

### Realtime (SSE)
- **Server-Sent Events** — `/api/sse/stream`
- Dashboard avtomatik yangilanadi (scan, quality, BoxApp event'lar)
- Polling kerakmas — push notification ishlatiladi
- Auto-reconnect bilan

### RBAC
- 16 ta yangi permission qo'shildi
- Owner role — hammasi avtomatik
- Worker faqat o'zining ma'lumotlarini ko'radi

### Mobile UX
- **Kamera scan** — `html5-qrcode` real device kamera
- **Beep** — har scan bo'yicha audio signal
- **Vibration** — telefonga teginish bilan tasdiq
- **Duplicate guard** — 1.5 sek ichida bir xil scan rad etiladi

## Sahifalar (25 ta)

| Group | Sahifa | Funksiya |
|---|---|---|
| Asosiy | `/` | Dashboard (SSE realtime) |
| Asosiy | `/clients` | Klientlar CRUD |
| Asosiy | `/orders` | Zakazlar |
| Production | `/production-scan` | **START/FINISH workflow** |
| Production | `/qr-codes` | QR boshqaruv |
| Production | `/trace` | To'liq tarix |
| Production | `/production` | Bosqichlar pipeline |
| Production | `/quality` | Defektlar |
| Production | `/scanning` | Worker badge scan |
| Production | `/print` | Print buyurtmalari |
| Ombor | `/inventory` | Material+goods balans |
| Ombor | `/surplus` | Izlishka |
| Ombor | `/boxes` | BoxApp boxlar |
| Ombor | `/boxapp-sync` | Sync monitoring |
| Ombor | `/shipments` | Yetkazib berish |
| Tashkilot | `/workers` | Ishchilar ro'yxati |
| Tashkilot | `/workers/[id]` | Detal + hujjat upload |
| Tashkilot | `/my-profile` | Worker self-service |
| Tashkilot | `/payroll` | Admin payroll |
| Tashkilot | `/my-payroll` | Worker payroll |
| Tashkilot | `/piece-rates` | Narxlar |
| Tashkilot | `/users` | Foydalanuvchilar |
| Tashkilot | `/reports` | Excel exports |
| Tashkilot | `/audit` | Audit log |

## Lokal ishga tushirish

```bash
# 1. PostgreSQL
docker run -d --name billur-pg -e POSTGRES_PASSWORD=billur -p 5432:5432 postgres:16

# 2. Backend
cd backend
npm install
cp .env.example .env  # DATABASE_URL ni sozlang
npm run migrate       # 001+002+003
npm run dev           # http://localhost:3001

# 3. Frontend
cd frontend
npm install
npm run dev           # http://localhost:3000
```

Login: `admin / admin123`

## Env variables

```
# Backend
NODE_ENV=production
DATABASE_URL=postgres://...
JWT_SECRET=<generated>
QR_SECRET=<generated>
ALLOWED_ORIGINS=https://your-frontend.com
UPLOAD_DIR=/var/data/uploads   # Render persistent disk

# BoxApp integration
BOXAPP_API_URL=https://app.andbillur.com
BOXAPP_API_KEY=<your-secret>

# Frontend
BACKEND_URL=https://your-backend.com
PORT=3000
```

## Render deploy

`render.yaml` mavjud — Blueprint import qiling.
- Backend: persistent disk `/var/data/uploads` (1 GB)
- BoxApp env'lari `sync: false` — Render dashboard'dan qo'lda kiriting

## Production workflow — qanday ishlaydi

1. **Order kelgan** → Orders sahifasida zakaz yaratiladi (Speka/SET/Standard)
2. **Bichuvga tushadi** → QR Codes "Bulk generate" — har order_item uchun QR
3. **Bichuvchi scan qiladi** → Production Scan: QR + worker + stage=cutting + **START**
   - Tizim QR'ni ishchiga lock qiladi
   - Boshqa hech kim scan qila olmaydi
4. **Bichuvchi tugatadi** → yana scan + **FINISH**
   - Beep + vibration
   - Duration hisoblanadi
   - QR keyingi bosqichga (`printing`) o'tadi
5. **Printing → Sewing → Quality → Ironing → Tagging → Packing**
6. **Quality bosqichida** — FINISH bosilganda QC qarori talab qilinadi
   - `passed` → keyingi bosqich
   - `rework` → `sewing` ga qaytadi
   - `reject` → tugatildi
7. **Packing tugagandan keyin** → BoxApp ga sync_jobs orqali jo'natiladi
8. **Shipment yopilganda** → BoxApp ga update jo'natiladi

## Yangi API endpoint'lar

### Production scanning
- `POST /api/scanning/qr-codes` — yaratish
- `POST /api/scanning/qr-codes/bulk` — order bo'yicha bulk
- `GET /api/scanning/qr-codes` — ro'yxat
- **`POST /api/scanning/scan`** — START/FINISH (asosiy)
- `POST /api/scanning/qr-codes/:id/override` — admin
- `GET /api/scanning/qr-codes/:id/trace` — to'liq tarix
- `GET /api/scanning/scans/suspicious` — shubhali

### Order parsers
- `POST /api/orders/parse-set` — SET kod(lar) parse qilish
- `POST /api/orders/speka` — Speka order yaratish
- `POST /api/orders/from-sets` — Bulk SET kod'lardan order

### Payroll
- `GET/POST/PUT /api/payroll/rates` — piece rates
- `POST /api/payroll/calculate` — bitta worker
- `POST /api/payroll/calculate-all` — barchasi
- `GET /api/payroll/entries` — (worker o'zinikini ko'radi)
- `PATCH /api/payroll/entries/:id` — bonus/penalty/advance
- `POST /api/payroll/entries/:id/approve` — tasdiqlash

### Files
- `POST /api/files/worker/:id/document` — hujjat upload
- `POST /api/files/worker/:id/photo` — rasm upload
- `POST /api/files/quality/photo` — defekt rasm
- `GET /api/files/download/...` — secure download

### Worker profile
- `GET /api/worker-profile/me` — o'zim
- `GET /api/worker-profile/me/productivity` — bu oy
- `GET /api/worker-profile/me/scans` — oxirgi 50
- `GET/PUT /api/worker-profile/:id/profile` — admin/self
- `GET/POST /api/worker-profile/:id/documents`

### BoxApp
- `GET /api/boxapp/jobs` — sync jobs
- `GET /api/boxapp/jobs/_stats` — statlar
- `POST /api/boxapp/jobs/:id/retry` — qaytadan
- `POST /api/boxapp/jobs/_flush` — hozir ishga tushir

### Excel exports
- `GET /api/reports/export/orders`
- `GET /api/reports/export/production`
- `GET /api/reports/export/workers`
- `GET /api/reports/export/payroll`
- `GET /api/reports/export/quality`

### Realtime
- `GET /api/sse/stream` — SSE feed (scan, quality, boxapp)

## Migration 003 yangi jadvallar

- `production_qr_codes` — QR ownership
- `production_stage_scans` — START/FINISH yozuvlar
- `quality_decisions` — QC qarorlari
- `piece_rates` — model+stage narxlari
- `payroll_entries` + `payroll_details`
- `worker_documents`
- `boxapp_sync_jobs`

## Auth tuzatishlar

- ✅ `/api/auth/login` `permissions` array qaytaradi
- ✅ `/api/auth/me` to'g'ridan-to'g'ri user
- ✅ Sidebar `owner` rol — hammasi avtomatik
- ✅ `x-session-token` header + cookie

## Mock data — to'liq olib tashlangan

Hech bir sahifa endi mock array ishlatmaydi:
- Dashboard charts — `/api/dashboard/charts/*` dan
- Workers ro'yxati — `/api/workers`
- Worker hujjatlari — `/api/worker-profile/:id/documents`
- Payroll — real scan'lardan hisoblanadi
- Quality — `/api/quality`
- Stages — `/api/master/stages`

`lib/data.ts` faqat UI form'lar uchun static enum (productionLines, positions) saqlaydi.
