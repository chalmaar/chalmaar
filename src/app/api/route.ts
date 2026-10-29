import { NextResponse } from 'next/server'
import { getBookingById } from '@/lib/db'
import { generatePass, signBookingId } from '@/lib/pass-generator'
import crypto from 'node:crypto'

export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { bookingId: string } }
) {
  const { bookingId } = params
  const url = new URL(req.url)
  const sig = url.searchParams.get('sig')

  // Security: verify the HMAC signature to prevent IDOR
  // Without the correct sig (derived from QR_SIGNING_SECRET),
  // return 403 — even if the attacker knows the booking ID.
  const expectedSig = signBookingId(bookingId)
  if (
    !sig ||
    sig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
  ) {
    return NextResponse.json(
      { ok: false, error: 'UNAUTHORIZED' },
      { status: 403 }
    )
  }

  try {
    const booking = await getBookingById(bookingId)
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: 'BOOKING_NOT_FOUND' },
        { status: 404 }
      )
    }

    const { buffer, mimeType } = await generatePass({
      bookingId: booking.id,
      name: booking.name,
      passTier: booking.passTier,
      quantity: booking.quantity,
    })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[/api/pass] error:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
