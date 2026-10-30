/**
 * ════════════════════════════════════════════════════════════════════════════
 *  src/lib/telegram.ts
 *
 *  Minimal Telegram Bot API client — just what we need:
 *    - sendMessage       — text + optional inline keyboard
 *    - sendPhoto         — photo (Buffer) + caption + optional inline keyboard
 *    - editMessageMedia  — replace a message's photo (used after Approve)
 *    - answerCallbackQuery — ack the button tap so it shows a checkmark
 *    - getFile + downloadFile — used when bouncer sends a photo (gate scan)
 *    - setWebhook        — one-time setup, called from /api/telegram/setup
 *
 *  ENV VARS:
 *    TELEGRAM_BOT_TOKEN   — from @BotFather
 *    TELEGRAM_ADMIN_CHAT_ID — your personal chat ID (numeric string)
 *
 *  Telegram requires answerCallbackQuery within 5 seconds of the button tap.
 *  Our /api/telegram/route.ts webhook must ack first, then do the slow work
 *  (generate pass image, call Apps Script) — Telegram won't wait for the slow
 *  work to finish.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── Config ────────────────────────────────────────────────────────────────
export function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim()
  return { token, adminChatId }
}

export class TelegramNotConfiguredError extends Error {
  code = 'TELEGRAM_NOT_CONFIGURED' as const
  constructor() {
    super(
      'Telegram bot not configured. Set TELEGRAM_BOT_TOKEN and ' +
        'TELEGRAM_ADMIN_CHAT_ID in .env.'
    )
  }
}

function requireToken(): string {
  const { token } = getTelegramConfig()
  if (!token) throw new TelegramNotConfiguredError()
  return token
}

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${requireToken()}/${method}`
}

// File-download URL uses /file/bot<token>/ prefix
function fileUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${requireToken()}/${filePath}`
}

// ─── Types ─────────────────────────────────────────────────────────────────
export interface InlineButton {
  text: string
  callback_data: string
  url?: string
}

export type InlineKeyboard = InlineButton[][]

export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string }
    from?: { id: number; first_name?: string; last_name?: string; username?: string }
    text?: string
    photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>
    caption?: string
    reply_markup?: { inline_keyboard?: InlineKeyboard }
  }
  callback_query?: {
    id: string
    from: { id: number; first_name?: string; username?: string }
    message?: {
      message_id: number
      chat: { id: number }
      text?: string
      caption?: string
      reply_markup?: { inline_keyboard?: InlineKeyboard }
    }
    data: string  // callback_data string we set when creating the button
  }
}

// ─── Bot API methods ───────────────────────────────────────────────────────
// tgPost with RETRY LOGIC — handles Render free-tier ETIMEDOUT errors
// by retrying up to 3 times with exponential backoff (2s, 4s delays).
// Each attempt has a 15-second timeout via AbortController.
async function tgPost<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
  formData?: FormData
): Promise<T> {
  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const res = formData
        ? await fetch(apiUrl(method), { method: 'POST', body: formData, signal: controller.signal })
        : await fetch(apiUrl(method), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          })

      clearTimeout(timeout)

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Telegram ${method} HTTP ${res.status}: ${text.slice(0, 300)}`)
      }
      const data = (await res.json()) as { ok: boolean; description?: string; result?: T }
      if (!data.ok) {
        throw new Error(`Telegram ${method} API error: ${data.description || 'unknown'}`)
      }
      return data.result as T
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        const delay = 2000 * attempt
        console.error(`[tgPost] ${method} attempt ${attempt}/${maxRetries} failed (${lastError.message}), retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error(`Telegram ${method} failed after ${maxRetries} retries`)
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  options: { reply_markup?: { inline_keyboard: InlineKeyboard } } = {}
): Promise<{ message_id: number }> {
  return tgPost<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options,
  })
}

export async function sendPhoto(
  chatId: string | number,
  photo: Buffer,
  caption: string,
  options: { reply_markup?: { inline_keyboard: InlineKeyboard } } = {}
): Promise<{ message_id: number }> {
  const fd = new FormData()
  fd.append('chat_id', String(chatId))
  fd.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'pass.jpg')
  fd.append('caption', caption)
  fd.append('parse_mode', 'HTML')
  if (options.reply_markup) {
    fd.append('reply_markup', JSON.stringify(options.reply_markup))
  }
  return tgPost<{ message_id: number }>('sendPhoto', {}, fd)
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  await tgPost('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  })
}

export async function editMessageReplyMarkup(
  chatId: string | number,
  messageId: number,
  replyMarkup: { inline_keyboard: InlineKeyboard } | undefined
): Promise<void> {
  await tgPost('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  })
}

export async function editMessageCaption(
  chatId: string | number,
  messageId: number,
  caption: string,
  options: { reply_markup?: { inline_keyboard: InlineKeyboard } } = {}
): Promise<void> {
  await tgPost('editMessageCaption', {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: 'HTML',
    ...options,
  })
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  options: { reply_markup?: { inline_keyboard: InlineKeyboard } } = {}
): Promise<void> {
  await tgPost('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options,
  })
}

// ─── File download (used when bouncer sends a photo for gate scan) ─────────
export async function getFile(fileId: string): Promise<{ file_path: string; file_size?: number }> {
  return tgPost<{ file_path: string; file_size?: number }>('getFile', { file_id: fileId })
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const info = await getFile(fileId)
  const res = await fetch(fileUrl(info.file_path))
  if (!res.ok) {
    throw new Error(`Telegram file download HTTP ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// ─── Webhook setup ─────────────────────────────────────────────────────────
export async function setWebhook(webhookUrl: string): Promise<void> {
  await tgPost('setWebhook', { url: webhookUrl, drop_pending_updates: true })
}

export async function deleteWebhook(): Promise<void> {
  await tgPost('deleteWebhook', {})
}

// ─── Inline-keyboard builders ──────────────────────────────────────────────
export function approveRejectKeyboard(bookingId: string): { inline_keyboard: InlineKeyboard } {
  return {
    inline_keyboard: [
      [
        { text: '✓ Approve', callback_data: `approve:${bookingId}` },
        { text: '✗ Reject', callback_data: `reject:${bookingId}` },
      ],
    ],
  }
}

export function whatsappShareKeyboard(phone: string, passUrl?: string): { inline_keyboard: InlineKeyboard } {
  // wa.me URL — pre-fills the guest's phone + a text message.
  // If passUrl is empty (security-focused plan: no public pass URL), the
  // message just tells the guest to expect / show the pass at the gate —
  // the admin separately saves the pass photo from Telegram and attaches it
  // to the WhatsApp chat manually.
  const messageText = passUrl
    ? `Hi, here's your CSN Signature Events pass. Show this at the gate: ${passUrl}`
    : `Hi, your CSN Signature Events pass is approved! Please show the attached pass image at the gate. See you at TERRA on 07 Nov 🎉`
  const text = encodeURIComponent(messageText)
  return {
    inline_keyboard: [
      [{ text: '📲 Send via WhatsApp →', url: `https://wa.me/91${phone}?text=${text}` }],
    ],
  }
}
