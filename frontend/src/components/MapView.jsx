import { useEffect, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, Marker, Popup, Polyline, TileLayer } from 'react-leaflet'
import { COLLECTION_START_POINT, PUNE_CENTER, SIMULATED_BINS } from '../data/binLocations'

const ROUTING_SERVICE_URL = 'https://router.project-osrm.org/route/v1/driving'
const MAX_ROUTE_STOPS = 5

function getMarkerColor(level) {
  if (level > 80) {
    return '#ef4444'
  }

  if (level >= 50) {
    return '#facc15'
  }

  return '#22c55e'
}

function createBinIcon(color) {
  return L.divIcon({
    className: '',
    html: `
      <div style="position: relative; width: 26px; height: 38px; display: flex; align-items: flex-start; justify-content: center;">
        <div style="width: 26px; height: 26px; background: ${color}; border: 3px solid #ffffff; border-radius: 999px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.28);"></div>
        <div style="position: absolute; bottom: 0; width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-top: 14px solid ${color};"></div>
      </div>
    `,
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
  })
}

const BIN_ICONS = {
  green: createBinIcon('#22c55e'),
  yellow: createBinIcon('#facc15'),
  red: createBinIcon('#ef4444'),
  blue: createBinIcon('#2563eb'),
}

function getBinIcon(level) {
  if (level > 80) {
    return BIN_ICONS.red
  }

  if (level >= 50) {
    return BIN_ICONS.yellow
  }

  return BIN_ICONS.green
}

function normalizeBin(bin, type) {
  return {
    ...bin,
    fillLevel: Math.max(0, Math.min(Number(bin.fillLevel) || 0, 100)),
    gasValue: Number(bin.gasValue) || 0,
    type,
  }
}

function getStatusLabel(level) {
  if (level > 80) {
    return 'Critical'
  }

  if (level >= 50) {
    return 'Attention'
  }

  return 'Normal'
}

function getLevelStyles(level) {
  if (level > 80) {
    return {
      card: 'border-rose-200 bg-rose-50/80',
      hint: 'text-rose-600',
    }
  }

  if (level >= 50) {
    return {
      card: 'border-amber-200 bg-amber-50/80',
      hint: 'text-amber-600',
    }
  }

  return {
    card: 'border-emerald-200 bg-emerald-50/80',
    hint: 'text-emerald-600',
  }
}

export default function MapView({ liveBins = [], simulatedBins = SIMULATED_BINS, center = PUNE_CENTER, zoom = 15 }) {
  const [manualFillInputs, setManualFillInputs] = useState(() =>
    simulatedBins.reduce((accumulator, bin) => {
      accumulator[bin.id] = String(Number(bin.fillLevel) || 0)
      return accumulator
    }, {})
  )
  const [roadRoute, setRoadRoute] = useState([])
  const [routeError, setRouteError] = useState('')

  const editableSimulatedBins = simulatedBins.map((bin) => ({
    ...bin,
    fillLevel: manualFillInputs[bin.id] === '' ? 0 : Number(manualFillInputs[bin.id]) || 0,
  }))

  const bins = [
    ...liveBins.map((bin) => normalizeBin(bin, 'Live')),
    ...editableSimulatedBins.map((bin) => normalizeBin(bin, 'Simulated')),
  ]

  const prioritizedBins = [...bins]
    .filter((bin) => bin.fillLevel > 0)
    .sort((firstBin, secondBin) => secondBin.fillLevel - firstBin.fillLevel)
    .slice(0, MAX_ROUTE_STOPS)

  const routePositions = [
    [COLLECTION_START_POINT.latitude, COLLECTION_START_POINT.longitude],
    ...prioritizedBins.map((bin) => [bin.latitude, bin.longitude]),
  ]
  const routeSignature = routePositions.map(([latitude, longitude]) => `${latitude},${longitude}`).join('|')

  useEffect(() => {
    if (routePositions.length < 2) {
      setRoadRoute([])
      setRouteError('')
      return
    }

    const abortController = new AbortController()

    async function fetchRoadRoute() {
      try {
        setRouteError('')

        const coordinates = routePositions
          .map(([latitude, longitude]) => `${longitude},${latitude}`)
          .join(';')

        const response = await fetch(
          `${ROUTING_SERVICE_URL}/${coordinates}?overview=simplified&geometries=geojson&steps=false`,
          { signal: abortController.signal }
        )

        if (!response.ok) {
          throw new Error(`Routing request failed with ${response.status}`)
        }

        const data = await response.json()
        const geometry = data.routes?.[0]?.geometry?.coordinates

        if (!geometry?.length) {
          throw new Error('No routed geometry returned')
        }

        setRoadRoute(geometry.map(([longitude, latitude]) => [latitude, longitude]))
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }

        console.error('Failed to fetch road route:', error)
        setRoadRoute(routePositions)
        setRouteError('Showing straight-line fallback because road routing is unavailable.')
      }
    }

    fetchRoadRoute()

    return () => {
      abortController.abort()
    }
  }, [routeSignature])

  return (
    <div className="space-y-5">
      <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
              Manual Fill Control
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-900">
              Enter fill percentage for simulated bins
            </h3>
          </div>
          <p className="text-sm text-slate-600">
            Route starts from the collection hub and follows highest fill first.
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {editableSimulatedBins.map((bin) => {
            const level = manualFillInputs[bin.id] === '' ? 0 : Number(manualFillInputs[bin.id]) || 0
            const styles = getLevelStyles(level)

            return (
            <label
              key={bin.id}
              className={`rounded-2xl border p-4 shadow-sm transition-colors ${styles.card}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">{bin.id}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {level}%
                </span>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={manualFillInputs[bin.id] ?? ''}
                onChange={(event) => {
                  const rawValue = event.target.value.replace(/\D/g, '').slice(0, 3)

                  setManualFillInputs((currentLevels) => ({
                    ...currentLevels,
                    [bin.id]: rawValue,
                  }))
                }}
                onFocus={(event) => {
                  if (event.target.value === '0') {
                    setManualFillInputs((currentLevels) => ({
                      ...currentLevels,
                      [bin.id]: '',
                    }))
                  }
                }}
                onBlur={() => {
                  const normalizedValue = Math.max(
                    0,
                    Math.min(Number(manualFillInputs[bin.id] || 0), 100)
                  )

                  setManualFillInputs((currentLevels) => ({
                    ...currentLevels,
                    [bin.id]: String(normalizedValue),
                  }))
                }}
                placeholder="0"
                className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400"
              />
              <p className={`mt-2 text-xs ${styles.hint}`}>Enter a value between 0 and 100.</p>
            </label>
            )
          })}
        </div>
      </div>

      {routeError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {routeError}
        </div>
      )}

      <div className="h-[500px] w-full overflow-hidden rounded-[24px] border border-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
        <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <Marker
            position={[COLLECTION_START_POINT.latitude, COLLECTION_START_POINT.longitude]}
            icon={BIN_ICONS.blue}
          >
            <Popup>
              <div className="min-w-[180px] text-slate-900">
                <div className="text-base font-bold">{COLLECTION_START_POINT.id}</div>
                <div className="mt-2 text-sm">Route starting point for collection vehicles.</div>
              </div>
            </Popup>
          </Marker>

          {bins.map((bin) => (
            <Marker
              key={bin.id}
              position={[bin.latitude, bin.longitude]}
              icon={getBinIcon(bin.fillLevel)}
            >
              <Popup>
                <div className="min-w-[180px] text-slate-900">
                  <div className="text-base font-bold">{bin.id}</div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div>Type: {bin.type}</div>
                    <div>Status: {getStatusLabel(bin.fillLevel)}</div>
                    <div>Fill Level: {bin.fillLevel}%</div>
                    <div>Gas Level: {bin.gasValue}</div>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {roadRoute.length > 1 && (
            <Polyline
              positions={roadRoute}
              pathOptions={{ color: '#dc2626', weight: 5, opacity: 0.9, smoothFactor: 2 }}
            />
          )}
        </MapContainer>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
          Route Priority
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
            Start: {COLLECTION_START_POINT.id}
          </span>
          {prioritizedBins.map((bin, index) => (
            <span
              key={bin.id}
              className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700"
            >
              {index + 1}. {bin.id} ({bin.fillLevel}%)
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
