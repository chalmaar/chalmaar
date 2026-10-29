/**
 * ════════════════════════════════════════════════════════════════════════════
 *  src/lib/pass-generator.ts
 *
 *  Generates the final guest pass image: a tier-colored template (pre-built
 *  in /public/templates/) with a signed QR composited on top, plus the guest's
 *  name + booking ID overlaid as SVG text.
 *
 *  The signed QR encodes  "<bookingId>:<hmac>"  where hmac is the first 16 hex
 *  chars of HMAC-SHA256(bookingId, QR_SIGNING_SECRET). Telegram gate-scan flow:
 *    1. Bouncer sends photo of the guest's pass to the Telegram bot
 *    2. Server decodes the QR via jsqr → extracts (bookingId, hmac)
 *    3. Server recomputes hmac with QR_SIGNING_SECRET → if match, valid signature
 *    4. Server queries Sheet (getBookingById) → checks Status=APPROVED,
 *       Checked In=FALSE → flips Checked In=TRUE
 *    5. Server replies "🟢 VALID — Name — Checked In" or "🔴 INVALID: reason"
 *
 *  ENV VARS:
 *    QR_SIGNING_SECRET — long random string, used for HMAC. Must be the same
 *                        on the FC layer (after redeploy) for the signature
 *                        verification to work at the gate.
 * ════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path'
import crypto from 'node:crypto'
import QRCode from 'qrcode'
import sharp from 'sharp'

// ─── Tier → template filename map ──────────────────────────────────────────
const TIER_TEMPLATES: Record<string, string> = {
  'Female Pass': 'female_pass.jpg',
  'Male Pass': 'male_pass.jpg',
  'Couple Pass': 'couple_pass.jpg',
  'Standing Table': 'standing_table.jpg',
  'Seating Table': 'seating_table.jpg',
}

// QR zone on the templates — matches scripts/gen_pass_templates.py
const QR_TOP = 920
const QR_LEFT = 380
const QR_SIZE = 320

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
  // Format: "csn-xxxxxxxxxxxx:hmac16hex"
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

// ─── SVG text overlay (name + booking ID) ──────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildTextOverlay(name: string, bookingId: string): Buffer {
  // Empty space between y=640 (price) and y=920 (QR top) — place name + ID here.
  const svg = `<svg width="1080" height="240" xmlns="http://www.w3.org/2000/svg">
    <text x="540" y="90" text-anchor="middle"
          font-family="DejaVu Sans, Arial, sans-serif"
          font-size="56" font-weight="bold" fill="#121212">
      ${escapeXml(name.toUpperCase())}
    </text>
    <text x="540" y="180" text-anchor="middle"
          font-family="DejaVu Sans Mono, monospace"
          font-size="24" fill="#121212" letter-spacing="2">
      ${escapeXml(bookingId)}
    </text>
  </svg>`
  return Buffer.from(svg, 'utf-8')
}

// ─── Main: generate the final pass image ────────────────────────────────────
export interface GeneratePassInput {
  bookingId: string
  name: string
  passTier: string
}

export interface GeneratePassOutput {
  buffer: Buffer
  mimeType: 'image/jpeg'
}

/**
 * Generate the final pass JPG. Throws if the tier has no template file or
 * if QR_SIGNING_SECRET is unset.
 */
export async function generatePass(
  input: GeneratePassInput
): Promise<GeneratePassOutput> {
  const templateFile = TIER_TEMPLATES[input.passTier]
  if (!templateFile) {
    throw new Error(
      `No template for tier "${input.passTier}". Known tiers: ${Object.keys(TIER_TEMPLATES).join(', ')}`
    )
  }
  const templatePath = path.join(
    process.cwd(),
    'public',
    'templates',
    templateFile
  )

  const qrPayload = buildSignedQrPayload(input.bookingId)
  const [qrBuffer, textOverlay] = await Promise.all([
    renderQrPng(qrPayload),
    Promise.resolve(buildTextOverlay(input.name, input.bookingId)),
  ])

  const buffer = await sharp(templatePath)
    .composite([
      // Text overlay sits in the empty band between price (y=640) and QR (y=920)
      { input: textOverlay, top: 660, left: 0 },
      // QR zone at (380, 920), 320×320
      { input: qrBuffer, top: QR_TOP, left: QR_LEFT },
    ])
    .jpeg({ quality: 85 })
    .toBuffer()

  return { buffer, mimeType: 'image/jpeg' }
}
