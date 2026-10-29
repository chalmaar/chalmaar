import { NextResponse } from "next/server";
import { getPublicConfig } from "@/lib/event-config";

/**
 * GET /api/event
 * Returns the current event config (title, date, venue, prices, UPI ID).
 * The client uses this to render the page + build the UPI deep link.
 *
 * SECURITY: Prices + UPI ID come from server config, not client. A user
 * cannot change them in their browser — they can only fetch what the server
 * sends. If they tamper with the fetched values, the /api/book endpoint
 * still uses the SERVER-SIDE values for validation.
 *
 * Source: Sheet's Event_Config tab (admin can update via Telegram commands).
 * Fallback: static EVENT_CONFIG in src/lib/event-config.ts if Sheet is
 * unreachable. Cached for 60 seconds.
 */
export async function GET() {
  const event = await getPublicConfig();
  return NextResponse.json({ ok: true, event });
}
