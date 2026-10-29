/**
 * ════════════════════════════════════════════════════════════════════════════
 *  POST /api/book  — JSON booking submission (UTR-only, no screenshot)
 *
 *  Request body: { name, phone, passTier, quantity, utr }
 *
 *  Flow:
 *    1. Parse JSON body
 *    2. Validate all fields (name, phone, tier, quantity, UTR)
 *    3. Append to Sheet (Bookings_Payments tab, Status=PENDING)
 *    4. Send Telegram notification to admin as a TEXT message with
 *       booking details + [Approve] [Reject] inline keyboard buttons
 *    5. Return { ok, bookingId, expectedAmount }
 *
 *  SECURITY CONTROLS (all server-side, never trust the client):
 *    1. Server recalculates expectedAmount = prices[tier] * quantity from
 *       the server-side price map (LIVE config from Sheet's Event_Config tab).
 *    2. UTR replay protection via the Sheet.
 *    3. UPI ID is NOT accepted from the client — server uses its own config.
 */

import { NextResponse } from 'next/server'
import { computeExpectedAmountLive, getLiveConfig } from '@/lib/event-config'
import {
  isUTRUsed,
  appendBooking,
  SheetsNotConfiguredError,
  UtrAlreadyUsedError,
} from '@/lib/db'
import {
  sendMessage,
  approveRejectKeyboard,
  getTelegramConfig,
  TelegramNotConfiguredError,
} from '@/lib/telegram'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_JSON' },
        { status: 400 }
      )
    }

    const { name, phone, passTier, quantity, utr } = body

    // ─── 1. Field presence ──────────────────────────────────────────────────
    if (!name || !phone || !passTier || !quantity || !utr) {
      return NextResponse.json(
        { ok: false, error: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    // ─── 2. Name validation: letters + spaces only, 2–15 chars ──────────────
    const cleanName = String(name).trim()
    if (!/^[A-Za-z\s]{2,15}$/.test(cleanName)) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_NAME' },
        { status: 400 }
      )
    }

    // ─── 3. Phone validation: 10-digit Indian mobile (starts 6-9) ────────────
    const cleanPhone = String(phone).replace(/\D/g, '')
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_PHONE' },
        { status: 400 }
      )
    }

    // ─── 4. Tier validation: must exist in server-side price map ─────────────
    const liveConfig = await getLiveConfig()
    if (!liveConfig.prices[String(passTier)]) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_TIER' },
        { status: 400 }
      )
    }

    // ─── 5. Quantity validation: integer 1–10 ────────────────────────────────
    const qty = parseInt(String(quantity), 10)
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_QUANTITY' },
        { status: 400 }
      )
    }

    // ─── 6. UTR validation: exactly 12 digits ────────────────────────────────
    const cleanUTR = String(utr).trim()
    if (!/^\d{12}$/.test(cleanUTR)) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_UTR' },
        { status: 400 }
      )
    }

    // ─── 7. SERVER-SIDE PRICE RECOMPUTE — never trust client amount ──────────
    const expectedAmount = await computeExpectedAmountLive(String(passTier), qty)
    if (expectedAmount === null) {
      return NextResponse.json(
        { ok: false, error: 'PRICE_COMPUTE_FAILED' },
        { status: 400 }
      )
    }

    // ─── 8. UTR replay protection ────────────────────────────────────────────
    if (await isUTRUsed(cleanUTR)) {
      return NextResponse.json(
        { ok: false, error: 'UTR_ALREADY_USED' },
        { status: 400 }
      )
    }

    // ─── 9. Append to Sheet (Bookings_Payments tab, Status=PENDING) ──────────
    const booking = await appendBooking({
      name: cleanName,
      phone: cleanPhone,
      passTier: String(passTier),
      quantity: qty,
      expectedAmount,
      utr: cleanUTR,
      // screenshotUrl intentionally omitted — we removed the screenshot upload
    })

    // ─── 10. Send Telegram notification (text + [Approve][Reject]) ──────────
    // Best-effort — if Telegram isn't configured or the send fails,
    // the booking still landed in the Sheet.
    try {
      const { adminChatId } = getTelegramConfig()
      if (adminChatId) {
        const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
        const text =
          `🔔 <b>New booking — needs approval</b>\n\n` +
          `<b>${escapeHtml(cleanName)}</b> · ${escapeHtml(String(passTier))} × ${qty}\n` +
          `${inr(expectedAmount)} · 📞 ${escapeHtml(cleanPhone)}\n` +
          `UTR: <code>${escapeHtml(cleanUTR)}</code>\n` +
          `Booking ID: <code>${escapeHtml(booking.id)}</code>\n\n` +
          `👇 Tap a button to act:`
        const keyboard = approveRejectKeyboard(booking.id)
        await sendMessage(adminChatId, text, { reply_markup: keyboard }).catch(
          (err: Error) => {
            console.error('[/api/book] sendMessage failed:', err)
          }
        )
      }
    } catch (err) {
      if (!(err instanceof TelegramNotConfiguredError)) {
        console.error('[/api/book] Telegram notification failed:', err)
      }
    }

    // ─── 11. Return success ──────────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      bookingId: booking.id,
      expectedAmount,
      message:
        'Booking received. Admin will verify your payment and send your pass on WhatsApp shortly.',
    })
  } catch (err) {
    console.error('[/api/book] error:', err)
    if (err instanceof SheetsNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: 'SHEETS_NOT_CONFIGURED' },
        { status: 503 }
      )
    }
    if (err instanceof UtrAlreadyUsedError) {
      return NextResponse.json(
        { ok: false, error: 'UTR_ALREADY_USED' },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { ok: false, error: 'SERVER_ERROR' },
      { status: 500 }
    )
  }
}

// ─── HTML escape helper ────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
