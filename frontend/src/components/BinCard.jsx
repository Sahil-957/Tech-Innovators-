import { memo, useEffect, useMemo, useRef, useState } from 'react'

function getLevelTone(level) {
  if (level > 80) {
    return {
      bar: 'from-red-500 via-red-400 to-orange-300',
      glow: 'shadow-red-500/30',
      badge: 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30',
    }
  }

  if (level >= 50) {
    return {
      bar: 'from-amber-400 via-yellow-300 to-lime-200',
      glow: 'shadow-yellow-500/25',
      badge: 'bg-yellow-500/15 text-yellow-100 ring-1 ring-yellow-400/30',
    }
  }

  return {
    bar: 'from-emerald-500 via-green-400 to-lime-300',
    glow: 'shadow-emerald-500/25',
    badge: 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/30',
  }
}

function BinCardComponent({ binKey, binName, level = 0, gas = 0, status }) {
  const [flash, setFlash] = useState(false)
  const wasFullRef = useRef(level > 80)

  useEffect(() => {
    const isFull = level > 80

    if (isFull && !wasFullRef.current) {
      setFlash(true)
      const timer = window.setTimeout(() => setFlash(false), 900)
      wasFullRef.current = isFull
      return () => window.clearTimeout(timer)
    }

    wasFullRef.current = isFull
    return undefined
  }, [level])

  const tone = useMemo(() => getLevelTone(level), [level])
  const gasStatus = gas >= 100 ? 'Gas detected' : gas >= 60 ? 'Watch gas' : 'Normal'

  return (
    <article
      className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl transition duration-500 hover:-translate-y-1 hover:border-white/20 hover:bg-white/10 ${
        flash ? 'animate-alert-pulse' : ''
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(168,85,247,0.12),_transparent_30%)] opacity-80" />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{binKey}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{binName}</h2>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone.badge}`}>{status}</span>
      </div>

      <div className="relative mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-slate-400">Fill Level</p>
          <p className="mt-2 text-3xl font-semibold text-white">{level}%</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-slate-400">Gas Level</p>
          <p className="mt-2 text-3xl font-semibold text-white">{gas}</p>
        </div>
      </div>

      <div className="relative mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-slate-300">Capacity usage</span>
          <span className="text-slate-500">{gasStatus}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${tone.bar} ${tone.glow} transition-[width] duration-700 ease-out`}
            style={{ width: `${Math.min(level, 100)}%` }}
          />
        </div>
      </div>
    </article>
  )
}

export const BinCard = memo(BinCardComponent)
