import { memo } from 'react'

function AlertPanelComponent({ alerts }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Alerts</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">System events</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          {alerts.length} active
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            All bins are operating within safe limits.
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-2xl border p-4 transition ${
                alert.critical
                  ? 'border-red-400/30 bg-red-500/10 text-red-50'
                  : 'border-yellow-400/20 bg-yellow-500/10 text-yellow-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{alert.title}</p>
                  <p className="mt-1 text-sm opacity-80">{alert.message}</p>
                </div>
                <span className="rounded-full bg-black/20 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em]">
                  {alert.critical ? 'Critical' : 'Warning'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export const AlertPanel = memo(AlertPanelComponent)
