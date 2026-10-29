/**
 * scripts/setup-google-sheet.ts
 * ════════════════════════════════════════════════════════════════════════════
 * Triggers the Apps Script to create the "Bookings" tab + 12 column headers
 * in the Google Sheet. Run after setting APPS_SCRIPT_WEBHOOK_URL in .env:
 *
 *   bun run scripts/setup-google-sheet.ts
 *
 * The Apps Script's `ensureSheet_()` function runs on the first call to any
 * action (checkUtr, append, or list), so this script just calls checkUtr
 * with a fake UTR — that triggers ensureSheet_ as a side effect.
 */

import { config } from 'dotenv'
import { callWebhook } from '../src/lib/google-sheets'

config()

async function main() {
  console.log('\n🔗 Webhook URL:', process.env.APPS_SCRIPT_WEBHOOK_URL)
  console.log('🔑 Secret:', process.env.APPS_SCRIPT_SECRET ? 'set' : '(none — webhook is open)')
  console.log('\n⏳ Triggering ensureSheet_ via checkUtr call...')

  try {
    const res = await callWebhook('checkUtr', { utr: '000000000000' })
    if (res.ok) {
      console.log('\n✅ Sheet is ready. Open your Google Sheet — the "Bookings"')
      console.log('   tab should now have the 12-column header row in row 1:')
      console.log('   Timestamp | Booking ID | Name | Phone | Pass Tier | Quantity |')
      console.log('   Expected Amount | UTR | Status | Pass URL | Checked In | Checked In At')
      console.log('\n📱 AppSheet setup:')
      console.log('   1. https://www.appsheet.com → New App → Start with existing data')
      console.log('   2. Pick the Google Sheet that has the "Bookings" tab.')
      console.log('   3. AppSheet auto-detects all 12 columns.')
      console.log('   4. Set "Booking ID" as the Key column.')
      console.log('   5. Build a Detail view showing Pass URL (gate staff verify pass).')
      console.log('   6. Add an action: flip "Checked In" → TRUE, "Checked In At" → NOW().')
      console.log('')
    } else {
      console.log('\n❌ Webhook returned error:', res.error)
      process.exit(1)
    }
  } catch (err) {
    console.error('\n❌ Setup failed:', err instanceof Error ? err.message : err)
    console.error('\n   Common causes:')
    console.error('   • APPS_SCRIPT_WEBHOOK_URL not set in .env')
    console.error('   • Apps Script not deployed (Deploy → Web app → /exec URL)')
    console.error('   • Sheet not shared with the executing Google account')
    process.exit(1)
  }
}

main()
