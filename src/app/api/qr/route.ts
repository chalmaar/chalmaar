import { NextResponse } from 'next/server'
import QRCode from 'qrcode'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const pa = url.searchParams.get('pa')
  const am = url.searchParams.get('am')
  if (!pa || !am) return NextResponse.json({ error: 'Missing pa or am' }, { status: 400 })
  const upiUri = `upi://pay?pa=${pa}&am=${am}&cu=INR`
  const buffer = await QRCode.toBuffer(upiUri, { width: 300, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } })
  return new NextResponse(buffer, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } })
}
