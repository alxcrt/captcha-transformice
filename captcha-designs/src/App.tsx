import { useState, useEffect, useRef, useCallback } from 'react'
import './captcha.css'

type CaptchaState = 'idle' | 'verifying' | 'challenge' | 'success'

export default function App() {
  const [state, setState] = useState<CaptchaState>('idle')
  const [score, setScore] = useState(0)
  const [_flash, setFlash] = useState(false)
  const [prevScore, setPrevScore] = useState(0)
  const required = 3
  const ruffleLoaded = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)

  const [sessionId] = useState(() => crypto.randomUUID().slice(0, 8))
  const host = window.location.hostname
  const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const wsBase = (port: number) =>
    host === 'localhost'
      ? `${wsProto}://${host}:${port}`
      : `${wsProto}://proxy-tfm-captcha.alexcretu.com/ws/${port}`

  // ── WebSocket: listen for victory events ──
  useEffect(() => {
    let unmounted = false
    const connect = () => {
      if (unmounted) return
      const ws = new WebSocket(`${wsBase(8082)}?session=${sessionId}`)
      ws.onopen = () => { retryRef.current = 0 }
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'victory') setScore(prev => prev + 1)
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        if (unmounted) return
        const delay = Math.min(2000 * 2 ** retryRef.current, 30000)
        retryRef.current++
        setTimeout(connect, delay)
      }
      ws.onerror = () => ws.close()
      wsRef.current = ws
    }
    connect()
    return () => { unmounted = true; wsRef.current?.close() }
  }, [sessionId])

  // ── Load Ruffle ──
  useEffect(() => {
    if (ruffleLoaded.current) return
    ruffleLoaded.current = true
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/@ruffle-rs/ruffle'
    script.async = true
    script.onload = () => {
      if (!window.RufflePlayer) window.RufflePlayer = {}
      window.RufflePlayer.config = {
        autoplay: 'on', menu: false, quality: 'high',
        splashScreen: false, logLevel: 'warn',
        unmuteOverlay: 'hidden', allowNetworking: 'all',
        socketProxy: [
          { host: '127.0.0.1', port: 11801, proxyUrl: `${wsBase(11801)}?session=${sessionId}` },
          { host: '127.0.0.1', port: 12801, proxyUrl: `${wsBase(12801)}?session=${sessionId}` },
          { host: '127.0.0.1', port: 13801, proxyUrl: `${wsBase(13801)}?session=${sessionId}` },
          { host: '127.0.0.1', port: 14801, proxyUrl: `${wsBase(14801)}?session=${sessionId}` },
        ],
      }
    }
    document.body.appendChild(script)
  }, [])

  // ── Flash on score change ──
  useEffect(() => {
    if (score > prevScore && score > 0) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 600)
      setPrevScore(score)
      return () => clearTimeout(t)
    }
  }, [score, prevScore])

  // ── Auto-verify ──
  useEffect(() => {
    if (score >= required && state === 'challenge') {
      const t = setTimeout(() => setState('success'), 800)
      return () => clearTimeout(t)
    }
  }, [score, required, state])

  const handleCheckboxClick = useCallback(() => {
    if (state !== 'idle') return
    setState('verifying')
    setTimeout(() => setState('challenge'), 1200 + Math.random() * 800)
  }, [state])

  return (
    <div className="tfm-page">
      {/* ── Logo ── */}
      <div className="tfm-logo-wrap">
        <img src="/img/logo.png" alt="Transformice" className="tfm-logo" />
      </div>

      {/* ── Game area — visible during verifying/challenge only ── */}
      {(state === 'verifying' || state === 'challenge') && (
        <div className="tfm-game-container">
          {state === 'verifying' && (
            <div className="tfm-game-placeholder">
              <svg className="tfm-spinner-lg" viewBox="0 0 40 40">
                <circle className="tfm-spinner-circle" cx="20" cy="20" r="17" />
              </svg>
              <p className="tfm-game-placeholder-text">Loading...</p>
            </div>
          )}
          {state === 'challenge' && (
              <div className="tfm-game-viewport" ref={(el) => {
                if (el) {
                  // Auto-focus the Ruffle player so keyboard input works immediately
                  const timer = setInterval(() => {
                    const player = el.querySelector('ruffle-player, object, embed, canvas') as HTMLElement | null
                    if (player) {
                      player.focus()
                      clearInterval(timer)
                    }
                  }, 100)
                  setTimeout(() => clearInterval(timer), 10000)
                }
              }}>
                <object data="/assets/transformice-v4.swf" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <param name="movie" value="/assets/transformice-v4.swf" />
                  <param name="play" value="true" />
                  <param name="menu" value="false" />
                  <param name="quality" value="high" />
                  <param name="allowScriptAccess" value="always" />
                </object>
              </div>
          )}
        </div>
      )}

      {/* ── Captcha widget ── */}
      <div className="tfm-captcha-bar">
        <div className="tfm-captcha-left">
          <div
            className={`tfm-checkbox-holder${state !== 'idle' ? ' disabled' : ''}`}
            onClick={handleCheckboxClick}
          >
            <div className="tfm-checkbox">
              {state === 'idle' && <div className="tfm-checkbox-inner" />}
              {state === 'verifying' && (
                <svg className="tfm-spinner" viewBox="0 0 40 40">
                  <circle className="tfm-spinner-circle" cx="20" cy="20" r="17" />
                </svg>
              )}
              {state === 'challenge' && <div className="tfm-checkbox-inner disabled" />}
              {state === 'success' && (
                <svg className="tfm-checkmark" viewBox="0 0 28 28">
                  <path className="tfm-checkmark-path" d="M5 14.5 L11.5 21 L23 7" />
                </svg>
              )}
            </div>
            <span className="tfm-anchor-label">
              {state === 'success' ? 'Verified!' : "I'm not a robot"}
            </span>
          </div>
          {state === 'challenge' && (
            <span className="tfm-task-label">🧀 {score} / {required}</span>
          )}
        </div>
        <div className="tfm-captcha-right">
          <CheeseIcon size={28} />
          <span className="tfm-brand-text">Transformice</span>
          <span className="tfm-brand-links">
            <a href="#">Privacy</a>
            {' - '}
            <a href="#">Terms</a>
          </span>
        </div>
      </div>

      <p className="tfm-made-by">Made with ❤️ by <a href="https://alexcretu.com" target="_blank" rel="noopener noreferrer">Alex Cretu</a></p>

    </div>
  )
}

function CheeseIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M8 52 L32 8 L56 52 Z" fill="#f5c842" stroke="#d4a017" strokeWidth="2" strokeLinejoin="round" />
      <ellipse cx="28" cy="38" rx="5" ry="4" fill="#d4a017" opacity="0.6" />
      <ellipse cx="40" cy="44" rx="3.5" ry="3" fill="#d4a017" opacity="0.6" />
      <ellipse cx="34" cy="28" rx="3" ry="2.5" fill="#d4a017" opacity="0.6" />
      <path d="M16 48 L32 16 L36 18 L20 50 Z" fill="rgba(255,255,255,0.15)" />
    </svg>
  )
}

declare global {
  interface Window {
    RufflePlayer?: { config?: Record<string, unknown> }
  }
}
