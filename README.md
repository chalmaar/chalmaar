# CSN Signature Events — Diwali Party Booking Site

A Next.js 16 + TypeScript + Tailwind booking site for the **Diwali Party** at TERRA (Chh. Sambhajinagar) featuring Sudhanshu & Maryana.

## Architecture

- **Frontend** — Next.js App Router, single page (`/`) with a 4-step booking flow:
  Details → Tier & Quantity → UPI Pay → UTR Reference → Confirm.

- **Backend** — Google Sheets via a Google Apps Script webhook (no Prisma, no SQL DB).
  Three tabs:
  - `Bookings_Payments` — full ledger of every booking + status + checked-in flag
  - `Gate_Passes` — synced subset for gate staff / AppSheet
  - `Event_Config` — key-value store for event title, date, venue, prices, UPI ID, posters

- **Telegram bot** — `@csnevents_bot` — admin CMS + approval flow + gate scanner:
  - New booking → bot sends admin a message with `[Approve] [Reject]` inline buttons
  - Admin taps `[Approve]` → server generates signed-QR pass image, edits message to `✓ APPROVED`, sends pass as a photo + `[📲 Send via WhatsApp]` button
  - Admin commands: `/start`, `/status`, `/addevent <k> <v>`, `/editevent`, `/deleteevent <k>`, `/listevents`, `/addposter <url>`, `/removeposter <url>`
  - Gate scanning: bouncer sends/forwards a guest's QR pass photo → bot decodes via `jsqr`, validates the signed QR (HMAC-SHA256), looks up booking, replies `🟢 VALID — Name — Checked In` or `🔴 ALREADY USED` / `🔴 INVALID` etc.

- **Pass generation** — `src/lib/pass-generator.ts` — uses `qrcode` lib to generate a signed QR (HMAC-SHA256 of booking ID + `QR_SIGNING_SECRET`), then `sharp` to composite the QR + guest name + booking ID onto the tier-colored template (1080×1350 JPG, 320×320 QR zone at 380,920).

## Deploy on Render

1. Push this repo to GitHub, then connect the repo to Render as a **Web Service**.
   - **Runtime:** Node (or Bun if available)
   - **Build Command:** `bun install && bun run build`
   - **Start Command:** `bun .next/standalone/server.js`
   - **Plan:** Free or higher

2. Set these environment variables in Render's dashboard (under **Environment**):

   | Key | Value |
   |---|---|
   | `APPS_SCRIPT_WEBHOOK_URL` | `https://script.google.com/macros/s/AKfycbwzGx-wNZuywii-Jbwisnq1qqyLPFw6Xos_UAMSYnx_I8y9csH_Asy_Ys4XNNWaXYrbgw/exec` |
   | `APPS_SCRIPT_SECRET` | `39c107affe93ad70f06972286c41b66ec47954b66506b78c` |
   | `TELEGRAM_BOT_TOKEN` | `9217926987:AAEwxrjeAZ0d8oR_V8KLyt5RScI7DSQwZ3s` |
   | `TELEGRAM_ADMIN_CHAT_ID` | `979676816` |
   | `QR_SIGNING_SECRET` | `nATV5/X0aEfl5mBWc34ZTkXPYhqh9YQiyaSDYkYu4DM=` |
   | `NODE_ENV` | `production` |
   | `PORT` | (Render sets this automatically — don't set manually) |

   **You must also set `SHARED_SECRET` in the Apps Script** so the webhook stops being open:
   - Open your Google Sheet → Extensions → Apps Script
   - Project Settings (gear icon, left sidebar) → Script properties → Edit script properties
   - Add a row: Name `SHARED_SECRET`, Value `39c107affe93ad70f06972286c41b66ec47954b66506b78c` (same as `APPS_SCRIPT_SECRET` above)
   - Save. No redeploy needed.
   - Without this step, anyone with the webhook URL could call it directly.

3. After the first deploy finishes, **register the Telegram webhook** so Telegram forwards button taps + photo messages to your Render app:

   ```bash
   curl "https://api.telegram.org/bot9217926987:AAEwxrjeAZ0d8oR_V8KLyt5RScI7DSQwZ3s/setWebhook?url=https://YOUR-RENDER-URL.onrender.com/api/telegram"
   ```

   Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

4. Open the site at your Render URL — verify the booking form renders. Submit a test booking → admin's Telegram gets a notification with `[Approve] [Reject]` → tap Approve → pass image generates → tap `[📲 Send via WhatsApp]` → forward to guest.

## Required Google Sheet setup (one-time)

The Apps Script (file `csn-bookings-webhook-v3.gs` in this repo) is already deployed. The Sheet has 3 tabs (`Bookings_Payments`, `Gate_Passes`, `Event_Config`) auto-seeded with defaults:
- title: `DIWALI PARTY — Featuring Sudhanshu & Maryana`
- date: `2026-11-07`
- time: `5:00 PM Onwards`
- venue: `TERRA Plates and Pour, Near Prozone Mall, Chh. Sambhajinagar`
- upiId: `9359248812@ybl` (your PhonePe/SBI account)
- prices: Female ₹999 / Male ₹2,499 / Couple ₹2,999 / Standing ₹20,000 / Seating ₹30,000

You can update any of these from Telegram via `/addevent <key> <value>` (e.g. `/addevent upiId your-new-vpa@upi`).

## Optional: AppSheet for gate-staff view

AppSheet auto-detects the columns in the Sheet. After deploy:

1. Go to [appsheet.com](https://www.appsheet.com) → New App → Start with existing data → pick the Google Sheet
2. In **Data → Tables**, connect both `Bookings_Payments` and `Gate_Passes` tabs
3. Set **Booking ID** as the Key column
4. Build a **Detail view** showing all the columns (the gate staff can search by phone or scan the QR)
5. Add a **"Check In"** action that sets `Checked In` → `TRUE` and `Checked In At` → `NOW()`

The Telegram bot can also do gate scanning directly (no AppSheet required): just forward the guest's QR pass photo to `@csnevents_bot` and it replies with validation status.

## File map

```
.
├── .env                              ← secrets (set the same vars on Render)
├── .gitignore
├── components.json                   ← shadcn/ui config
├── eslint.config.mjs
├── next.config.ts                    ← output: "standalone" (required for production)
├── package.json
├── bun.lock
├── postcss.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── csn-bookings-webhook-v3.gs        ← Google Apps Script (already deployed)
├── public/
│   ├── logo.svg
│   ├── posters/                      ← 6 event posters for the gallery
│   └── templates/                    ← 5 tier-colored pass templates (1080×1350)
├── scripts/
│   ├── gen_pass_templates.py         ← regenerate pass templates (uses Pillow)
│   └── setup-google-sheet.ts        ← one-time Sheet bootstrap (also auto-runs on first webhook call)
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                  ← the booking page (4-step form, poster carousel, UPI QR)
    │   ├── globals.css
    │   └── api/
    │       ├── route.ts              ← root API liveness check
    │       ├── event/route.ts        ← GET /api/event → live event config from Sheet
    │       ├── book/route.ts         ← POST /api/book → JSON booking, appends to Sheet, sends Telegram notification

    │       └── telegram/route.ts    ← POST /api/telegram → Telegram webhook (button taps, commands, gate scans)
    ├── lib/
    │   ├── db.ts                     ← single data-access module (Apps Script webhook client + all 9 actions)
    │   ├── event-config.ts          ← static fallback + getLiveConfig (60s cache from Sheet)
    │   ├── pass-generator.ts        ← signed QR (HMAC) + sharp compositing
    │   ├── telegram.ts              ← Bot API client + inline-keyboard builders
    │   └── utils.ts
    ├── components/ui/                ← shadcn/ui components (button, input, sheet, etc.)
    └── hooks/
        ├── use-mobile.ts
        └── use-toast.ts
```

## Notes

- The `.env` file is committed here for convenience — **DO NOT** commit secrets to a public GitHub repo. If you push to GitHub, add `.env` to `.gitignore` (it's already there) and only set the vars in Render's dashboard.
- `qr-codes/` directory is intentionally absent — passes are generated on-demand and sent directly via Telegram (no public URL).
- The `Screenshot URL` column in `Bookings_Payments` is intentionally always empty — we removed the screenshot upload requirement, but the column stays in the Sheet for backwards compat.
