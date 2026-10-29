import { NextResponse } from 'next/server'
import { generatePass } from '@/lib/pass-generator'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const bookingId = url.searchParams.get('bookingId') || 'csn-test123'
  const name = url.searchParams.get('name') || 'Test User'
  const tier = url.searchParams.get('tier') || 'Couple Pass'

  try {
    const { buffer, mimeType } = await generatePass({ bookingId, name, passTier: tier })
    return new NextResponse(buffer, {
      status: 200,
      headers: { 'Content-Type': mimeType, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[/api/test-pass] error:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
