'use client'
import { useState, useRef, useEffect } from 'react'

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [totp, setTotp] = useState('')
  const [authError, setAuthError] = useState('')
  const [status, setStatus] = useState<'scanning' | 'found' | 'checking' | 'done' | 'error'>('scanning')
  const [booking, setBooking] = useState<any>(null)
  const [error, setError] = useState('')
  const [scannedQr, setScannedQr] = useState('')

  // Check if session is still valid (24 hours)
  useEffect(() => {
    const session = localStorage.getItem('gateSession')
    if (session) {
      const expiry = parseInt(session, 10)
      if (Date.now() < expiry) {
        setUnlocked(true)
      } else {
        localStorage.removeItem('gateSession')
      }
    }
  }, [])

  async function verifyTotp() {
    setAuthError('')
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verifyTotp', token: totp }),
    })
    const data = await res.json()
    if (data.ok) {
      // Store session for 24 hours
      localStorage.setItem('gateSession', String(Date.now() + 86400000))
      setUnlocked(true)
    } else {
      setAuthError('Invalid code. Check Google Authenticator and try again.')
    }
  }

  useEffect(() => {
    if (!unlocked) return
    let stream: MediaStream
    let interval: NodeJS.Timeout

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      } catch (err) {
        setError('Camera access denied.')
        setStatus('error')
      }
    }

    async function scanFrame() {
      if (!videoRef.current || !canvasRef.current || videoRef.current.readyState !== 4) return
      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const jsQR = (await import('jsqr')).default
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
      if (code && code.data) {
        setScannedQr(code.data)
        setStatus('found')
        clearInterval(interval)
        const res = await fetch('/api/scan?qr=' + encodeURIComponent(code.data))
        const data = await res.json()
        if (data.ok) {
          setBooking(data.booking)
        } else {
          setError(data.error === 'NOT_FOUND' ? 'Booking not found' : data.error === 'INVALID_QR' ? 'Invalid QR code' : data.error)
          setStatus('error')
        }
      }
    }

    startCamera()
    interval = setInterval(scanFrame, 500)
    return () => {
      clearInterval(interval)
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
  }, [unlocked])

  async function handleCheckIn() {
    setStatus('checking')
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'checkin', qr: scannedQr }),
    })
    const data = await res.json()
    if (data.ok) {
      setStatus('done')
      setBooking({ ...booking, checkedIn: true, checkedInAt: data.checkedInAt })
    } else {
      setError(data.error === 'ALREADY_CHECKED_IN' ? 'Already checked in' : data.error)
      setStatus('error')
    }
  }

  function handleRescan() {
    setStatus('scanning')
    setBooking(null)
    setError('')
    setScannedQr('')
    window.location.reload()
  }

  if (!unlocked) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
        <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>CSN Gate Scanner</h1>
        <p style={{ opacity: 0.6, marginBottom: '20px', textAlign: 'center' }}>Enter the 6-digit code from Google Authenticator</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={totp}
          onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && totp.length === 6 && verifyTotp()}
          placeholder="000000"
          style={{ padding: '16px', fontSize: '32px', borderRadius: '8px', border: '2px solid #333', background: '#1a1a1a', color: '#fff', width: '180px', textAlign: 'center', letterSpacing: '8px' }}
        />
        {authError && <p style={{ color: '#FF6B6B', marginTop: '12px' }}>{authError}</p>}
        <button onClick={verifyTotp} disabled={totp.length !== 6} style={{ marginTop: '16px', padding: '14px 32px', fontSize: '18px', background: totp.length === 6 ? '#75FF9C' : '#333', color: totp.length === 6 ? '#0a0a0a' : '#666', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: totp.length === 6 ? 'pointer' : 'not-allowed' }}>
          Unlock Scanner
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px' }}>
      <h1 style={{ fontSize: '24px', margin: '20px 0' }}>🚪 CSN Gate Scanner</h1>

      {status === 'scanning' && (
        <>
          <video ref={videoRef} style={{ width: '100%', maxWidth: '400px', borderRadius: '12px' }} autoPlay playsInline muted />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <p style={{ marginTop: '20px', opacity: 0.6 }}>Point camera at the QR code...</p>
        </>
      )}

      {status === 'found' && booking && !booking.checkedIn && (
        <div style={{ width: '100%', maxWidth: '400px', background: '#1a1a1a', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
          <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>{booking.name}</h2>
          <p style={{ fontSize: '20px', opacity: 0.8, marginBottom: '4px' }}>{booking.passTier}</p>
          <p style={{ fontSize: '16px', opacity: 0.6, marginBottom: '4px' }}>Quantity: {booking.quantity}</p>
          <p style={{ fontSize: '16px', opacity: 0.6, marginBottom: '4px' }}>Phone: ****{booking.phoneLast4}</p>
          <p style={{ fontSize: '14px', color: '#75FF9C', marginBottom: '20px' }}>APPROVED · Not checked in</p>
          <button onClick={handleCheckIn} style={{ width: '100%', padding: '16px', fontSize: '20px', background: '#75FF9C', color: '#0a0a0a', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' }}>
            ✓ Check In
          </button>
        </div>
      )}

      {status === 'found' && booking && booking.checkedIn && (
        <div style={{ width: '100%', maxWidth: '400px', background: '#2a1a1a', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔴</div>
          <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>{booking.name}</h2>
          <p style={{ fontSize: '20px', opacity: 0.8 }}>{booking.passTier}</p>
          <p style={{ fontSize: '16px', color: '#FF6B6B', marginTop: '12px' }}>ALREADY CHECKED IN</p>
          <p style={{ fontSize: '14px', opacity: 0.5, marginTop: '4px' }}>{booking.checkedInAt}</p>
          <button onClick={handleRescan} style={{ width: '100%', padding: '12px', fontSize: '16px', background: '#333', color: '#fff', border: 'none', borderRadius: '8px', marginTop: '16px', cursor: 'pointer' }}>Scan Next</button>
        </div>
      )}

      {status === 'checking' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px' }}>⏳</div>
          <p>Checking in...</p>
        </div>
      )}

      {status === 'done' && (
        <div style={{ width: '100%', maxWidth: '400px', background: '#1a2a1a', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '12px' }}>🎉</div>
          <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>{booking?.name}</h2>
          <p style={{ fontSize: '20px', opacity: 0.8 }}>{booking?.passTier}</p>
          <p style={{ fontSize: '16px', color: '#75FF9C', marginTop: '16px' }}>✅ Checked In</p>
          <p style={{ fontSize: '14px', opacity: 0.5, marginTop: '4px' }}>{booking?.checkedInAt}</p>
          <button onClick={handleRescan} style={{ width: '100%', padding: '16px', fontSize: '20px', background: '#75FF9C', color: '#0a0a0a', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px' }}>
            Scan Next Guest →
          </button>
        </div>
      )}

      {status === 'error' && (
        <div style={{ width: '100%', maxWidth: '400px', background: '#2a1a1a', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>❌</div>
          <p style={{ fontSize: '20px', color: '#FF6B6B' }}>{error}</p>
          <button onClick={handleRescan} style={{ width: '100%', padding: '12px', fontSize: '16px', background: '#333', color: '#fff', border: 'none', borderRadius: '8px', marginTop: '16px', cursor: 'pointer' }}>Try Again</button>
        </div>
      )}
    </div>
  )
}
