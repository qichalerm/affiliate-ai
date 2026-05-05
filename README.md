# affiliate-ai

> **ระบบ Affiliate Marketing อัตโนมัติสำหรับ Shopee** ออกแบบเฉพาะตลาดไทย
> ดึงข้อมูล → แปลภาษา → สร้างเว็บ SEO หลายภาษา → จับโปรโมชั่น → สร้างคอนเทนต์โฆษณา
> → โพสต์ลง FB / IG / TikTok อัตโนมัติ → track คลิก → เรียนรู้ → วนลูป
> ใช้แค่ **Bun process เดียว + Postgres + Cloudflare Pages** — closed loop เต็มระบบ ไม่ต้องมีคนอยู่ในขั้นตอนรายวัน

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun_1.3+-orange.svg)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TS-strict-blue.svg)](https://www.typescriptlang.org/)

---

## 🇹🇭 ระบบนี้คืออะไร

Reference implementation ของ pipeline affiliate marketing แบบ autonomous เต็มรูปแบบ ที่ทำงาน:

1. **Scrape** สินค้า trending จาก Shopee Thailand วันละ 4 ครั้ง (ผ่าน Apify residential proxy)
2. **แปลภาษา** ทุกสินค้าเป็น 4 ภาษา (TH source → EN/ZH/JA ผ่าน Claude Haiku, ~$0.0016/สินค้า)
3. **สร้างเว็บ static หลายภาษา** สำหรับ SEO (200 สินค้า × 4 ภาษา = 850 หน้า, build ใน sub-second)
4. **Auto-deploy** ขึ้น Cloudflare Pages ภายใน 5 นาทีหลังแต่ละ scrape
5. **ตรวจจับโปรโมชั่น** ราคาตก, ส่วนลดเพิ่ม, ยอดขายพุ่ง, ราคาต่ำสุดใหม่ — ทุก 30 นาที
6. **สร้าง marketing copy** (3 มุมโฆษณา × 2 ช่อง) สำหรับสินค้าโปร ผ่าน Claude
7. **Quality-gate** ทุกชิ้นเนื้อหา (toxicity / disclosure / คำต้องห้ามตามกฎหมายไทย)
8. **Auto-publish** ลง FB Page, IG Business, TikTok ในช่วงเวลาที่เหมาะ (rate-limited + anti-bot delays)
9. **Track คลิก** ผ่าน Cloudflare Pages Function → Tunnel → DB → 302 ไป Shopee
10. **เรียนรู้ทุกคืน**: ปิด variants ที่ underperform (Wilson lower-bound), rebalance scrape budget ตาม niche ที่กำไรดี

ทำงานแบบไม่ต้องคนแตะ บน DigitalOcean Droplet 1-2 GB ตัวเดียว + Cloudflare free tier

---

## 🤔 ทำไมเปิดเป็น open-source

ตลาดไทยตอนนี้ **ยังไม่มี end-to-end open-source reference** สำหรับ affiliate marketing automation. เครื่องมือเชิงพาณิชย์ทุกตัวมีปัญหาอย่างใดอย่างหนึ่ง:

- **Browser extension** — ปิด API surface, ต้องเปิด Chrome ค้างไว้
- **SaaS** — lock-in vendor + ราคาแพง
- **Fragment** — มีแค่ scraper หรือแค่ generator แยกกัน

โปรเจกต์นี้คือ **pipeline ทั้งระบบ** พร้อม infrastructure ที่จำเป็นจริงๆ สำหรับการทำงาน autonomous: scheduler, rate limit, cost cap, source-health monitoring, daily report, niche budget rebalancing, click attribution, multilingual site builder, ฯลฯ

---

## 🛠 เอาไปใช้ยังไงได้บ้าง

- **ใช้ตามนี้เลย** สำหรับ Shopee Thailand (ชี้โดเมน → ใส่ key → รอผล)
- **Fork สำหรับ marketplace อื่น** — เปลี่ยน `src/scraper/shopee/` เป็น Lazada / Amazon / etc; ส่วนที่เหลือของ pipeline ใช้ได้กับทุก marketplace
- **ใช้แต่ละ module แยก**: bandit (`src/brain/bandit.ts`), quality gate (`src/quality/`), multilingual site builder (`src/web/`), Pages-Function-via-Tunnel pattern (`functions/go/[shortId].ts`) — ใช้แบบ standalone ได้
- **ศึกษา** ว่า TypeScript ~12,000 บรรทัด แทน SaaS stack $5k/เดือน บน droplet $12/เดือนได้ยังไง

---

## 🏗 สถาปัตยกรรม (Architecture)

### 1. Production infrastructure

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                  USER                                      │
│             (browser บน your-domain / FB feed / IG / TikTok)               │
└──────────────────────────┬─────────────────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                       CLOUDFLARE GLOBAL EDGE                               │
│ ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│ │  Pages Project                   │  │  DNS                             │ │
│ │  • 850 ไฟล์ HTML static          │  │  example.com → Pages             │ │
│ │  • 4 ภาษา (TH/EN/ZH/JA)          │  │  www.example.com → Pages         │ │
│ │  • /c/<niche> + /search          │  │  api.example.com → Tunnel CNAME  │ │
│ │  • /p/<slug>.html × 800          │  └──────────────────────────────────┘ │
│ │  • theme.css + sitemap + JSONs   │  ┌──────────────────────────────────┐ │
│ │                                  │  │  Cloudflare Tunnel               │ │
│ │  Pages Function                  │  │  TLS terminate → route ไป droplet│ │
│ │  /go/[shortId] (proxy คลิก)      │◄─│                                  │ │
│ └──────────────────────────────────┘  └──────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┬┘
                                                                            │
                                                                            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│        DROPLET (Ubuntu 24.04 · RAM 1-2GB · เครื่องเดียว)                    │
│                                                                            │
│ ┌──────────────────────────┐  ┌──────────────────────────┐                 │
│ │ systemd: cloudflared     │  │ systemd:                 │                 │
│ │ (outbound tunnel agent)  │  │   affiliate-ai-redirect  │                 │
│ │                          │◄─│ Bun HTTP, 127.0.0.1:3001 │                 │
│ └──────────────────────────┘  └──────────┬───────────────┘                 │
│                                          │                                 │
│ ┌────────────────────────────────────────▼───────────────┐                 │
│ │ systemd: affiliate-ai-scheduler                        │                 │
│ │ Bun + croner — รัน 11 cron jobs                        │                 │
│ │                                                        │                 │
│ │  scrapeTrending  promoHunter   autoPublish             │                 │
│ │  learning        engagement    sourceHealth            │                 │
│ │  dailyReport     backfillTr    ...                     │                 │
│ └─────────────────────┬──────────────────────────────────┘                 │
│                       │                                                    │
│ ┌─────────────────────▼──────────────────────────────────┐                 │
│ │ systemd: postgresql.service  (Postgres 16)             │                 │
│ │ localhost:5432 เท่านั้น · 16 tables                     │                 │
│ │  products, product_prices, content_variants,           │                 │
│ │  affiliate_links, clicks, promo_events,                │                 │
│ │  scraper_runs, generation_runs, ...                    │                 │
│ └────────────────────────────────────────────────────────┘                 │
└─────────────────────┬──────────────────────────────────────────────────────┘
                      │ outbound HTTPS เท่านั้น (ไม่มี inbound ยกเว้น SSH)
                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SERVICES                                  │
│                                                                            │
│  Apify         ────  Shopee scraper (residential proxy)                    │
│  Anthropic     ────  Claude Haiku/Sonnet (แปลภาษา + variants)              │
│  Cloudflare    ────  Pages deploy ผ่าน wrangler                            │
│  Shopee        ────  shp.ee/xxx mint API (commission tracking)             │
│  Meta Graph    ────  FB Page + IG Business posting                         │
│  TikTok        ────  Content Posting API                                   │
│  Replicate     ────  Image gen (Flux) — optional                           │
│  ElevenLabs    ────  Voice clone — optional                                │
│  Resend        ────  Operator email — optional                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2. Closed-loop data flow

```
                       ┌─────────────────────────────────┐
                       │  CRON: scrapeTrending           │ 4 ครั้ง/วัน
                       │  pickKeywordsWeighted (M9)      │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │  Apify Shopee actor             │
                       │  → 4 keywords × 15 สินค้า        │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │  upsertProduct (M1 persist)     │
                       │  → products + product_prices    │
                       │  → tag niche จาก keyword        │
                       │  → สร้าง /go affiliate link      │
                       └────┬──────────────────────┬─────┘
                            │                      │
        ┌───────────────────┘                      └────────────┐
        ▼                                                       ▼
  ┌──────────────────────┐                       ┌──────────────────────────┐
  │ scheduleSiteRebuild  │ debounce 5 นาที       │ promoHunter (ทุก 30 นาที)│
  │ (หลัง scrape สำเร็จ)  │                       │ price_drop / discount /  │
  └──────────┬───────────┘                       │ new_low / sold_surge     │
             │                                   └──────────┬───────────────┘
             ▼                                              │
  ┌──────────────────────────┐                              ▼
  │ buildSite()              │             ┌────────────────────────────────┐
  │ 850 HTML ใน 250ms        │             │ promoTrigger (ตามมา)           │
  │ + theme.css + sitemap    │             │ → generateVariants() force     │
  │ + search-index×4         │             │ → 6 variants (FB+IG × 3 มุม)   │
  └──────────┬───────────────┘             │ → Quality Gate (6 ชั้น)        │
             ▼                             │ → save content_variants        │
  ┌──────────────────────────┐             └──────────┬─────────────────────┘
  │ deploy → CF Pages        │                        │
  │ (wrangler bunx)          │                        ▼
  └──────────┬───────────────┘          ┌──────────────────────────────────┐
             ▼                          │ autoPublish (ทุก 30 นาที, 8AM-10PM)│
  ┌──────────────────────────┐          │ ต่อช่อง:                          │
  │ pingAllEngines           │          │  - check daily cap (5/5/3)        │
  │ IndexNow + Google + Bing │          │  - เลือก: promo events ก่อน      │
  └──────────────────────────┘          │    แล้วตาม final_score           │
             │                          │  - bandit (M3) เลือก variant     │
             ▼                          │  - random delay 30–300 วินาที    │
  ┌──────────────────────────┐          │  - publishToFB/IG/TikTok         │
  │ your-domain LIVE         │          └──────────┬───────────────────────┘
  │ users browse pages       │                     │
  └──────────┬───────────────┘                     ▼
             │ user คลิก "ดูใน Shopee"      ┌────────────────────┐
             ▼                              │ social posts LIVE  │
  ┌──────────────────────────────────┐      │ FB / IG / TikTok   │
  │ Pages Function /go/[id]          │      └──────┬─────────────┘
  │ → CF Tunnel api.<your-domain>    │             │ user เห็น post
  │ → droplet redirect-server :3001  │             ▼ คลิก affiliate link
  │ → DB log click (clicks table)    │   ┌─────────────────────────┐
  │ → 302 ไป shp.ee/xxx              │   │ engagementTracker       │
  │   (หรือ Shopee URL ปกติ)         │   │ ทุก 2 ชม: ดึง FB/IG     │
  └──────────┬───────────────────────┘   │ insights → post_metrics │
             ▼                           └────────┬────────────────┘
  ┌──────────────────────────┐                    │
  │ user ไปถึง Shopee        │                    ▼
  │ → COMMISSION TRACKED     │         ┌─────────────────────────┐
  │   (ตอนที่ตั้ง             │         │ learningOptimizer (M9)  │
  │    SHOPEE_API_KEY แล้ว)  │         │ ทุกคืน 03:00:           │
  └──────────────────────────┘         │  - aggregate CTR        │
                                       │  - Wilson LB cleanup    │
                                       │  - niche budget rebal   │
                                       │  - เขียน insights       │
                                       └────────┬────────────────┘
                                                │
                                                └──► กลับไป scrape (วันถัดไป)
                                                     ถ่วงน้ำหนักตามผลที่ได้
```

### 3. Module map (9 V2 pillars)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       M0  OPERATIONS  (cron orchestrator)                  │
│   scheduler/  monitoring/source-health  monitoring/daily-report            │
│           ▲                                                                │
│           │ schedule ทุกอย่าง                                               │
└───────────┼────────────────────────────────────────────────────────────────┘
            │
   ┌────────┼────────┬────────────┬─────────────┬────────────┬─────────────┐
   ▼        ▼        ▼            ▼             ▼            ▼             ▼
┌──────┐ ┌──────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ M1   │ │ M2   │ │  M3      │ │  M4    │ │   M5     │ │   M6     │ │   M7     │
│Source│ │Signal│ │  Brain   │ │Content │ │Publisher │ │  Promo   │ │Engagemnt │
│      │ │      │ │  Bandit  │ │ Engine │ │ Multi-ch │ │  Hunter  │ │  Track   │
└──┬───┘ └──┬───┘ └────┬─────┘ └───┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
   │        │          │            │            │             │            │
   │ scrape │ score    │ pick       │ generate   │ post        │ detect     │ poll
   │        │          │            │            │             │            │
   │   ┌────▼──────────▼────────────▼────────────▼─────────────▼────────────▼─┐
   └──►│                            DATABASE  (Postgres 16)                   │
       │  products · product_prices · content_variants · affiliate_links      │
       │  clicks · promo_events · scraper_runs · generation_runs · insights   │
       │  shops · categories · published_posts · post_metrics · alerts        │
       └────────┬─────────────────────────────────────────────────────────────┘
                │
                │ อ่าน aggregated stats
                ▼
       ┌─────────────────────────────────────┐
       │  M9  LEARNING OPTIMIZER             │ ทุกคืน
       │  + Niche budget rebalancer          │
       │                                     │
       │  • Wilson LB → ปิดตัวที่ underperform│
       │  • Insights row ต่อ scope/dimension │
       │  • Update pickKeywordsWeighted      │
       └────────────┬────────────────────────┘
                    │
                    │ feedback ไป M3 (variant pick) + M1 (scrape budget)
                    └────────► ปิด loop


  M8  ATTRIBUTION  (orthogonal — ทำงานในเส้นทาง user-click)
  ┌──────────────────────────────────────────┐
  │  CF Pages Function → Tunnel → Bun        │
  │  /go/<shortId> → log click → 302 Shopee  │
  │                                          │
  │  Shopee Open Affiliate API integration   │
  │  → mint shp.ee/xxx links                 │
  │  → commission ติดตามได้                  │
  └──────────────────────────────────────────┘
                    │
                    │ click counts → M3 bandit (clicks → α/β)
                    │ click counts → M9 (niche rebalancer)
                    └────────► เสริม loop
```

### 4. Module → file mapping

| Module | สถานะ | Files | Lines |
|---|---|---|---|
| **M0** Operations | ✅ live | `src/scheduler/`, `src/monitoring/` | ~1,000 |
| **M1** Source — Shopee | ✅ live | `src/scraper/shopee/` | ~700 |
| **M1** Source — TikTok Shop | 🟡 scaffold | `src/scraper/tiktok-shop/` | ~600 |
| **M2** Signal Analyzer | 🟡 partial | `src/scraper/niches.ts` | ~150 |
| **M3** Brain Bandit | ✅ live | `src/brain/bandit.ts` | ~250 |
| **M4** Content Engine | ✅ text live | `src/content/` | ~1,100 |
| **M5** Multi-channel Publisher | ✅ scaffolded | `src/publisher/` | ~1,200 |
| **M5** Auto-publish dispatcher | ✅ live | `src/publisher/auto-publish.ts` | ~150 |
| **M6** Promo Hunter | ✅ live | `src/brain/promo-hunter.ts` + `promo-trigger.ts` | ~500 |
| **M7** Engagement Tracker | 🟡 ready | `src/engagement/tracker.ts` | ~240 |
| **M8** Click tracking | ✅ live | `src/web/redirect-server.ts`, `functions/go/[shortId].ts` | ~200 |
| **M9** Learning + Niche rebalancer | ✅ live | `src/brain/learning.ts` + `src/scraper/niches.ts` | ~250 |
| **SEO** Sitemap auto-ping | ✅ live | `src/seo/sitemap-ping.ts` | ~120 |
| **Affiliate** Shopee API | ✅ ready | `src/affiliate/shopee-api.ts` | ~180 |
| **Web** Site builder | ✅ live | `src/web/` (templates + builder + deploy) | ~2,000 |
| **DB** schema | ✅ live | `src/db/schema.ts` (16 tables) + `src/db/migrations/` (10 SQL) | ~700 |

**รวม: ~12,000 บรรทัด TypeScript ใน 67 ไฟล์**

### 5. Cron jobs (11 jobs ที่รันต่อเนื่อง)

| Job | Schedule | ทำอะไร |
|---|---|---|
| `healthCheck` | `*/5 * * * *` | DB ping + log status |
| `scrapeTrending` | `0 8,13,19,22 * * *` BKK | Apify Shopee scrape, weighted niche selection (M9) |
| `scrapeTikTokShop` | `30 9,15,21 * * *` BKK | TikTok Shop scrape (no-op จนกว่าจะตั้ง actor id) |
| `learningOptimizer` | `0 3 * * *` BKK | Wilson-LB cleanup + niche click rollup |
| `promoHunter` | `*/30 * * * *` | ตรวจจับ promos → trigger variant gen |
| `autoPublish` | `10,40 8-22 * * *` BKK | เลือก variant ดีที่สุดต่อช่อง, post (rate-limited) |
| `engagementTracker` | `0 */2 * * *` | ดึง FB/IG insights ลง post_metrics |
| `sourceHealth` | `15 * * * *` | ตรวจ scraper ที่ stale/degraded → alerts |
| `backfillTranslations` | `*/45 * * * *` | แปลสินค้าที่ขาด EN/ZH/JA |
| `dailyReport` | `0 8 * * *` BKK | Email สรุปรายวันให้ operator |
| `shopeeVideoDigest` | `0 10 * * *` BKK | Email upload backlog (Shopee ไม่มี posting API) |

ค่าใช้จ่ายต่อวันที่ scale ปัจจุบัน: **LLM < $1/วัน**, **Apify < $0.50/วัน**

### 6. Data flow → table touch matrix

| Table | เขียนโดย | อ่านโดย |
|---|---|---|
| `products` | M1 scrape | M2 score, M4 content gen, web builder, M9 learning |
| `product_prices` | M1 (ทุก scrape) | M6 promo hunter (sparkline ในหน้า detail) |
| `content_variants` | M4 generator | M3 bandit pick, M5 publisher |
| `affiliate_links` | M4 (1 ต่อ variant) | M8 click handler, web CTA buttons |
| `clicks` | M8 redirect server | M3 bandit (α update), M9 niche rebalancer |
| `promo_events` | M6 hunter | M4 promo trigger, M5 autoPublish (priority pick) |
| `published_posts` | M5 publisher | M7 engagement tracker, M9 learning |
| `post_metrics` | M7 tracker | M9 learning |
| `insights` | M9 nightly | Daily report, future bandit V2 |
| `scraper_runs` | M1 (ทุก run) | M0 source-health, daily report |
| `generation_runs` | claude.ts (ทุก LLM call) | Budget gate, daily report |

### 7. Design decisions (เหตุผลที่เลือก)

**ทำไมเลือก Bun แทน Node?**
TypeScript native ไม่ต้อง transpile · cold start เร็ว ~3 เท่า · single binary · โหลด dotenv ในตัว

**ทำไม Postgres self-host แทนใช้ managed?**
Localhost = network latency เป็น 0 · ค่าใช้จ่าย $0 vs $15-30/เดือน managed · Drizzle จัดการ migration เรียบ

**ทำไมใช้ static HTML แทน Astro/Next?**
Build 850 หน้าใน 250ms — ไม่มี framework runtime overhead · ภาษาเดียวข้าม server + builder + Cloudflare Function · CDN cache infinite scale

**ทำไม Cloudflare Pages + Functions + Tunnel?**
ทุกอย่างใต้ account เดียว = ไม่ต้องเขียน glue code · Pages: free CDN, infinite scale · Functions: ฟรี 100k req/วัน เหมาะ /go/<id> · Tunnel: encrypted reverse proxy โดยไม่เปิด port

**ทำไม Apify สำหรับ Shopee?**
Verified ผ่าน bot defense ของ Shopee (SOAX, IPRoyal, Scrapfly, Playwright fail หมด) · มี residential TH proxy ในตัว · ~$0.50/วันที่ scale ของเรา

**ทำไม Thompson Sampling สำหรับเลือก variant?**
Self-balance explore/exploit ไม่ต้อง tune hyperparameter · Conjugate Beta-Binomial = closed-form posterior · Cold-start: uniform Beta(1,1) prior ให้ทุก variant โอกาสเท่ากันจน evidence สะสม

**ทำไมแปลตอน scrape ไม่ใช่ตอน request?**
SEO: search engines เห็นเนื้อหาแปลแล้ว (rank ดีกว่า runtime translation) · Latency: client-side cost = 0 · Cost: translate-once-cache pattern, idempotent บน `translations` JSONB

---

## 🚀 เริ่มต้น (Quick start)

```bash
# 1. Clone + install
git clone https://github.com/<your-org>/affiliate-ai.git
cd affiliate-ai
bun install

# 2. Configure
cp .env.example .env
chmod 600 .env
$EDITOR .env   # ดู docs/SETUP.md ว่าแต่ละ var คืออะไร

# 3. Database
sudo bash scripts/setup-postgres.sh
bun run db:push

# 4. Smoke test
bun run scrape:once "หูฟัง" 5
bun run build:site

# 5. Production install (systemd)
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-ai-scheduler affiliate-ai-redirect

# 6. Cloudflare Tunnel สำหรับ click tracking (ครั้งเดียว)
cloudflared service install <CONNECTOR_TOKEN>

# 7. Deploy ครั้งแรก
bun run deploy:site
```

คู่มือ setup ละเอียด: [docs/SETUP.md](docs/SETUP.md)

---

## 💻 Tech stack

| Layer | เลือก | เหตุผล |
|---|---|---|
| Runtime | **Bun 1.3+** | TypeScript native, cold start เร็ว, single binary |
| Language | **TypeScript** strict | ภาษาเดียวข้าม server, scraper, site builder, Cloudflare Functions |
| Database | **Postgres 16** self-host | Localhost = latency 0, ไม่มี marginal cost |
| ORM | **Drizzle** | Type-safe, ไม่ต้อง codegen, migration ง่าย |
| LLM | **Anthropic Claude** Haiku 4.5 (bulk) / Sonnet 4.6 (decisions) | ภาษาไทยดีที่สุด, prompt-cache เป็นมิตร |
| Scraper | **Apify** `xtracto/shopee-scraper` | Verified ผ่าน bot defense ของ Shopee |
| Web | **Static HTML** generated by Bun | ไม่มี framework runtime, sub-second rebuild, CDN scale infinite |
| Edge | **Cloudflare Pages + Functions + Tunnel** | Free CDN + Workers + secure tunnel ใน account เดียว |
| Cron | **croner** in-process | systemd service เดียวรัน 11 jobs |

---

## 📚 Documentation map

| ถ้าคุณต้องการ... | อ่าน |
|---|---|
| ดู feature ทั้งหมดพร้อมตัวอย่าง | [docs/FEATURES.md](docs/FEATURES.md) |
| ติดตั้งบน droplet ของตัวเอง | [docs/SETUP.md](docs/SETUP.md) |
| เข้าใจ env vars + API keys ที่ต้องการ | [docs/env-setup.md](docs/env-setup.md) |
| Activate ช่อง marketing (FB/IG/TikTok) หลังติดตั้งเสร็จ | [docs/ACTIVATION.md](docs/ACTIVATION.md) |
| อ่าน production notes ลึก (gotchas, costs, risks) | [docs/HANDOFF.md](docs/HANDOFF.md) |
| Contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |
| รายงาน security issues | [SECURITY.md](SECURITY.md) |

---

## 📝 License

[MIT](LICENSE) — เอาไปใช้, fork, ship ได้เลย. Attribution ขอบคุณ แต่ไม่บังคับ

## ⚖️ Disclaimer

Code นี้เป็น **engineering reference** — **คุณรับผิดชอบเรื่อง compliance เอง**:

- **Shopee Affiliate Program Terms of Service**
- **Meta Platform Terms** (Facebook + Instagram posting policies)
- **TikTok Community Guidelines** + Content Posting API ToS
- **กฎหมายไทย** (อย. + สคบ.) — Quality Gate's forbidden-words list เป็นจุดเริ่มต้น ไม่ใช่ legal guarantee
- **Personal data**: ระบบ hash IP + User-Agent ก่อนเก็บ click แต่ check กฎหมายท้องถิ่นเอง (PDPA / GDPR / equivalent)

Maintainer ส่งมอบ code ไม่ใช่ legal advice
