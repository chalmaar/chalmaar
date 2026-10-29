/**
 * ════════════════════════════════════════════════════════════════════════════
 *  src/lib/pass-generator.ts
 *
 *  Generates the final guest pass image:
 *    - Uses the event poster (public/templates/main_poster.jpg, 1200×1500) as background
 *    - Places a large signed QR (480×480) centered horizontally, just below the
 *      "DIWALI Party PASSES LIVE" text (which ends at y=980 per VLM analysis)
 *    - White rounded rectangle behind the QR for visibility
 *    - Small pass-type label below the QR (e.g. "COUPLE PASS")
 *    - Nothing else — no guest name, no booking ID, no "SCAN AT GATE" text
 *
 *  The signed QR encodes  "<bookingId>:<hmac>"  where hmac is the first 16 hex
 *  chars of HMAC-SHA256(bookingId, QR_SIGNING_SECRET).
 *
 *  ENV VARS:
 *    QR_SIGNING_SECRET — long random string, used for HMAC.
 * ════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path'
import crypto from 'node:crypto'
import QRCode from 'qrcode'
import sharp from 'sharp'

// ─── Layout (poster is 1200×1500) ──────────────────────────────────────────
const POSTER_W = 1200
const POSTER_H = 1500

// QR size — doubled from 240 to 480 per user request
const QR_SIZE = 480

// QR position — centered horizontally, just below "DIWALI Party PASSES LIVE"
// text (VLM analysis: the text's yellow frame bottom is at y=980)
const QR_LEFT = (POSTER_W - QR_SIZE) / 2  // (1200 - 480) / 2 = 360
const QR_TOP = 1000                        // 20px gap below the text

// White rounded rectangle behind the QR (for visibility against busy background)
const QR_BG_PADDING = 15
const QR_BG_SIZE = QR_SIZE + QR_BG_PADDING * 2  // 510

// Pass-type label — small text below the QR
const LABEL_TOP = QR_TOP + QR_SIZE + 8  // y = 1488

// ─── Signed-QR helpers ──────────────────────────────────────────────────────
function getSigningSecret(): string {
  const secret = process.env.QR_SIGNING_SECRET?.trim()
  if (!secret) {
    throw new Error(
      'QR_SIGNING_SECRET not set in .env — cannot sign QR codes.'
    )
  }
  return secret
}

/** Compute the first 16 hex chars of HMAC-SHA256(bookingId, secret). */
export function signBookingId(bookingId: string): string {
  const secret = getSigningSecret()
  return crypto
    .createHmac('sha256', secret)
    .update(bookingId)
    .digest('hex')
    .slice(0, 16)
}

/** Build the QR-encodable string: "<bookingId>:<hmac>". */
export function buildSignedQrPayload(bookingId: string): string {
  return `${bookingId}:${signBookingId(bookingId)}`
}

export interface QrValidation {
  ok: boolean
  bookingId?: string
  error?: 'MALFORMED' | 'BAD_SIGNATURE'
}

/** Validate a decoded QR payload. Returns bookingId on success. */
export function validateSignedQrPayload(raw: string): QrValidation {
  const parts = raw.split(':')
  if (parts.length !== 2) {
    return { ok: false, error: 'MALFORMED' }
  }
  const [bookingId, providedHmac] = parts
  if (!bookingId || !providedHmac) {
    return { ok: false, error: 'MALFORMED' }
  }
  const expectedHmac = signBookingId(bookingId)
  if (
    providedHmac.length !== expectedHmac.length ||
    !crypto.timingSafeEqual(
      Buffer.from(providedHmac),
      Buffer.from(expectedHmac)
    )
  ) {
    return { ok: false, error: 'BAD_SIGNATURE' }
  }
  return { ok: true, bookingId }
}

// ─── QR rendering ───────────────────────────────────────────────────────────
async function renderQrPng(text: string): Promise<Buffer> {
  return await QRCode.toBuffer(text, {
    type: 'png',
    margin: 1,
    width: QR_SIZE,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  })
}

// ─── SVG overlays ───────────────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// White rounded rectangle behind the QR
function buildQrBackground(): Buffer {
  const svg = `<svg width="${QR_BG_SIZE}" height="${QR_BG_SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${QR_BG_SIZE}" height="${QR_BG_SIZE}" rx="16" ry="16" fill="#FFFFFF" />
  </svg>`
  return Buffer.from(svg, 'utf-8')
}

// Pass-type label (small, centered, below the QR)
function buildPassTypeLabel(tier: string): Buffer {
  const labelHeight = 20
  const svg = `<svg width="${POSTER_W}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
    <text x="${POSTER_W / 2}" y="${labelHeight - 4}" text-anchor="middle"
          font-family="DejaVu Sans, Arial, sans-serif"
          font-size="16" font-weight="bold" fill="#FFFFFF"
          stroke="#000000" stroke-width="0.5">
      ${escapeXml(tier.toUpperCase())}
    </text>
  </svg>`
  return Buffer.from(svg, 'utf-8')
}

// ─── Main: generate the final pass image ────────────────────────────────────
export interface GeneratePassInput {
  bookingId: string
  name: string
  passTier: string
  quantity?: number
}

export interface GeneratePassOutput {
  buffer: Buffer
  mimeType: 'image/jpeg'
}

/**
 * Generate the final pass JPG using the event poster as the background.
 * Throws if the poster file is missing or QR_SIGNING_SECRET is unset.
 */
export async function generatePass(
  input: GeneratePassInput
): Promise<GeneratePassOutput> {
  const posterPath = path.join(
    process.cwd(),
    'public',
    'templates',
    'main_poster.jpg'
  )

  const qrPayload = buildSignedQrPayload(input.bookingId)

  const [qrBuffer, qrBackground, passTypeLabel] = await Promise.all([
    renderQrPng(qrPayload),
    Promise.resolve(buildQrBackground()),
    Promise.resolve(buildPassTypeLabel(input.passTier)),
  ])

  const buffer = await sharp(posterPath)
    .composite([
      // 1. White rounded rectangle behind the QR (centered, just below the text)
      {
        input: qrBackground,
        top: QR_TOP - QR_BG_PADDING,
        left: QR_LEFT - QR_BG_PADDING,
      },
      // 2. QR code on top of the white rectangle
      { input: qrBuffer, top: QR_TOP, left: QR_LEFT },
      // 3. Pass-type label below the QR (centered)
      { input: passTypeLabel, top: LABEL_TOP, left: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer()

  return { buffer, mimeType: 'image/jpeg' }
}
