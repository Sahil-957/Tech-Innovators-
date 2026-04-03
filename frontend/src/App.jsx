import { useEffect, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const RECONNECT_DELAY = 3000
const MAX_HISTORY = 12
const TOAST_DURATION = 4000

function getWebSocketUrl() {
  const envUrl = import.meta.env.VITE_WS_URL?.trim()

  if (envUrl) {
    return envUrl
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.hostname}:8080`
  }

  return 'ws://localhost:8080'
}

const WS_URL = getWebSocketUrl()

function getLevelTheme(level) {
  if (level >= 80) {
    return {
      text: 'text-rose-700',
      bar: 'bg-rose-500',
      badge: 'bg-rose-100 text-rose-700',
      accent: '#f43f5e',
      soft: '#ffe4e6',
      label: 'Critical',
    }
  }

  if (level >= 70) {
    return {
      text: 'text-amber-700',
      bar: 'bg-amber-500',
      badge: 'bg-amber-100 text-amber-700',
      accent: '#f59e0b',
      soft: '#fef3c7',
      label: 'Warning',
    }
  }

  if (level >= 50) {
    return {
      text: 'text-yellow-700',
      bar: 'bg-yellow-500',
      badge: 'bg-yellow-100 text-yellow-700',
      accent: '#eab308',
      soft: '#fef9c3',
      label: 'Medium',
    }
  }

  return {
    text: 'text-emerald-700',
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700',
    accent: '#10b981',
    soft: '#d1fae5',
    label: 'Normal',
  }
}

function getToastTheme(type) {
  if (type === 'critical') {
    return 'border-rose-200 bg-rose-50 text-rose-900'
  }

  return 'border-amber-200 bg-amber-50 text-amber-900'
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function BinCard({ title, level, gas, onFocus }) {
  const safeLevel = Math.max(0, Math.min(Number(level) || 0, 100))
  const safeGas = Number(gas) || 0
  const theme = getLevelTheme(safeLevel)

  return (
    <button
      type="button"
      onClick={onFocus}
      className="group rounded-[2rem] border border-slate-200 bg-white p-6 text-left shadow-lg shadow-slate-200/60 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-300/50"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-700">{title}</p>
          <h2 className="mt-3 text-4xl font-bold text-slate-900">{safeLevel}%</h2>
          <p className="mt-1 text-sm text-slate-500">Current fill level</p>
        </div>

        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${theme.badge}`}>
          {theme.label}
        </span>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between text-sm text-slate-500">
          <span>Capacity</span>
          <span>{safeLevel}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${theme.bar}`}
            style={{ width: `${safeLevel}%` }}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Gas Value</p>
          <p className={`mt-1 text-2xl font-semibold ${theme.text}`}>{safeGas}</p>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Action</p>
          <p className="mt-1 text-base font-semibold text-slate-800 group-hover:text-sky-700">
            View live trend
          </p>
        </div>
      </div>
    </button>
  )
}

function ToastStack({ toasts, onClose }) {
  return (
    <div className="fixed right-4 top-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-2xl border p-4 shadow-lg shadow-slate-300/40 ${getToastTheme(toast.type)}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{toast.title}</p>
              <p className="mt-1 text-sm opacity-80">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => onClose(toast.id)}
              className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-white/60"
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [bin1Level, setBin1Level] = useState(0)
  const [bin1Gas, setBin1Gas] = useState(0)
  const [bin2Level, setBin2Level] = useState(0)
  const [bin2Gas, setBin2Gas] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const [history, setHistory] = useState([])
  const [toasts, setToasts] = useState([])
  const [selectedBin, setSelectedBin] = useState('bin1')

  const socketRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const previousLevelsRef = useRef({ bin1: 0, bin2: 0 })

  useEffect(() => {
    let isMounted = true

    const connectWebSocket = () => {
      const socket = new WebSocket(WS_URL)
      socketRef.current = socket

      socket.onopen = () => {
        if (!isMounted) return
        console.log('WebSocket connected')
        setIsConnected(true)
      }

      socket.onmessage = (event) => {
        if (!isMounted) return

        try {
          const data = JSON.parse(event.data)
          console.log('Incoming WebSocket data:', data)

          const nextBin1Level = Number(data.bin1?.level ?? 0)
          const nextBin1Gas = Number(data.bin1?.gas ?? 0)
          const nextBin2Level = Number(data.bin2?.level ?? 0)
          const nextBin2Gas = Number(data.bin2?.gas ?? 0)
          const timestamp = new Date()

          setBin1Level(nextBin1Level)
          setBin1Gas(nextBin1Gas)
          setBin2Level(nextBin2Level)
          setBin2Gas(nextBin2Gas)

          setHistory((currentHistory) => {
            const nextPoint = {
              time: formatTime(timestamp),
              bin1Level: nextBin1Level,
              bin1Gas: nextBin1Gas,
              bin2Level: nextBin2Level,
              bin2Gas: nextBin2Gas,
            }

            return [...currentHistory, nextPoint].slice(-MAX_HISTORY)
          })
        } catch (error) {
          console.error('Failed to parse WebSocket data:', error)
        }
      }

      socket.onclose = () => {
        if (!isMounted) return
        console.log('WebSocket disconnected. Reconnecting...')
        setIsConnected(false)

        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket()
        }, RECONNECT_DELAY)
      }

      socket.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
    }

    connectWebSocket()

    return () => {
      isMounted = false
      setIsConnected(false)

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }

      if (socketRef.current) {
        socketRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    const bins = [
      { key: 'bin1', label: 'Bin 1', level: bin1Level },
      { key: 'bin2', label: 'Bin 2', level: bin2Level },
    ]

    bins.forEach((bin) => {
      const previousLevel = previousLevelsRef.current[bin.key] ?? 0

      if (bin.level >= 70 && previousLevel < 70) {
        const toastId = `${bin.key}-warning-${Date.now()}`
        setToasts((currentToasts) => [
          ...currentToasts,
          {
            id: toastId,
            type: 'warning',
            title: `${bin.label} is nearly full`,
            message: `Fill level reached ${bin.level}%. Schedule collection soon.`,
          },
        ])

        setTimeout(() => {
          setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId))
        }, TOAST_DURATION)
      }

      if (bin.level >= 80 && previousLevel < 80) {
        const toastId = `${bin.key}-critical-${Date.now()}`
        setToasts((currentToasts) => [
          ...currentToasts,
          {
            id: toastId,
            type: 'critical',
            title: `${bin.label} needs urgent pickup`,
            message: `Fill level is now ${bin.level}%. Please take action immediately.`,
          },
        ])

        setTimeout(() => {
          setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId))
        }, TOAST_DURATION)
      }

      previousLevelsRef.current[bin.key] = bin.level
    })
  }, [bin1Level, bin2Level])

  const comparisonData = [
    { name: 'Bin 1 Fill', value: bin1Level, color: getLevelTheme(bin1Level).accent },
    { name: 'Bin 2 Fill', value: bin2Level, color: getLevelTheme(bin2Level).accent },
    { name: 'Bin 1 Gas', value: bin1Gas, color: '#0f766e' },
    { name: 'Bin 2 Gas', value: bin2Gas, color: '#1d4ed8' },
  ]

  const trendData = history.map((point) => ({
    time: point.time,
    level: selectedBin === 'bin1' ? point.bin1Level : point.bin2Level,
    gas: selectedBin === 'bin1' ? point.bin1Gas : point.bin2Gas,
  }))

  const selectedBinLevel = selectedBin === 'bin1' ? bin1Level : bin2Level
  const selectedBinGas = selectedBin === 'bin1' ? bin1Gas : bin2Gas
  const selectedBinTheme = getLevelTheme(selectedBinLevel)

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#eff6ff,_#e2e8f0_55%,_#dbeafe)] px-4 py-8 text-slate-900">
      <ToastStack
        toasts={toasts}
        onClose={(toastId) => {
          setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId))
        }}
      />

      <div className="mx-auto max-w-7xl">
        <section className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-2xl shadow-slate-300/40 backdrop-blur md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-sky-700">
                Smart Waste Management
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
                Interactive Waste Dashboard
              </h1>
              <p className="mt-3 max-w-2xl text-slate-600">
                Watch live fill levels, compare gas values, and react faster with automatic alerts.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-100 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Connection</p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`h-3 w-3 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  />
                  <span className="text-sm font-semibold text-slate-800">
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-100 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Highest Fill</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {Math.max(bin1Level, bin2Level)}%
                </p>
              </div>

              <div className="rounded-2xl bg-slate-100 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Highest Gas</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {Math.max(bin1Gas, bin2Gas)}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-2">
          <BinCard title="Bin 1" level={bin1Level} gas={bin1Gas} onFocus={() => setSelectedBin('bin1')} />
          <BinCard title="Bin 2" level={bin2Level} gas={bin2Gas} onFocus={() => setSelectedBin('bin2')} />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-xl shadow-slate-300/30 backdrop-blur">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
                  Live Trend
                </p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">
                  {selectedBin === 'bin1' ? 'Bin 1' : 'Bin 2'} history
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Last {history.length || 0} updates
              </span>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="level"
                    stroke={selectedBinTheme.accent}
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="Fill Level"
                  />
                  <Line
                    type="monotone"
                    dataKey="gas"
                    stroke="#2563eb"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="Gas Value"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-xl shadow-slate-300/30 backdrop-blur">
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
                Comparison
              </p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Bin fill and gas overview</h2>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                    {comparisonData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
