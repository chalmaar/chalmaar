'use client'

import { useState, useEffect, useRef } from 'react'

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

// ─── Fallback config (used while fetching from server, or if fetch fails) ────
const FALLBACK_CONFIG = {
  active: true,
  title: 'DIWALI PARTY — Featuring Sudhanshu & Maryana',
  date: '2026-11-07',
  time: '5:00 PM Onwards',
  venue: 'TERRA Plates and Pour, Near Prozone Mall, Chh. Sambhajinagar',
  description: 'The biggest Diwali night in Chh. Sambhajinagar. Sudhanshu & Maryana headlining a high-energy set at TERRA. Pass tiers for every kind of night-owl — female, male, couple, and exclusive standing / seating tables.',
  phone1: '9923973380',
  phone2: '8180044118',
  prices: {
    'Female Pass': 999,
    'Male Pass': 2499,
    'Couple Pass': 2999,
    'Standing Table': 20000,
    'Seating Table': 30000,
  } as Record<string, number>,
  upiId: '9359248812@ybl',
  upiPayeeName: 'CSN Signature Events',
}

function inr(n: number) { return '₹' + Number(n).toLocaleString('en-IN') }

type StatusKind = 'error' | 'success' | 'info'

export default function Home() {
  // ─── Viewport-aware responsive state (SSR-safe) ────────────────────────────
  const [isDesktop, setIsDesktop] = useState(false)
  const [isTablet, setIsTablet] = useState(false)

  // ─── Event config (fetched from /api/event — server-side source of truth) ──
  // SECURITY: prices + UPI ID come from the server, not hardcoded in client.
  // A user can change these values in their browser, but the /api/book endpoint
  // ignores any client-sent amount and uses the SERVER-SIDE prices for validation.
  const [EVENT, setEVENT] = useState(FALLBACK_CONFIG)

  useEffect(() => {
    const update = () => {
      setIsDesktop(window.innerWidth >= 1024)
      setIsTablet(window.innerWidth >= 640)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Fetch event config from server on mount
  useEffect(() => {
    fetch('/api/event')
      .then(r => r.json())
      .then(j => {
        if (j.ok && j.event) {
          setEVENT(j.event)
        }
      })
      .catch(() => {
        // Keep fallback config if fetch fails
      })
  }, [])

  // ─── Booking form state (drawer is always open now — no toggle) ────────────
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [tier, setTier] = useState('')
  const [qty, setQty] = useState(1)
  const [utr, setUtr] = useState('')
  const [statusHtml, setStatusHtml] = useState('')
  const [statusKind, setStatusKind] = useState<StatusKind>('info')
  const [submitting, setSubmitting] = useState(false)

  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  // ─── Quantity stepper (no manual typing — prevents manipulation) ────────────
  const incQty = () => setQty(q => Math.min(10, q + 1))
  const decQty = () => setQty(q => Math.max(1, q - 1))

  // ─── Poster carousel state ─────────────────────────────────────────────────
  const POSTERS = [
    { src: '/posters/poster-1-group.jpeg',        alt: 'Diwali Party — Group flyer' },
    { src: '/posters/poster-2-maryana.jpeg',      alt: 'Diwali Party — Featuring Maryana' },
    { src: '/posters/poster-3-sudhanshu.jpeg',    alt: 'Diwali Party — Featuring Sudhanshu' },
    { src: '/posters/poster-4-passes-live.jpeg',  alt: 'Diwali Party — Passes Live' },
    { src: '/posters/poster-5-pass-rates.jpeg',   alt: 'Diwali Party — Pass Rates' },
    { src: '/posters/poster-6-table-rates.jpeg',  alt: 'Diwali Party — Table Rates' },
  ]
  const [posterIdx, setPosterIdx] = useState(0)
  const prevPoster = () => setPosterIdx(i => (i - 1 + POSTERS.length) % POSTERS.length)
  const nextPoster = () => setPosterIdx(i => (i + 1) % POSTERS.length)
  // Auto-advance every 4.5s
  useEffect(() => {
    const t = setInterval(() => setPosterIdx(i => (i + 1) % POSTERS.length), 4500)
    return () => clearInterval(t)
  }, [POSTERS.length])

  // ─── Derived: total + UPI URI ──────────────────────────────────────────────
  // Uses EVENT.prices (fetched from server) instead of hardcoded PASS_PRICES.
  const price = tier ? EVENT.prices[tier] : 0
  const total = price * qty
  // NOTE: upiUri is NOT precomputed as a variable — it's constructed inside
  // the Pay button's onClick handler at click time, so it never appears in
  // the page source or DOM. See STEP 03 below.

  // ─── Calendar helpers (calendar removed — date shown in event details card) ─
  // The Sheet's Event_Config tab returns the date as a verbose Date.toString()
  // string (e.g. "Sat Nov 07 2026 00:00:00 GMT+0530 (India Standard Time)")
  // because Google Sheets auto-converts "2026-11-07" cells to Date objects.
  // new Date(EVENT.date) handles both verbose + ISO formats correctly.
  // (Don't append "T00:00:00" — that breaks the verbose format.)
  const eventDate = new Date(EVENT.date)

  // ─── Form submission ───────────────────────────────────────────────────────
  const showStatus = (html: string, kind: StatusKind) => {
    setStatusHtml(html)
    setStatusKind(kind)
  }

  const handleSubmit = async () => {
    // ─── Client-side pre-validation (for UX — server re-validates everything) ──
    if (name.trim().length < 2) return showStatus('⚠️ Enter name (min 2 letters, max 15).', 'error')
    if (!/^[A-Za-z\s]{2,15}$/.test(name.trim())) return showStatus('⚠️ Name must be letters only (2–15 chars).', 'error')
    if (!/^[6-9]\d{9}$/.test(phone.trim())) return showStatus('⚠️ Invalid WhatsApp (10-digit, starts 6-9).', 'error')
    if (!tier) return showStatus('⚠️ Select a pass tier.', 'error')
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) return showStatus('⚠️ Quantity must be 1–10.', 'error')
    if (!/^\d{12}$/.test(utr.trim())) return showStatus('⚠️ UTR must be 12 digits.', 'error')

    setSubmitting(true)
    showStatus('Submitting booking…', 'info')

    // ─── Submit to server — server is source of truth for price + UPI ID ──────
    // SECURITY: We do NOT send an amount field. The server computes
    // expectedAmount = SERVER_PRICES[tier] * quantity using its own price map.
    // A user cannot tamper with the amount by editing the request.
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          passTier: tier,
          quantity: qty,
          utr: utr.trim(),
          // NOTE: no 'amount' field — server computes it itself
        }),
      })
      const j = await res.json()

      if (j.ok) {
        showStatus(
          `✅ Booking ${j.bookingId} • ${inr(j.expectedAmount)} locked. ${j.message}`,
          'success'
        )
        // Reset form
        setName(''); setPhone(''); setTier(''); setQty(1); setUtr('')
      } else {
        // Map server error codes to user-friendly messages
        const errorMap: Record<string, string> = {
          'MISSING_FIELDS': '⚠️ Please fill all fields.',
          'INVALID_NAME': '⚠️ Name must be letters only (2–15 chars).',
          'INVALID_PHONE': '⚠️ Invalid WhatsApp number.',
          'INVALID_TIER': '⚠️ Select a valid pass tier.',
          'INVALID_QUANTITY': '⚠️ Quantity must be 1–10.',
          'INVALID_UTR': '⚠️ UTR must be exactly 12 digits.',
          'UTR_ALREADY_USED': '🚫 This UTR was already used. If this is a mistake, contact us on WhatsApp.',
          'PRICE_COMPUTE_FAILED': '⚠️ Could not compute price. Try again.',
          'SERVER_ERROR': '⚠️ Server error. Please retry or contact us.',
          'SHEETS_NOT_CONFIGURED': '⚠️ Booking backend not configured. Contact us.',
          'INVALID_JSON': '⚠️ Invalid request. Please retry.',
        }
        showStatus(errorMap[j.error] || `⚠️ ${j.error}`, 'error')
      }
    } catch (err) {
      showStatus('⚠️ Network error. Check your connection and retry.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const statusBg: Record<StatusKind, string> = {
    error: '#FF422E',
    success: '#7CE8C8',
    info: '#FBF8F3',
  }
  const statusFg: Record<StatusKind, string> = {
    error: '#fff',
    success: '#121212',
    info: '#121212',
  }

  return (
    <div className="bg-pattern" style={{
      width: '100vw',
      /* Desktop: lock to 100vh with no scroll.
         Mobile: minHeight 100vh so short pages fill screen,
                 but content can grow taller and body scrolls naturally. */
      height: isDesktop ? '100vh' : 'auto',
      minHeight: '100vh',
      overflow: isDesktop ? 'hidden' : 'visible',
      color: '#FFFBEA', position: 'relative',
    }}>
      <style>{globalCss}</style>

      {/* Floating decorative shapes in background (hidden on mobile) */}
      {isDesktop && (
        <>
          <div className="float-shape" style={{
            position: 'absolute', top: '15%', right: '8%', fontSize: '28px', zIndex: 0,
            color: '#FF7145', animationDelay: '0s', opacity: 0.7,
          }}>✦</div>
          <div className="float-shape" style={{
            position: 'absolute', bottom: '20%', left: '32%', fontSize: '22px', zIndex: 0,
            color: '#75FF9C', animationDelay: '1.5s', opacity: 0.6,
          }}>★</div>
          <div className="float-shape" style={{
            position: 'absolute', top: '60%', right: '42%', fontSize: '18px', zIndex: 0,
            color: '#FF7575', animationDelay: '3s', opacity: 0.6,
          }}>✦</div>
          <div className="float-shape" style={{
            position: 'absolute', bottom: '10%', right: '15%', fontSize: '24px', zIndex: 0,
            color: '#FFFBEA', animationDelay: '2s', opacity: 0.5,
          }}>★</div>
        </>
      )}

      {/* ═══ TOP BAR (tonemaki-style: dark with cream pills) ═══
          Inner padding matches main's 16px so navbar edges align with poster/cards.
          Brand tag + nav buttons adapt to viewport: full text on desktop,
          compact on mobile. */}
      <header style={{
        borderBottom: '1px solid rgba(255, 251, 234, 0.12)',
        background: 'rgba(20, 20, 20, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px',
        padding: '0 16px', height: '56px',
        position: 'sticky', top: 0, zIndex: 40,
      }}>
        <a href="/" style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: isTablet ? '11px' : '9px',
          fontWeight: 700, letterSpacing: '0.5px',
          textDecoration: 'none', color: '#FFFBEA',
          background: 'rgba(255, 251, 234, 0.08)',
          padding: '6px 12px', borderRadius: '999px',
          border: '1px solid rgba(255, 251, 234, 0.15)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          flexShrink: 1, minWidth: 0,
        }}>
          {isTablet ? '[ CSN SIGNATURE — Chh. Sambhajinagar ® ]' : '[ CSN SIGNATURE ® ]'}
        </a>
        <nav style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <a href="/" style={{ ...navBtnStyle('#FFFBEA'), color: '#141414', padding: isTablet ? '6px 12px' : '6px 10px', fontSize: isTablet ? '10px' : '9px' }}>
            {isTablet ? 'Upcoming' : 'Home'}
          </a>
          <a href="https://www.instagram.com/csnsignaturevents/" target="_blank" rel="noopener noreferrer" style={{ ...navBtnStyle('#75FF9C'), color: '#141414', padding: isTablet ? '6px 12px' : '6px 10px', fontSize: isTablet ? '10px' : '9px' }}>
            {isTablet ? 'Completed ↗' : 'Past ↗'}
          </a>
          <a href="#booking" style={{ ...navBtnStyle('#FF7145'), color: '#141414', padding: isTablet ? '6px 12px' : '6px 10px', fontSize: isTablet ? '10px' : '9px' }}>
            {isTablet ? 'Book ★' : 'Book ★'}
          </a>
        </nav>
      </header>

      {/* ═══ MAIN GRID ═══
          Desktop (≥1024px): 2-col layout, poster left + form right
          Mobile/Tablet (<1024px): single column, natural vertical scroll,
                                    poster gets fixed aspect ratio so it's fully visible */}
      <main style={{
        display: 'grid',
        gridTemplateColumns: isDesktop ? '3fr 9fr' : '1fr',
        gap: '12px',
        padding: '16px',
        height: isDesktop ? 'calc(100vh - 56px)' : 'auto',
        minHeight: isDesktop ? undefined : 'calc(100vh - 56px)',
        overflow: isDesktop ? 'hidden' : 'visible',
      }}>
        {/* ═══ LEFT: POSTER CAROUSEL (real flyers) ═══ */}
        <section style={{
          display: 'flex', flexDirection: 'column', gap: '8px',
          minHeight: 0,
          /* Desktop: cap poster height to viewport, center vertically.
             Mobile: natural flow, aspect-ratio handles sizing. */
          justifyContent: isDesktop ? 'center' : undefined,
          height: isDesktop ? undefined : 'auto',
        }}>
          <div style={{
            position: 'relative',
            /* Use the poster's natural 4:5 portrait ratio on ALL viewports
               so the image is never cropped (always fully visible). */
            aspectRatio: '4 / 5',
            width: '100%',
            /* Desktop: cap height so the 4:5 poster fits in the viewport
               without forcing the page to scroll. */
            maxHeight: isDesktop ? 'calc(100vh - 88px)' : undefined,
            /* Center horizontally inside the narrow left column. */
            margin: '0 auto',
          }}>
            {/* Layer 1 — mint offset frame (behind, tonemaki-style) */}
            <div style={{
              position: 'absolute', inset: 0,
              border: '1px solid rgba(117, 255, 156, 0.6)',
              background: '#75FF9C',
              borderRadius: '24px',
              transform: 'translate(8px, 8px)',
              zIndex: 0,
            }} />
            {/* Layer 2 — orange offset frame (middle) */}
            <div style={{
              position: 'absolute', inset: 0,
              border: '1px solid rgba(255, 113, 69, 0.6)',
              background: '#FF7145',
              borderRadius: '24px',
              transform: 'translate(4px, 4px)',
              zIndex: 1,
            }} />
            {/* Layer 3 — main poster carousel (front, cream with soft shadow) */}
            <div style={{
              position: 'relative', height: '100%', minHeight: 0,
              border: '1px solid rgba(255, 251, 234, 0.2)',
              borderRadius: '24px',
              boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.5)',
              background: '#FFFBEA',
              overflow: 'hidden',
              zIndex: 2,
            }}>
              {/* Slides — contain (never crop) so the full flyer is always visible */}
              {POSTERS.map((p, i) => (
                <img
                  key={i}
                  src={p.src}
                  alt={p.alt}
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'contain',
                    opacity: i === posterIdx ? 1 : 0,
                    transition: 'opacity 0.5s ease',
                    zIndex: i === posterIdx ? 2 : 1,
                  }}
                />
              ))}

              {/* Prev / Next buttons (tonemaki pill style) */}
              <button
                type="button"
                onClick={prevPoster}
                aria-label="Previous poster"
                style={{
                  position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                  zIndex: 10, width: '36px', height: '36px',
                  border: '1px solid rgba(255, 251, 234, 0.3)',
                  borderRadius: '999px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  background: 'rgba(20, 20, 20, 0.85)',
                  backdropFilter: 'blur(8px)',
                  color: '#FFFBEA',
                  fontFamily: '"Anton", sans-serif', fontSize: '20px', lineHeight: 1,
                  cursor: 'pointer', padding: 0,
                }}
              >‹</button>
              <button
                type="button"
                onClick={nextPoster}
                aria-label="Next poster"
                style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  zIndex: 10, width: '36px', height: '36px',
                  border: '1px solid rgba(255, 251, 234, 0.3)',
                  borderRadius: '999px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  background: 'rgba(20, 20, 20, 0.85)',
                  backdropFilter: 'blur(8px)',
                  color: '#FFFBEA',
                  fontFamily: '"Anton", sans-serif', fontSize: '20px', lineHeight: 1,
                  cursor: 'pointer', padding: 0,
                }}
              >›</button>

              {/* Dot indicators (tonemaki pill container) */}
              <div style={{
                position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
                zIndex: 10, display: 'flex', gap: '6px',
                padding: '6px 10px',
                background: 'rgba(20, 20, 20, 0.85)',
                backdropFilter: 'blur(8px)',
                borderRadius: '999px',
                border: '1px solid rgba(255, 251, 234, 0.15)',
              }}>
                {POSTERS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPosterIdx(i)}
                    aria-label={`Go to poster ${i + 1}`}
                    style={{
                      width: '8px', height: '8px', padding: 0,
                      border: 'none',
                      borderRadius: '999px',
                      background: i === posterIdx ? '#FF7145' : 'rgba(255, 251, 234, 0.4)',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease',
                    }}
                  />
                ))}
              </div>

              {/* Slide counter badge (cream pill on dark glass) */}
              <div style={{
                position: 'absolute', top: '12px', left: '12px',
                zIndex: 10,
                background: 'rgba(20, 20, 20, 0.85)',
                backdropFilter: 'blur(8px)',
                color: '#FFFBEA',
                padding: '4px 10px',
                borderRadius: '999px',
                border: '1px solid rgba(255, 251, 234, 0.15)',
                fontFamily: '"IBM Plex Mono", monospace', fontSize: '10px', fontWeight: 600,
              }}>
                {posterIdx + 1} / {POSTERS.length}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ RIGHT: EVENT DETAILS + BOOKING FORM (always open) ═══ */}
        <section style={{
          display: 'flex', flexDirection: 'column', gap: '12px',
          minHeight: 0,
          /* Desktop: scroll inside right column if content overflows.
             Mobile: let body scroll naturally, no inner scroll. */
          overflow: isDesktop ? 'auto' : 'visible',
        }}>
          {/* Event details card — cream with soft shadow + rounded (tonemaki) */}
          <div style={{
            border: '1px solid rgba(255, 251, 234, 0.15)',
            borderRadius: '24px',
            boxShadow: '0 16px 32px -8px rgba(0, 0, 0, 0.4)',
            background: 'linear-gradient(135deg, #FFFBEA 0%, #FFF4E0 100%)',
            padding: '20px 24px',
            color: '#141414',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="font-display" style={{ fontSize: '26px', textTransform: 'uppercase', lineHeight: 1.05, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#141414' }}>
                  {EVENT.title}
                </h2>
                <div style={{ fontSize: '13px', color: '#575757', marginTop: '6px', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {EVENT.description}
                </div>
              </div>
              <div
                className="pulse-glow-red"
                style={{
                  textAlign: 'center', padding: '10px 16px',
                  border: '1px solid #FF7145',
                  borderRadius: '16px',
                  background: '#FF7145', color: '#141414', flexShrink: 0,
                  fontFamily: '"Anton", sans-serif',
                }}
              >
                <div className="font-display" style={{ fontSize: '32px', lineHeight: 0.95 }}>
                  {String(eventDate.getDate()).padStart(2, '0')}
                </div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '11px', marginTop: '2px', fontWeight: 600 }}>
                  {MONTHS[eventDate.getMonth()]}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
              <div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '10px', color: '#888', letterSpacing: '0.5px' }}>WHEN</div>
                <div className="font-display" style={{ fontSize: '18px', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                  {EVENT.time}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '10px', color: '#888', letterSpacing: '0.5px' }}>WHERE</div>
                <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.3, marginTop: '2px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {EVENT.venue}
                </div>
              </div>
            </div>
            <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <a href={`tel:+91${EVENT.phone1}`} style={{ ...phonePillStyle, fontSize: '11px', padding: '4px 10px' }}>{EVENT.phone1}</a>
            </div>
          </div>

          {/* Booking form — tonemaki-style orange panel + cream inner card */}
          <div id="booking" style={{
            border: '1px solid #FF7145',
            borderRadius: '24px',
            boxShadow: '0 16px 32px -8px rgba(255, 113, 69, 0.35)',
            padding: '20px 24px',
            background: 'linear-gradient(135deg, #FF7145 0%, #FF9269 100%)',
            color: '#141414',
            flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          }}>
            <div className="font-display" style={{ fontSize: '22px', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px', color: '#141414' }}>
              BOOK YOUR PASS
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #FFFBEA 0%, #FFF9F0 100%)',
              border: '1px solid rgba(20, 20, 20, 0.08)',
              borderRadius: '16px',
              padding: '18px',
              display: 'flex', flexDirection: 'column', gap: '14px',
              overflow: isDesktop ? 'auto' : 'visible',
              flex: isDesktop ? 1 : undefined,
              minHeight: 0,
              color: '#141414',
            }}>
              {/* STEP 01 — Guest details */}
              <div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '11px', color: '#666', marginBottom: '6px', letterSpacing: '0.5px' }}>
                  [ 01 — YOUR DETAILS ]
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input
                    className="nb-input"
                    value={name}
                    onChange={e => setName(e.target.value.replace(/[^A-Za-z\s]/g, '').slice(0, 15))}
                    type="text"
                    inputMode="text"
                    maxLength={15}
                    placeholder="Name * (max 15 letters)"
                    style={inputStyle}
                  />
                  <input
                    className="nb-input"
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="WhatsApp 10-digit *"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* STEP 02 — Tier + Qty (stepper buttons, no manual typing) */}
              <div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '11px', color: '#666', marginBottom: '6px', letterSpacing: '0.5px' }}>
                  [ 02 — TIER & QUANTITY ]
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center' }}>
                  <select className="nb-input" value={tier} onChange={e => setTier(e.target.value)} style={inputStyle}>
                    <option value="" disabled>— select tier —</option>
                    <option value="Female Pass">Female — ₹999</option>
                    <option value="Male Pass">Male — ₹2,499</option>
                    <option value="Couple Pass">Couple — ₹2,999</option>
                    <option value="Standing Table">Standing — ₹20,000</option>
                    <option value="Seating Table">Seating — ₹30,000</option>
                  </select>
                  {/* Quantity stepper — rounded pill with +/- buttons */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    border: '1px solid #DAD6C8',
                    background: '#FFFBEA',
                    borderRadius: '999px',
                    padding: '4px 6px',
                  }}>
                    <button
                      type="button"
                      onClick={decQty}
                      disabled={qty <= 1}
                      aria-label="Decrease quantity"
                      style={{
                        width: '34px', height: '34px',
                        border: 'none',
                        borderRadius: '999px',
                        background: qty <= 1 ? '#DAD6C8' : '#141414',
                        color: '#FFFBEA',
                        fontFamily: '"Anton", sans-serif', fontSize: '20px',
                        cursor: qty <= 1 ? 'not-allowed' : 'pointer',
                        padding: 0, lineHeight: 1,
                        transition: 'background 0.15s ease',
                      }}
                    >−</button>
                    <span className="font-display" style={{ fontSize: '22px', minWidth: '28px', textAlign: 'center', color: '#141414' }}>
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={incQty}
                      disabled={qty >= 10}
                      aria-label="Increase quantity"
                      style={{
                        width: '34px', height: '34px',
                        border: 'none',
                        borderRadius: '999px',
                        background: qty >= 10 ? '#DAD6C8' : '#75FF9C',
                        color: '#141414',
                        fontFamily: '"Anton", sans-serif', fontSize: '20px',
                        cursor: qty >= 10 ? 'not-allowed' : 'pointer',
                        padding: 0, lineHeight: 1,
                        transition: 'background 0.15s ease',
                      }}
                    >+</button>
                  </div>
                </div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '9px', color: '#888', marginTop: '4px' }}>
                  [ min 1 • max 10 — use + / − buttons ]
                </div>
              </div>

              {/* STEP 03 — PAY via UPI (no QR, no visible link)
                  SECURITY:
                  - No QR code (removed — was a visible representation of the UPI link)
                  - No <a href> (link was visible in DOM href attribute)
                  - Button onClick constructs the upi:// URI at CLICK TIME inside JS,
                    so it never appears in the page source or DOM inspector
                  - The server still computes expectedAmount itself (see /api/book)
                  - Admin verifies the actual received amount matches expectedAmount
                    before approving the pass
              */}
              <div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '11px', color: '#666', marginBottom: '8px', letterSpacing: '0.5px' }}>
                  [ 03 — PAY VIA UPI ]
                </div>
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '10px',
                  padding: '14px',
                  border: '1px solid #DAD6C8',
                  borderRadius: '14px',
                  background: '#FFFBEA',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '11px', color: '#575757' }}>
                        AMOUNT TO PAY
                      </div>
                      <div className="font-display" style={{ fontSize: '32px', lineHeight: 1, color: '#141414', marginTop: '2px' }}>
                        {total > 0 ? inr(total) : '₹0'}
                      </div>
                    </div>
                    <div style={{
                      padding: '6px 12px',
                      borderRadius: '999px',
                      background: total > 0 ? '#75FF9C' : '#DAD6C8',
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: '10px', fontWeight: 700, color: '#141414',
                    }}>
                      {total > 0 ? '✓ READY' : 'SELECT TIER'}
                    </div>
                  </div>

                  {/* Pay button — onClick constructs the UPI URI at click time.
                      The URI is NEVER in the DOM's href attribute or page source. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (total === 0) return
                      // Construct the UPI deep link ONLY at click time.
                      // This prevents the link from being visible in the page source
                      // or inspectable via DOM inspector before the user clicks.
                      const uri = `upi://pay?pa=${EVENT.upiId}&pn=${encodeURIComponent(EVENT.upiPayeeName)}&am=${total}&cu=INR&tn=CSN-Pass
                      window.location.href = uri
                    }}
                    disabled={total === 0}
                    style={{
                      width: '100%',
                      padding: '14px 20px',
                      border: 'none',
                      borderRadius: '999px',
                      background: total === 0 ? '#DAD6C8' : 'linear-gradient(135deg, #75FF9C 0%, #5FE080 100%)',
                      color: '#141414',
                      fontFamily: '"Anton", sans-serif',
                      fontSize: '16px', letterSpacing: '0.5px', textTransform: 'uppercase',
                      cursor: total === 0 ? 'not-allowed' : 'pointer',
                      boxShadow: total === 0 ? 'none' : '0 8px 20px rgba(117, 255, 156, 0.4)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    ★ Pay {total > 0 ? inr(total) : ''} via UPI App →
                  </button>

                  {/* Desktop hint — on mobile the button opens UPI app directly.
                      On desktop it opens the default handler (which may not work). */}
                  {!isTablet && (
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: '10px',
                      background: 'rgba(255, 113, 69, 0.1)',
                      border: '1px solid rgba(255, 113, 69, 0.3)',
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: '10px', color: '#575757', lineHeight: 1.5,
                    }}>
                      📱 <strong>Tip:</strong> For fastest booking, open this page on your phone —
                      the Pay button opens your UPI app (GPay / PhonePe / Paytm) directly with the exact amount pre-filled.
                    </div>
                  )}

                  <div style={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: '10px', color: '#888', lineHeight: 1.5, textAlign: 'center',
                  }}>
                    After paying, copy the <strong>12-digit UTR / UPI Reference No.</strong> from your
                    payment confirmation screen and enter it below.
                  </div>
                </div>
              </div>

              {/* STEP 04 — UTR Reference Number */}
              <div>
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '11px', color: '#666', marginBottom: '6px', letterSpacing: '0.5px' }}>
                  [ 04 — UTR REFERENCE NUMBER ]
                </div>
                <input
                  className="nb-input"
                  value={utr}
                  onChange={e => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  type="text"
                  inputMode="numeric"
                  maxLength={12}
                  placeholder="Enter 12-digit UTR / UPI Reference No. *"
                  style={{ ...inputStyle, fontFamily: '"IBM Plex Mono", monospace', letterSpacing: '1px' }}
                />
                <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '9px', color: '#888', marginTop: '4px' }}>
                  [ Find UTR in your UPI app’s payment success screen — 12 digits only ]
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="font-display breathe"
                style={{
                  width: '100%', fontSize: '18px', textTransform: 'uppercase',
                  padding: '14px 20px',
                  border: 'none',
                  borderRadius: '999px',
                  boxShadow: '0 12px 24px -6px rgba(20, 20, 20, 0.5)',
                  background: 'linear-gradient(135deg, #141414 0%, #2a2a2a 100%)',
                  color: '#FFFBEA',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.5px',
                }}
              >
                {submitting ? 'SUBMITTING…' : '★ CONFIRM BOOKING'}
              </button>

              {statusHtml && (
                <div style={{
                  padding: '14px 16px',
                  border: '1px solid rgba(20, 20, 20, 0.15)',
                  borderRadius: '12px',
                  fontFamily: '"IBM Plex Mono", monospace', fontSize: '13px', lineHeight: 1.5,
                  background: statusBg[statusKind], color: statusFg[statusKind],
                }}>
                  {statusHtml}
                </div>
              )}

              <p style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: '10px', color: '#888', lineHeight: 1.4, margin: 0 }}>
                [ Non-refundable. Carry photo ID. Pass sent on WhatsApp after admin validates. ]
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

// ─── Shared styles (tonemaki-inspired: thin borders, soft shadows, rounded) ──
const navBtnStyle = (bg: string): React.CSSProperties => ({
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: '10px',
  fontWeight: 600,
  padding: '6px 12px',
  border: '1px solid #FFFBEA',
  borderRadius: '999px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
  background: bg,
  textDecoration: 'none',
  color: '#141414',
  display: 'inline-block',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
})

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  border: '1px solid #DAD6C8',
  borderRadius: '12px',
  background: '#FFFBEA',
  fontSize: '14px',
  fontFamily: '"Plus Jakarta Sans", sans-serif',
  color: '#141414',
  outline: 'none',
}

const phonePillStyle: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: '11px',
  fontWeight: 600,
  padding: '5px 12px',
  border: '1px solid #FF7145',
  borderRadius: '999px',
  boxShadow: '0 4px 12px rgba(255, 113, 69, 0.3)',
  background: '#FF7145',
  textDecoration: 'none',
  color: '#141414',
  display: 'inline-block',
}

// ─── Global CSS injected via <style> tag ─────────────────────────────────────
// Aesthetic: tonemaki-inspired — dark charcoal bg, cream cards, orange + mint
// accents, thin borders, soft shadows, large rounded corners.
const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }

  .font-display { font-family: 'Anton', sans-serif; letter-spacing: 0.5px; }

  /* ─── TONEMAKI PALETTE ───
     #141414 dark charcoal (root bg)
     #FFFBEA warm cream (card bg)
     #FF7145 vermilion orange (primary accent)
     #75FF9C neon mint (secondary accent)
     #FF7575 coral (tertiary accent)
     #DAD6C8 putty (subtle borders/text)
  */

  /* ─── Background: dark charcoal + soft warm blobs + dot pattern ─── */
  .bg-pattern {
    background-color: #141414;
    background-image:
      radial-gradient(circle at 15% 20%, rgba(255, 113, 69, 0.18) 0%, transparent 40%),
      radial-gradient(circle at 85% 15%, rgba(117, 255, 156, 0.14) 0%, transparent 40%),
      radial-gradient(circle at 75% 85%, rgba(255, 117, 117, 0.12) 0%, transparent 40%),
      radial-gradient(circle at 10% 80%, rgba(255, 251, 234, 0.06) 0%, transparent 35%),
      radial-gradient(circle, rgba(255, 251, 234, 0.04) 1px, transparent 1px);
    background-size: 100% 100%, 100% 100%, 100% 100%, 100% 100%, 20px 20px;
    color: #FFFBEA;
  }

  /* ─── Floating sticker badges on hero ─── */
  @keyframes float-badge {
    0%, 100% { transform: translateY(0) rotate(var(--tilt, -12deg)); }
    50%      { transform: translateY(-6px) rotate(var(--tilt, -12deg)); }
  }
  .float-badge { animation: float-badge 3s ease-in-out infinite; }

  /* ─── Soft pulse glow (orange + mint variants) ─── */
  @keyframes pulse-glow-red {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 113, 69, 0.55), 0 8px 24px rgba(255, 113, 69, 0.25); }
    50%      { box-shadow: 0 0 0 12px rgba(255, 113, 69, 0), 0 8px 24px rgba(255, 113, 69, 0.4); }
  }
  .pulse-glow-red { animation: pulse-glow-red 1.8s ease-out infinite; }

  @keyframes pulse-glow-amber {
    0%, 100% { box-shadow: 0 0 0 0 rgba(117, 255, 156, 0.55), 0 8px 24px rgba(117, 255, 156, 0.2); }
    50%      { box-shadow: 0 0 0 10px rgba(117, 255, 156, 0), 0 8px 24px rgba(117, 255, 156, 0.35); }
  }
  .pulse-glow-amber { animation: pulse-glow-amber 2s ease-out infinite; }

  /* ─── Breathe animation for submit button ─── */
  @keyframes breathe {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.015); }
  }
  .breathe { animation: breathe 2.4s ease-in-out infinite; }

  /* ─── Marquee strip ─── */
  @keyframes marquee {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .marquee-track {
    display: inline-flex;
    white-space: nowrap;
    animation: marquee 22s linear infinite;
  }

  /* ─── Floating decorative shapes in background ─── */
  @keyframes float-shape {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50%      { transform: translateY(-14px) rotate(8deg); }
  }
  .float-shape {
    animation: float-shape 6s ease-in-out infinite;
    pointer-events: none;
  }

  /* ─── Input focus glow (orange) ─── */
  .nb-input {
    transition: box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
    border: 1px solid #DAD6C8;
  }
  .nb-input:focus {
    border-color: #FF7145;
    box-shadow: 0 0 0 3px rgba(255, 113, 69, 0.25);
    transform: translate(-1px, -1px);
    outline: none;
  }

  /* ─── Tier card hover lift (unused now but kept for future) ─── */
`
