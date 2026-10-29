/**
 * ════════════════════════════════════════════════════════════════════════════
 *  src/lib/db.ts — single data-access module for the CSN booking site.
 *  Backed by a Google Apps Script webhook that manages 3 Sheet tabs:
 *
 *    Bookings_Payments — full ledger (every booking + payment screenshot URL)
 *    Gate_Passes       — gate-staff view (synced subset of APPROVED bookings)
 *    Event_Config      — dynamic key-value store for event title/date/prices/UPI
 *
 *  ENV VARS:
 *    APPS_SCRIPT_WEBHOOK_URL — the /exec URL from Apps Script deployment
 *    APPS_SCRIPT_SECRET      — optional shared secret (matches SHARED_SECRET
 *                              script property in Apps Script)
 *
 *  Every call hits the webhook over native fetch (works fine from Node;
 *  Google's edge layer blocks curl-style POSTs with the ppConfig interstitial
 *  but lets Node fetch through).
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── Errors ────────────────────────────────────────────────────────────────
export class SheetsNotConfiguredError extends Error {
  code = 'SHEETS_NOT_CONFIGURED' as const
  constructor() {
    super(
      'Apps Script webhook not configured. Set APPS_SCRIPT_WEBHOOK_URL in .env.'
    )
  }
}

export class UtrAlreadyUsedError extends Error {
  code = 'UTR_ALREADY_USED' as const
  constructor() {
    super('UTR_ALREADY_USED')
  }
}

// ─── Config + webhook client ────────────────────────────────────────────────
function getConfig() {
  const url = process.env.APPS_SCRIPT_WEBHOOK_URL?.trim()
  if (!url) throw new SheetsNotConfiguredError()
  const secret = process.env.APPS_SCRIPT_SECRET?.trim() || ''
  return { url, secret }
}

export type WebhookAction =
  | 'append'
  | 'checkUtr'
  | 'update'
  | 'list'
  | 'getBooking'
  | 'getEventConfig'
  | 'updateEventConfig'
  | 'addPoster'
  | 'removePoster'

interface WebhookResponse {
  ok: boolean
  error?: string
  used?: boolean
  bookings?: BookingRow[]
  booking?: BookingRow
  config?: EventConfig
  bookingId?: string
  [key: string]: unknown
}

export async function callWebhook(
  action: WebhookAction,
  payload: Record<string, unknown> = {}
): Promise<WebhookResponse> {
  const { url, secret } = getConfig()
  const body = JSON.stringify({ action, secret, ...payload })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new Error(
      `Webhook HTTP ${res.status}: ${await res.text().catch(() => '')}`
    )
  }
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const sample = await res.text().catch(() => '')
    throw new Error(
      `Webhook returned non-JSON (likely Google ppConfig interstitial). ` +
        `First 200 chars: ${sample.slice(0, 200)}`
    )
  }
  return (await res.json()) as WebhookResponse
}

// ─── Types ──────────────────────────────────────────────────────────────────
export interface BookingRow {
  timestamp: string
  bookingId: string
  name: string
  phone: string
  passTier: string
  quantity: number | string
  expectedAmount: number | string
  utr: string
  screenshotUrl: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  approvedAt?: string
  passFileId?: string
  checkedIn?: string
  checkedInAt?: string
}

// Booking shape returned to the rest of the app (normalized numbers)
export interface Booking {
  id: string
  name: string
  phone: string
  passTier: string
  quantity: number
  expectedAmount: number
  utr: string
  screenshotUrl?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  approvedAt?: string
  passFileId?: string
  checkedIn?: boolean
  checkedInAt?: string
}

function rowToBooking(r: BookingRow): Booking {
  return {
    id: r.bookingId,
    name: r.name,
    phone: r.phone,
    passTier: r.passTier,
    quantity: parseInt(String(r.quantity), 10) || 0,
    expectedAmount: parseInt(String(r.expectedAmount), 10) || 0,
    utr: r.utr,
    screenshotUrl: r.screenshotUrl || undefined,
    status: r.status || 'PENDING',
    createdAt: r.timestamp,
    approvedAt: r.approvedAt || undefined,
    passFileId: r.passFileId || undefined,
    checkedIn: String(r.checkedIn).toUpperCase() === 'TRUE',
    checkedInAt: r.checkedInAt || undefined,
  }
}

// ─── Booking operations ─────────────────────────────────────────────────────
function generateBookingId(): string {
  return 'csn-' + Math.random().toString(16).slice(2, 12)
}

export async function isUTRUsed(utr: string): Promise<boolean> {
  const res = await callWebhook('checkUtr', { utr })
  if (!res.ok) throw new Error(res.error || 'WEBHOOK_ERROR')
  return Boolean(res.used)
}

export interface NewBookingInput {
  name: string
  phone: string
  passTier: string
  quantity: number
  expectedAmount: number
  utr: string
  screenshotUrl?: string
}

export async function appendBooking(
  input: NewBookingInput
): Promise<Booking> {
  const id = generateBookingId()
  const createdAt = new Date().toISOString()

  const res = await callWebhook('append', {
    bookingId: id,
    name: input.name,
    phone: input.phone,
    passTier: input.passTier,
    quantity: String(input.quantity),
    expectedAmount: String(input.expectedAmount),
    utr: input.utr,
    screenshotUrl: input.screenshotUrl || '',
    status: 'PENDING',
  })

  if (!res.ok) {
    if (res.error === 'UTR_ALREADY_USED') throw new UtrAlreadyUsedError()
    throw new Error(res.error || 'WEBHOOK_ERROR')
  }

  return {
    id,
    name: input.name,
    phone: input.phone,
    passTier: input.passTier,
    quantity: input.quantity,
    expectedAmount: input.expectedAmount,
    utr: input.utr,
    screenshotUrl: input.screenshotUrl,
    status: 'PENDING',
    createdAt,
    checkedIn: false,
  }
}

export async function getAllBookings(): Promise<Booking[]> {
  const res = await callWebhook('list')
  if (!res.ok) throw new Error(res.error || 'WEBHOOK_ERROR')
  const rows = res.bookings || []
  return rows
    .map(rowToBooking)
    .filter((b) => b.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getBookingById(id: string): Promise<Booking | null> {
  const res = await callWebhook('getBooking', { bookingId: id })
  if (!res.ok) {
    if (res.error === 'BOOKING_NOT_FOUND') return null
    throw new Error(res.error || 'WEBHOOK_ERROR')
  }
  return res.booking ? rowToBooking(res.booking) : null
}

export interface UpdateBookingInput {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  passFileId?: string
  screenshotUrl?: string
  checkedIn?: boolean
}

export async function updateBooking(
  id: string,
  updates: UpdateBookingInput
): Promise<{ ok: true }> {
  const payload: Record<string, unknown> = { bookingId: id }
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.passFileId !== undefined) payload.passFileId = updates.passFileId
  if (updates.screenshotUrl !== undefined) payload.screenshotUrl = updates.screenshotUrl
  if (updates.checkedIn !== undefined) payload.checkedIn = updates.checkedIn ? 'TRUE' : 'FALSE'
  const res = await callWebhook('update', payload)
  if (!res.ok) throw new Error(res.error || 'WEBHOOK_ERROR')
  return { ok: true }
}

// ─── Event config (key-value store) ─────────────────────────────────────────
export interface EventConfig {
  active?: string
  title?: string
  date?: string
  time?: string
  venue?: string
  description?: string
  phone1?: string
  phone2?: string
  prices?: string // raw "Tier:price,Tier:price,..."
  upiId?: string
  upiPayeeName?: string
  posters?: string // raw comma-separated
  _prices?: Record<string, number> // parsed
  _posters?: string[] // parsed
  [key: string]: unknown
}

export async function getEventConfig(): Promise<EventConfig> {
  const res = await callWebhook('getEventConfig')
  if (!res.ok) throw new Error(res.error || 'WEBHOOK_ERROR')
  return (res.config as EventConfig) || {}
}

export async function updateEventConfig(
  updates: Record<string, string>
): Promise<{ ok: true }> {
  const res = await callWebhook('updateEventConfig', { updates })
  if (!res.ok) throw new Error(res.error || 'WEBHOOK_ERROR')
  return { ok: true }
}

export async function addPoster(url: string): Promise<{ ok: true }> {
  const res = await callWebhook('addPoster', { url })
  if (!res.ok) throw new Error(res.error || 'WEBHOOK_ERROR')
  return { ok: true }
}

export async function removePoster(url: string): Promise<{ ok: true }> {
  const res = await callWebhook('removePoster', { url })
  if (!res.ok) throw new Error(res.error || 'WEBHOOK_ERROR')
  return { ok: true }
}

// ─── For backwards compat with old imports ──────────────────────────────────
// (so existing API routes that import from @/lib/bookings-store or
// @/lib/google-sheets still work after we delete those files.)
export {
  SheetsNotConfiguredError as WebhookNotConfiguredError,
  UtrAlreadyUsedError,
  callWebhook,
}
