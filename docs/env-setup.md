# Environment Variables Setup Guide

คู่มือกรอก `.env` ทีละตัว — เรียงตาม priority

## 🔴 Phase 1 (จำเป็นก่อนเริ่มเดือน 1)

ต้องมี **ก่อนเริ่ม code จริง**:

### 1. Domain
- **DOMAIN_NAME** — ซื้อที่ Cloudflare Registrar (~$10/ปี)
  - ตัวอย่างชื่อ: `dealfinder.co`, `priceth.app`, `gadgetfinder.io`

### 2. Cloudflare
- สมัคร: https://dash.cloudflare.com/sign-up
- **CLOUDFLARE_ACCOUNT_ID** — Dashboard → ขวาล่าง
- **CLOUDFLARE_API_TOKEN** — My Profile → API Tokens → Create Token
  - Permissions: `Account.Cloudflare Pages:Edit`, `Zone.DNS:Edit`, `Account.R2:Edit`
- **CLOUDFLARE_ZONE_ID** — หลัง add domain → Overview tab

### 3. Database (Postgres on DigitalOcean Droplet — self-host)
- ใช้ Droplet เดียวกับที่รัน bot (ลด latency, ประหยัดเงิน)
- รัน script ติดตั้ง:
  ```bash
  sudo bash scripts/setup-postgres.sh
  ```
  สคริปต์จะ:
  1. ติดตั้ง Postgres 16 (ถ้ายังไม่มี)
  2. สร้าง database `affiliate` + user `botuser` พร้อม random password
  3. ล็อคให้รับเฉพาะ localhost
  4. Tune memory ให้เหมาะ Droplet 1–2GB
  5. เขียน `DATABASE_URL` เข้า `.env` ให้อัตโนมัติ

- ดูคู่มือเต็ม: [docs/digitalocean-setup.md](digitalocean-setup.md)
- Alternative: ถ้าอยากใช้ Neon ฟรี → กรอก connection string จาก [neon.tech](https://neon.tech) แทน

### 4. Anthropic (Claude API)
- สมัคร: https://console.anthropic.com
- API Keys → Create Key
- เติม credit เริ่มต้น $20

### 5. GitHub
- สมัคร: https://github.com (ถ้ายังไม่มี)
- Settings → Developer settings → Personal access tokens → Fine-grained
- Permissions: `Contents: Read and write`, `Pages: Read and write`

### 6. Shopee Affiliate
- สมัคร: https://affiliate.shopee.co.th/
- ต้องมี: บัตรประชาชน + บัญชีธนาคารไทย
- หลัง approve → copy Affiliate ID

### 7. Telegram Bot
- เปิด Telegram → search `@BotFather`
- `/newbot` → ตั้งชื่อ → ได้ `TELEGRAM_BOT_TOKEN`
- Search `@userinfobot` → ได้ `TELEGRAM_OPERATOR_CHAT_ID` (ของคุณ)
- สร้าง channel → ตั้ง bot เป็น admin → ได้ channel ID

---

## 🟡 Phase 2 (เพิ่มในเดือน 2)

### 8. ElevenLabs (voice)
- https://elevenlabs.io
- Plan: Creator $22/เดือน
- Upload ตัวอย่างเสียงคุณ 10 นาที → voice clone → copy ID

### 9. Webshare Proxy
- https://webshare.io
- Plan: 100 proxies $30/เดือน

### 10. Pinterest
- https://developers.pinterest.com → create app
- OAuth → ได้ `PINTEREST_ACCESS_TOKEN`
- สร้าง board สำหรับ niche → copy board ID

### 11. Resend (email alerts)
- https://resend.com (ฟรี 3,000 email/เดือน)

### 12. FastMoss (TikTok trends)
- https://fastmoss.com
- Plan: $49–99/เดือน

---

## 🟢 Phase 3 (เพิ่มเดือน 3 — เริ่ม social)

### 13. TikTok Content Posting API
- https://developers.tiktok.com → register as developer
- Submit app for review (ใช้เวลา 2–4 สัปดาห์)
- หลัง approve → OAuth → ได้ `TIKTOK_ACCESS_TOKEN`

### 14. Meta Graph API (Facebook + Instagram)
- https://developers.facebook.com → My Apps → Create App
- Type: Business
- Add product: Pages API + Instagram Graph API
- Generate page access token (long-lived)

### 15. Submagic (auto captions)
- https://submagic.co/api
- Plan: $20/เดือน

### 16. Flux Pro / Replicate (image gen)
- Replicate: https://replicate.com → API token
- หรือ Flux โดยตรง: https://blackforestlabs.ai

### 17. YouTube Data API
- https://console.cloud.google.com → enable YouTube Data API v3
- OAuth credentials → ได้ refresh token

---

## 🔵 Phase 4+ (optional)

### 18. SerpAPI (Google search/trends)
- https://serpapi.com — $50/เดือน

### 19. Sora / Veo / Kling (video gen)
- เปิดใช้เฉพาะตอนต้องการ ambient scenes

### 20. Suno (music gen)
- https://suno.com/api

### 21. Clerk (dashboard auth)
- https://clerk.com (ฟรี 1 user)

---

## 💡 Tips

1. **เก็บ `.env` ในที่ปลอดภัย** — อย่า commit, อย่าส่ง chat
2. **Generate secrets**:
   ```bash
   openssl rand -hex 32      # สำหรับ INTERNAL_API_SECRET, SESSION_SECRET
   ```
3. **Test ทีละตัว** หลังกรอก — รัน health check ก่อนต่อ pipeline
4. **OAuth tokens หมดอายุได้** — ระบบ auto-refresh ที่ Layer 6
5. **Backup**: เก็บ copy ของ `.env` ใน password manager (1Password, Bitwarden)

---

## ⚠️ Security Notes

- `.env` อยู่ใน `.gitignore` แล้ว — จะไม่ถูก push ขึ้น GitHub
- ไฟล์ `secrets/google-service-account.json` ก็ ignored ด้วย
- API keys ที่หลุด → revoke ทันทีที่หน้า provider
- ใช้ **dedicated email** สำหรับ project นี้ (ไม่ผูกกับ personal account)

---

## Quick Validation Script

หลังกรอกครบ phase 1 ใช้ command นี้เช็ค:

```bash
npm run check-env       # ตรวจว่า required vars ครบไหม
npm run test-connections  # ทดสอบ connection ทุก service
```

(จะมี script ตัวนี้หลังผม build ใน Phase 1)
