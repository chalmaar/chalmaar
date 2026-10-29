/**
 * ════════════════════════════════════════════════════════════════════════════
 *  SERVER-SIDE EVENT CONFIG
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Two sources, layered:
 *
 *    1. EVENT_CONFIG (static, this file) — the fallback. Used when the Sheet
 *       webhook is unreachable or unconfigured. NEVER changed at runtime.
 *
 *    2. getLiveConfig() (async) — fetches the latest config from the Sheet's
 *       Event_Config tab via the Apps Script webhook. Telegram admin commands
 *       (/addevent, /editevent, /deleteevent, /addposter, /removeposter)
 *       update the Sheet → live config reflects the change within 60s.
 *
 *  SECURITY: Both sources are server-side. The client NEVER sends an amount
 *  or UPI ID — /api/book uses computeExpectedAmount() with the live config
 *  to recompute the price itself. Tampering with the amount in the browser
 *  has zero effect.
 */

import { getEventConfig, type EventConfig as SheetConfig } from '@/lib/db'

export interface EventConfig {
  active: boolean
  title: string
  date: string
  time: string
  venue: string
  description: string
  phone1: string
  phone2: string
  prices: Record<string, number>
  upiId: string
  upiPayeeName: string
}

// ─── Static fallback (server-side source of truth when Sheet is unreachable) ─
export const EVENT_CONFIG: EventConfig = {
  active: true,
  title: 'DIWALI PARTY — Featuring Sudhanshu & Maryana',
  date: '2026-11-07',
  time: '5:00 PM Onwards',
  venue: 'TERRA Plates and Pour, Near Prozone Mall, Chh. Sambhajinagar',
  description:
    'The biggest Diwali night in Chh. Sambhajinagar. Sudhanshu & Maryana headlining a high-energy set at TERRA. Pass tiers for every kind of night-owl — female, male, couple, and exclusive standing / seating tables.',
  phone1: '9923973380',
  phone2: '8180044118',
  prices: {
    'Female Pass': 999,
    'Male Pass': 2499,
    'Couple Pass': 2999,
    'Standing Table': 20000,
    'Seating Table': 30000,
  },
  upiId: '9359248812@ybl',
  upiPayeeName: 'CSN Signature Events',
}

// ─── In-memory cache for the live config (TTL 60 seconds) ──────────────────
let liveConfigCache: EventConfig | null = null
let liveConfigCacheTime = 0
const LIVE_CONFIG_TTL_MS = 60_000

/**
 * Get the live event config, merging values from the Sheet's Event_Config
 * tab over the static fallback. Cached for 60 seconds.
 *
 * Falls back to the static EVENT_CONFIG if:
 *   - APPS_SCRIPT_WEBHOOK_URL isn't set
 *   - The webhook call fails
 *   - The Sheet returns an empty config
 */
export async function getLiveConfig(): Promise<EventConfig> {
  const now = Date.now()
  if (liveConfigCache && now - liveConfigCacheTime < LIVE_CONFIG_TTL_MS) {
    return liveConfigCache
  }

  try {
    const sheet = (await getEventConfig()) as SheetConfig
    if (sheet && Object.keys(sheet).length > 0) {
      const merged: EventConfig = { ...EVENT_CONFIG }

      if (sheet.title) merged.title = sheet.title
      if (sheet.date) merged.date = sheet.date
      if (sheet.time) merged.time = sheet.time
      if (sheet.venue) merged.venue = sheet.venue
      if (sheet.description) merged.description = sheet.description
      if (sheet.phone1) merged.phone1 = sheet.phone1
      if (sheet.phone2) merged.phone2 = sheet.phone2
      if (sheet.upiId) merged.upiId = sheet.upiId
      if (sheet.upiPayeeName) merged.upiPayeeName = sheet.upiPayeeName
      if (typeof sheet.active === 'string') {
        merged.active = sheet.active === 'true' || sheet.active === '1'
      }
      // Parsed prices (from "Female Pass:999,Male Pass:2499,..." format)
      if (sheet._prices && Object.keys(sheet._prices).length > 0) {
        merged.prices = { ...sheet._prices } as Record<string, number>
      }

      liveConfigCache = merged
      liveConfigCacheTime = now
      return merged
    }
  } catch (err) {
    // Likely SHEETS_NOT_CONFIGURED — silent fallback to static
    if (process.env.NODE_ENV !== 'production') {
      console.error('[getLiveConfig] fallback to static:', err instanceof Error ? err.message : err)
    }
  }

  // Use static, but still cache for TTL to avoid spamming the webhook on failure
  liveConfigCache = EVENT_CONFIG
  liveConfigCacheTime = now
  return EVENT_CONFIG
}

/**
 * Public config — what the client is allowed to see. Now async because it
 * merges the live Sheet config over the static fallback.
 */
export async function getPublicConfig(): Promise<EventConfig> {
  return await getLiveConfig()
}

/**
 * Server-side price lookup using the LIVE config (admin can change prices
 * via Telegram and they take effect within 60s).
 *
 * NEVER trust a client-sent amount. The /api/book endpoint uses this to
 * recompute expectedAmount = prices[tier] * quantity from the live server
 * config.
 */
export async function computeExpectedAmountLive(
  tier: string,
  quantity: number
): Promise<number | null> {
  const cfg = await getLiveConfig()
  const unitPrice = cfg.prices[tier]
  if (unitPrice === undefined) return null
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return null
  return unitPrice * quantity
}

/**
 * Sync price lookup using the STATIC config — kept for backwards compat.
 * Prefer computeExpectedAmountLive() in API routes.
 */
export function computeExpectedAmount(tier: string, quantity: number): number | null {
  const unitPrice = EVENT_CONFIG.prices[tier]
  if (unitPrice === undefined) return null
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return null
  return unitPrice * quantity
}
