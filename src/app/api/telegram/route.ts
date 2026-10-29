/**
 * ════════════════════════════════════════════════════════════════════════════
 *  src/app/api/telegram/route.ts
 *
 *  Telegram webhook — receives ALL bot updates:
 *
 *    1. callback_query  → admin tapped [Approve] / [Reject] in Telegram
 *       → ack the tap → on Approve: generate signed-QR pass image, send to
 *         admin as a photo, update Sheet Status=APPROVED, edit the original
 *         message's caption + remove the buttons (so it can't be tapped twice)
 *       → on Reject: update Sheet Status=REJECTED, edit caption + remove buttons
 *
 *    2. message.text    → admin command:
 *       /start                — help
 *       /status               — count of bookings by status
 *       /addevent <k> <v>     — add/update an Event_Config key
 *       /editevent <k> <v>    — alias for /addevent
 *       /deleteevent <k>      — unset an Event_Config key (sets to empty)
 *       /listevents           — dump current Event_Config
 *       /addposter <url>      — append a poster URL to the posters list
 *       /removeposter <url>   — remove a poster URL
 *
 *    3. message.photo   → could be (a) admin uploading a new event poster,
 *       OR (b) admin/bouncer sending/forwarding a guest's QR pass photo
 *       for gate validation. We try to decode the photo as a QR first;
 *       if it has a valid signed QR, treat as gate scan; otherwise, IF the
 *       sender is admin, treat as poster upload.
 *
 *  SECURITY:
 *    - Admin-only commands/text are gated on chat_id == TELEGRAM_ADMIN_CHAT_ID.
 *    - Bouncers (any other chat_id) can only send photo messages (gate scan).
 *    - Optional: if TELEGRAM_WEBHOOK_SECRET is set, Telegram must send it as
 *      the `x-telegram-bot-api-secret-token` header on every webhook call.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  sendMessage,
  sendPhoto,
  answerCallbackQuery,
  editMessageText,
  approveRejectKeyboard,
  whatsappShareKeyboard,
  getTelegramConfig,
  TelegramNotConfiguredError,
  type TelegramUpdate,
} from '@/lib/telegram'
import {
  getBookingById,
  updateBooking,
  getAllBookings,
  getEventConfig,
  updateEventConfig,
  addPoster,
  removePoster,
} from '@/lib/db'
import {
  generatePass,
  validateSignedQrPayload,
} from '@/lib/pass-generator'

// ─── Runtime config ────────────────────────────────────────────────────────
// Need sharp + Buffer + node:fs — force nodejs runtime (not edge)
export const runtime = 'nodejs'

// ─── Webhook security (optional) ──────────────────────────────────────────
function checkWebhookSecret(req: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
  if (!expected) return true // no secret configured → accept all
  const provided = req.headers.get('x-telegram-bot-api-secret-token')
  return provided === expected
}

// ─── POST handler ──────────────────────────────────────────────────────────
export async function POST(req: Request) {
  if (!checkWebhookSecret(req)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  // Always return 200 quickly — Telegram times out at 60s but we want to ack
  // button taps within 5s. We handle the update fire-and-forget style.
  ;(async () => {
    try {
      await handleUpdate(update)
    } catch (err) {
      console.error('[/api/telegram] handler error:', err)
    }
  })()

  return NextResponse.json({ ok: true })
}

// ─── GET (liveness check) ──────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'CSN Telegram webhook is live.',
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
  })
}

// ═══════════════════════════════════════════════════════════════════════════
//  Update dispatcher
// ═══════════════════════════════════════════════════════════════════════════
async function handleUpdate(update: TelegramUpdate) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query)
    return
  }
  if (update.message?.text) {
    await handleTextCommand(update.message)
    return
  }
  if (update.message?.photo && update.message.photo.length > 0) {
    await handlePhotoMessage(update.message)
    return
  }
  // Unknown update type — ignore silently
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Callback query (admin tapped [Approve] / [Reject])
// ═══════════════════════════════════════════════════════════════════════════
async function handleCallbackQuery(cq: NonNullable<TelegramUpdate['callback_query']>) {
  const { adminChatId } = getTelegramConfig()
  // Acknowledge immediately — Telegram requires this within 5s
  await answerCallbackQuery(cq.id).catch(() => {})

  // Only admin chat can trigger approve/reject
  if (String(cq.from.id) !== String(adminChatId)) {
    await sendMessage(cq.from.id, '⛔ You are not authorized to approve bookings.')
    return
  }

  const data = cq.data || ''
  const [action, bookingId] = data.split(':')
  if (!bookingId || !action) {
    await sendMessage(adminChatId!, `⚠️ Malformed callback: ${data}`)
    return
  }

  if (action === 'approve') {
    await handleApprove(bookingId, cq)
  } else if (action === 'reject') {
    await handleReject(bookingId, cq)
  } else {
    await sendMessage(adminChatId!, `⚠️ Unknown action: ${action}`)
  }
}

async function handleApprove(
  bookingId: string,
  cq: NonNullable<TelegramUpdate['callback_query']>
) {
  const { adminChatId } = getTelegramConfig()
  if (!adminChatId || !cq.message) return

  // 1. Fetch the booking
  const booking = await getBookingById(bookingId)
  if (!booking) {
    await sendMessage(adminChatId, `❌ Booking ${bookingId} not found.`)
    return
  }
  if (booking.status === 'APPROVED') {
    await sendMessage(adminChatId, `ℹ️ ${bookingId} is already approved.`)
    return
  }

  try {
    // 2. Generate the pass image (signed QR + name overlay composited onto tier template)
    const { buffer } = await generatePass({
      bookingId: booking.id,
      name: booking.name,
      passTier: booking.passTier,
    })

    // 3. Update the Sheet (status=APPROVED; side-effect: appends to Gate_Passes tab)
    await updateBooking(booking.id, { status: 'APPROVED' })

    // 4. Edit the original booking-notification message — replace [Approve][Reject]
    //    with [Send via WhatsApp]. The original was a TEXT message (no screenshot
    //    upload), so we use editMessageText (not editMessageCaption).
    const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
    const newCaption =
      `✅ <b>APPROVED</b>\n\n` +
      `<b>${escapeHtml(booking.name)}</b> · ${escapeHtml(booking.passTier)} × ${booking.quantity}\n` +
      `${inr(booking.expectedAmount)} · 📞 ${escapeHtml(booking.phone)}\n` +
      `UTR: <code>${escapeHtml(booking.utr)}</code>\n` +
      `Booking ID: <code>${escapeHtml(booking.id)}</code>\n\n` +
      `Below is the pass image — forward it to the guest's WhatsApp.`

    // The Pass URL isn't public — there's no /api/pass/[id] route. The pass
    // image is only ever in this Telegram chat + wherever the admin forwards it.
    const keyboard = whatsappShareKeyboard(booking.phone)

    if (cq.message.message_id) {
      await editMessageText(
        cq.message.chat.id,
        cq.message.message_id,
        newCaption,
        { reply_markup: keyboard }
      ).catch(async (err: Error) => {
        console.error('editMessageText failed:', err)
      })
    }

    // 5. Send the pass image as a new message (so admin has it ready to forward)
    await sendPhoto(
      adminChatId,
      buffer,
      `🎟️ Pass for <b>${escapeHtml(booking.name)}</b> · ${escapeHtml(booking.passTier)}\n` +
      `Booking ID: <code>${escapeHtml(booking.id)}</code>`,
      keyboard
    )
  } catch (err) {
    console.error('[handleApprove] error:', err)
    await sendMessage(
      adminChatId,
      `❌ Failed to generate pass for ${bookingId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

async function handleReject(
  bookingId: string,
  cq: NonNullable<TelegramUpdate['callback_query']>
) {
  const { adminChatId } = getTelegramConfig()
  if (!adminChatId || !cq.message) return

  const booking = await getBookingById(bookingId)
  if (!booking) {
    await sendMessage(adminChatId, `❌ Booking ${bookingId} not found.`)
    return
  }

  await updateBooking(booking.id, { status: 'REJECTED' })

  const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
  const newCaption =
    `❌ <b>REJECTED</b>\n\n` +
    `<b>${escapeHtml(booking.name)}</b> · ${escapeHtml(booking.passTier)} × ${booking.quantity}\n` +
    `${inr(booking.expectedAmount)} · 📞 ${escapeHtml(booking.phone)}\n` +
    `UTR: <code>${escapeHtml(booking.utr)}</code>\n` +
    `Booking ID: <code>${escapeHtml(booking.id)}</code>`

  if (cq.message.message_id) {
    await editMessageText(
      cq.message.chat.id,
      cq.message.message_id,
      newCaption,
      { reply_markup: undefined }
    ).catch(async (err: Error) => {
      console.error('editMessageText failed:', err)
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. Text commands
// ═══════════════════════════════════════════════════════════════════════════
async function handleTextCommand(msg: NonNullable<TelegramUpdate['message']>) {
  const { adminChatId } = getTelegramConfig()
  const chatId = msg.chat.id
  const text = msg.text || ''

  // All commands are admin-only
  if (String(chatId) !== String(adminChatId)) {
    await sendMessage(chatId, '⛔ This bot is for admin use only. To scan a guest pass at the gate, send/forward a photo of their QR code.')
    return
  }

  const parts = text.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase().split('@')[0]
  const args = parts.slice(1)

  try {
    switch (cmd) {
      case '/start':
      case '/help':
        await sendMessage(chatId, HELP_TEXT)
        return

      case '/status': {
        const all = await getAllBookings()
        const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 } as Record<string, number>
        let revenue = 0
        for (const b of all) {
          counts[b.status] = (counts[b.status] || 0) + 1
          if (b.status === 'APPROVED') revenue += b.expectedAmount
        }
        const checkedIn = all.filter((b) => b.checkedIn).length
        await sendMessage(
          chatId,
          `📊 <b>CSN Status</b>\n\n` +
          `Total bookings: <b>${all.length}</b>\n` +
          `• Pending:  ${counts.PENDING}\n` +
          `• Approved: ${counts.APPROVED}\n` +
          `• Rejected: ${counts.REJECTED}\n` +
          `• Checked in at gate: ${checkedIn}\n\n` +
          `Approved revenue: <b>₹${revenue.toLocaleString('en-IN')}</b>`
        )
        return
      }

      case '/addevent':
      case '/editevent': {
        if (args.length < 2) {
          await sendMessage(chatId, 'Usage: /addevent <key> <value...>\nKeys: title, date, time, venue, description, phone1, phone2, prices, upiId, upiPayeeName, posters')
          return
        }
        const key = args[0]
        const value = args.slice(1).join(' ')
        await updateEventConfig({ [key]: value })
        await sendMessage(chatId, `✅ Event config updated:\n<code>${escapeHtml(key)}</code> = <code>${escapeHtml(value)}</code>`)
        return
      }

      case '/deleteevent': {
        if (args.length < 1) {
          await sendMessage(chatId, 'Usage: /deleteevent <key>')
          return
        }
        await updateEventConfig({ [args[0]]: '' })
        await sendMessage(chatId, `✅ Event config cleared: <code>${escapeHtml(args[0])}</code>`)
        return
      }

      case '/listevents': {
        const cfg = await getEventConfig()
        const lines: string[] = []
        for (const k of Object.keys(cfg)) {
          if (k.startsWith('_')) continue
          lines.push(`<code>${escapeHtml(k)}</code> = <code>${escapeHtml(String(cfg[k]))}</code>`)
        }
        await sendMessage(chatId, `📋 <b>Current Event_Config</b>\n\n${lines.join('\n')}`)
        return
      }

      case '/addposter': {
        if (args.length < 1) {
          await sendMessage(chatId, 'Usage: /addposter <url-or-filename>')
          return
        }
        await addPoster(args[0])
        await sendMessage(chatId, `✅ Poster added: ${escapeHtml(args[0])}`)
        return
      }

      case '/removeposter': {
        if (args.length < 1) {
          await sendMessage(chatId, 'Usage: /removeposter <url-or-filename>')
          return
        }
        await removePoster(args[0])
        await sendMessage(chatId, `✅ Poster removed: ${escapeHtml(args[0])}`)
        return
      }

      default:
        await sendMessage(chatId, `Unknown command: ${escapeHtml(cmd)}\nSend /help for the list.`)
    }
  } catch (err) {
    console.error(`[handleTextCommand] ${cmd} error:`, err)
    await sendMessage(chatId, `❌ Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const HELP_TEXT =
  '🤖 <b>CSN Signature Events Bot</b>\n\n' +
  'Commands:\n' +
  '• /status — count of bookings by status\n' +
  '• /addevent &lt;key&gt; &lt;value&gt; — set a config value\n' +
  '• /editevent &lt;key&gt; &lt;value&gt; — same as /addevent\n' +
  '• /deleteevent &lt;key&gt; — clear a config value\n' +
  '• /listevents — dump current Event_Config\n' +
  '• /addposter &lt;url&gt; — add a poster to the gallery\n' +
  '• /removeposter &lt;url&gt; — remove a poster\n\n' +
  'Photo messages:\n' +
  '• Send a photo with a QR code → gate-scan validation\n' +
  '• Send a photo without a QR → it becomes a new poster (saved to /public/posters/)\n\n' +
  'New bookings arrive here automatically with [Approve] [Reject] buttons.'

// ═══════════════════════════════════════════════════════════════════════════
//  3. Photo message — gate scan OR poster upload
// ═══════════════════════════════════════════════════════════════════════════
async function handlePhotoMessage(msg: NonNullable<TelegramUpdate['message']>) {
  const { adminChatId, token } = getTelegramConfig()
  if (!token) throw new TelegramNotConfiguredError()

  // Pick the largest photo (last in the array — Telegram sorts ascending)
  const photos = msg.photo || []
  const largest = photos[photos.length - 1]
  if (!largest?.file_id) return

  // Download the photo via Telegram getFile + file download URL
  const filePath = await getFilePath(largest.file_id)
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
  const fileRes = await fetch(downloadUrl)
  if (!fileRes.ok) {
    await sendMessage(msg.chat.id, '❌ Could not download the photo from Telegram.')
    return
  }
  const photoBuffer = Buffer.from(await fileRes.arrayBuffer())

  // Try to decode as QR
  const qrText = await decodeQrFromImage(photoBuffer)

  if (qrText) {
    await handleGateScan(msg.chat.id, qrText)
    return
  }

  // Not a QR — if sender is admin, treat as poster upload
  if (String(msg.chat.id) === String(adminChatId)) {
    await handlePosterUpload(msg.chat.id, photoBuffer, msg.caption || '')
  } else {
    await sendMessage(
      msg.chat.id,
      '⚠️ I couldn\'t read a valid QR code from this photo. If you\'re trying to scan a guest pass at the gate, please send a clear photo of the QR code on the pass.'
    )
  }
}

// Helper — calls Telegram getFile to retrieve the file_path
async function getFilePath(fileId: string): Promise<string> {
  const { token } = getTelegramConfig()
  if (!token) throw new TelegramNotConfiguredError()
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)
  const data = (await res.json()) as { ok: boolean; result?: { file_path: string }; description?: string }
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`Telegram getFile failed: ${data.description || 'unknown'}`)
  }
  return data.result.file_path
}

// Decode a QR from an image buffer using jsqr + sharp (for JPEG→RGBA decode)
async function decodeQrFromImage(buf: Buffer): Promise<string | null> {
  const jsQR = (await import('jsqr')).default
  const sharp = (await import('sharp')).default
  // Decode JPEG to raw RGBA, downscale for speed
  const { data, info } = await sharp(buf)
    .resize({ width: 1024, withoutEnlargement: true })
    .raw() // outputs RGBA
    .toBuffer({ resolveWithObject: true })
  const rgba = new Uint8ClampedArray(data)
  const code = jsQR(rgba, info.width, info.height, { inversionAttempts: 'attemptBoth' })
  return code?.data || null
}

async function handleGateScan(chatId: number, qrText: string) {
  // Validate the signed QR
  const validation = validateSignedQrPayload(qrText)
  if (!validation.ok || !validation.bookingId) {
    await sendMessage(
      chatId,
      `🔴 <b>INVALID</b>\nThis QR doesn't look like a CSN pass. Reason: ${validation.error}`
    )
    return
  }

  const booking = await getBookingById(validation.bookingId)
  if (!booking) {
    await sendMessage(chatId, `🔴 <b>NOT FOUND</b>\nNo booking with ID <code>${escapeHtml(validation.bookingId)}</code>.`)
    return
  }

  if (booking.status === 'REJECTED') {
    await sendMessage(
      chatId,
      `🔴 <b>REJECTED</b>\n${escapeHtml(booking.name)} · ${escapeHtml(booking.passTier)}\nThis booking was rejected.`
    )
    return
  }
  if (booking.status === 'PENDING') {
    await sendMessage(
      chatId,
      `🟡 <b>PENDING APPROVAL</b>\n${escapeHtml(booking.name)} · ${escapeHtml(booking.passTier)}\nPayment not yet approved.`
    )
    return
  }
  if (booking.checkedIn) {
    await sendMessage(
      chatId,
      `🔴 <b>ALREADY USED</b>\n${escapeHtml(booking.name)} · ${escapeHtml(booking.passTier)}\nChecked in at: ${escapeHtml(booking.checkedInAt || 'unknown time')}`
    )
    return
  }

  // Status is APPROVED + not yet checked in — VALID! Mark as checked in.
  // Note: the Apps Script v3 `update` action supports a `checkedIn` field.
  try {
    await updateBooking(booking.id, { checkedIn: true })
  } catch (err) {
    // If the Apps Script doesn't support checkedIn field yet (older version),
    // log the error but still respond positively — the gate-staff validation succeeded.
    console.error('[handleGateScan] updateBooking checkedIn failed:', err)
  }

  const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
  await sendMessage(
    chatId,
    `🟢 <b>VALID — Checked In</b>\n\n` +
    `<b>${escapeHtml(booking.name)}</b>\n` +
    `${escapeHtml(booking.passTier)} × ${booking.quantity}\n` +
    `${inr(booking.expectedAmount)} · 📞 ${escapeHtml(booking.phone)}\n` +
    `Booking ID: <code>${escapeHtml(booking.id)}</code>\n\n` +
    `Welcome to the party 🎉`
  )
}

async function handlePosterUpload(
  chatId: number,
  photoBuffer: Buffer,
  caption: string
) {
  // Save to /public/posters/ with a timestamped filename
  const postersDir = path.join(process.cwd(), 'public', 'posters')
  await fs.mkdir(postersDir, { recursive: true })
  const filename = `poster-admin-${Date.now()}.jpg`
  const filepath = path.join(postersDir, filename)
  await fs.writeFile(filepath, photoBuffer)

  // Add to the Event_Config posters list
  const posterUrl = `/posters/${filename}`
  await addPoster(posterUrl)

  await sendMessage(
    chatId,
    `✅ Poster saved: <code>${escapeHtml(filename)}</code>\n` +
    `URL: <code>${escapeHtml(posterUrl)}</code>\n` +
    (caption ? `Caption: ${escapeHtml(caption)}\n` : '') +
    `The live website's poster gallery will now include this image.`
  )
}

// ─── HTML escape helper ────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
