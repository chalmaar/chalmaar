import { NextResponse } from 'next/server'
import { getBookingById, updateBooking } from '@/lib/db'
import { validateSignedQrPayload } from '@/lib/pass-generator'
import crypto from 'node:crypto'

export const runtime = 'nodejs'

// TOTP verification (Google Authenticator) — no external packages needed
function base32Decode(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const value = alphabet.indexOf(char)
    if (value === -1) continue
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2))
  }
  return Buffer.from(bytes)
}

function generateTotp(secret: string, time: number): string {
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64BE(BigInt(time))
  const key = base32Decode(secret)
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000
  return String(code).padStart(6, '0')
}

function verifyTotp(token: string, secret: string): boolean {
  const time = Math.floor(Date.now() / 1000 / 30)
  for (let offset = -1; offset <= 1; offset++) {
    if (token === generateTotp(secret, time + offset)) return true
  }
  return false
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const qr = url.searchParams.get('qr')
  if (!qr) return NextResponse.json({ ok: false, error: 'NO_QR' }, { status: 400 })

  const validation = validateSignedQrPayload(qr)
  if (!validation.ok || !validation.bookingId) {
    return NextResponse.json({ ok: false, error: 'INVALID_QR' })
  }

  const booking = await getBookingById(validation.bookingId)
  if (!booking) return NextResponse.json({ ok: false, error: 'NOT_FOUND' })

  const phone = booking.phone || ''
  const last4 = phone.length >= 4 ? phone.slice(-4) : phone

  return NextResponse.json({
    ok: true,
    booking: {
      name: booking.name,
      passTier: booking.passTier,
      quantity: booking.quantity,
      phoneLast4: last4,
      status: booking.status,
      checkedIn: booking.checkedIn,
      checkedInAt: booking.checkedInAt,
    }
  })
}

export async function POST(req: Request) {
  const body = await req.json()

  // TOTP verification (Google Authenticator)
  if (body.action === 'verifyTotp') {
    const secret = process.env.GATE_TOTP_SECRET || ''
    if (!secret) return NextResponse.json({ ok: false, error: 'TOTP_NOT_CONFIGURED' }, { status: 500 })
    if (verifyTotp(body.token || '', secret)) {
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: false, error: 'INVALID_CODE' }, { status: 403 })
  }

  // Check-in
  if (body.action === 'checkin') {
    const qr = body.qr
    if (!qr) return NextResponse.json({ ok: false, error: 'NO_QR' }, { status: 400 })

    const validation = validateSignedQrPayload(qr)
    if (!validation.ok || !validation.bookingId) {
      return NextResponse.json({ ok: false, error: 'INVALID_QR' })
    }

    const booking = await getBookingById(validation.bookingId)
    if (!booking) return NextResponse.json({ ok: false, error: 'NOT_FOUND' })
    if (booking.status !== 'APPROVED') return NextResponse.json({ ok: false, error: 'NOT_APPROVED' })
    if (booking.checkedIn) return NextResponse.json({ ok: false, error: 'ALREADY_CHECKED_IN', checkedInAt: booking.checkedInAt })

    await updateBooking(booking.id, { checkedIn: true })

    return NextResponse.json({
      ok: true,
      name: booking.name,
      passTier: booking.passTier,
      checkedInAt: new Date().toISOString(),
    })
  }

  return NextResponse.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 })
}
