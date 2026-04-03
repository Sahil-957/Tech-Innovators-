import { useEffect, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, Marker, Popup, Polyline, TileLayer, useMapEvents } from 'react-leaflet'
import { COLLECTION_START_POINT, PUNE_CENTER, SIMULATED_BINS } from '../data/binLocations'

const ROUTING_SERVICE_URL = 'https://router.project-osrm.org/route/v1/driving'
const MAX_ROUTE_STOPS = 5
const MIN_FILL_FOR_ROUTE = 50

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

function createRouteStopIcon(index, color) {
  return L.divIcon({
    className: '',
    html: `
      <div style="width: 30px; height: 30px; border-radius: 999px; background: ${color}; color: #ffffff; border: 3px solid #ffffff; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.28); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;">
        ${index}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
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

function getDistanceInKm(fromPoint, toPoint) {
  const earthRadiusKm = 6371
  const latitudeDelta = ((toPoint.latitude - fromPoint.latitude) * Math.PI) / 180
  const longitudeDelta = ((toPoint.longitude - fromPoint.longitude) * Math.PI) / 180
  const fromLatitude = (fromPoint.latitude * Math.PI) / 180
  const toLatitude = (toPoint.latitude * Math.PI) / 180

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2)

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getIntelligentRouteOrder(bins, startPoint) {
  const remainingBins = bins
    .filter((bin) => bin.fillLevel >= MIN_FILL_FOR_ROUTE)
    .map((bin) => ({ ...bin }))
  const selectedBins = []
  let currentPoint = startPoint

  while (remainingBins.length > 0 && selectedBins.length < MAX_ROUTE_STOPS) {
    const nextBinIndex = remainingBins.reduce((bestIndex, candidateBin, candidateIndex, allBins) => {
      const candidateDistance = getDistanceInKm(currentPoint, candidateBin)
      const candidateScore = candidateBin.fillLevel * 1.4 - candidateDistance * 12

      if (bestIndex === -1) {
        return candidateIndex
      }

      const bestBin = allBins[bestIndex]
      const bestDistance = getDistanceInKm(currentPoint, bestBin)
      const bestScore = bestBin.fillLevel * 1.4 - bestDistance * 12

      return candidateScore > bestScore ? candidateIndex : bestIndex
    }, -1)

    const [nextBin] = remainingBins.splice(nextBinIndex, 1)
    selectedBins.push(nextBin)
    currentPoint = nextBin
  }

  return selectedBins
}

function HubSelector({ isPickingHub, onSelectHub }) {
  useMapEvents({
    click(event) {
      if (!isPickingHub) {
        return
      }

      onSelectHub({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      })
    },
  })

  return null
}

export default function MapView({ liveBins = [], simulatedBins = SIMULATED_BINS, center = PUNE_CENTER, zoom = 15 }) {
  const [manualFillInputs, setManualFillInputs] = useState(() =>
    simulatedBins.reduce((accumulator, bin) => {
      accumulator[bin.id] = String(Number(bin.fillLevel) || 0)
      return accumulator
    }, {})
  )
  const [roadRoute, setRoadRoute] = useState([])
  const [routeLegs, setRouteLegs] = useState([])
  const [routeError, setRouteError] = useState('')
  const [hubPoint, setHubPoint] = useState(COLLECTION_START_POINT)
  const [isPickingHub, setIsPickingHub] = useState(false)

  const editableSimulatedBins = simulatedBins.map((bin) => ({
    ...bin,
    fillLevel: manualFillInputs[bin.id] === '' ? 0 : Number(manualFillInputs[bin.id]) || 0,
  }))

  const bins = [
    ...liveBins.map((bin) => normalizeBin(bin, 'Live')),
    ...editableSimulatedBins.map((bin) => normalizeBin(bin, 'Simulated')),
  ]

  const prioritizedBins = getIntelligentRouteOrder(bins, hubPoint)

  const routePositions = [
    [hubPoint.latitude, hubPoint.longitude],
    ...prioritizedBins.map((bin) => [bin.latitude, bin.longitude]),
  ]
  const routeSignature = routePositions.map(([latitude, longitude]) => `${latitude},${longitude}`).join('|')

  useEffect(() => {
    if (routePositions.length < 2) {
      setRoadRoute([])
      setRouteLegs([])
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
        const legs = data.routes?.[0]?.legs ?? []

        if (!geometry?.length) {
          throw new Error('No routed geometry returned')
        }

        setRoadRoute(geometry.map(([longitude, latitude]) => [latitude, longitude]))
        setRouteLegs(legs)
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }

        console.error('Failed to fetch road route:', error)
        setRoadRoute(routePositions)
        setRouteLegs([])
        setRouteError('Showing straight-line fallback because road routing is unavailable.')
      }
    }

    fetchRoadRoute()

    return () => {
      abortController.abort()
    }
  }, [routeSignature])

  const routeBinsById = Object.fromEntries(prioritizedBins.map((bin, index) => [bin.id, index + 1]))
  const directions = prioritizedBins.map((bin, index) => {
    const previousLabel = index === 0 ? hubPoint.id : prioritizedBins[index - 1].id
    const leg = routeLegs[index]
    const distanceKm = leg?.distance ? (leg.distance / 1000).toFixed(1) : null
    const durationMin = leg?.duration ? Math.round(leg.duration / 60) : null

    return {
      id: bin.id,
      order: index + 1,
      from: previousLabel,
      to: bin.id,
      fillLevel: bin.fillLevel,
      distanceKm,
      durationMin,
    }
  })

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

        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Collection hub</p>
            <p className="mt-1 text-sm text-slate-600">
              Lat {hubPoint.latitude.toFixed(4)}, Lng {hubPoint.longitude.toFixed(4)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsPickingHub((currentValue) => !currentValue)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                isPickingHub
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {isPickingHub ? 'Click Map To Set Hub' : 'Change Hub On Map'}
            </button>
            <button
              type="button"
              onClick={() => {
                setHubPoint(COLLECTION_START_POINT)
                setIsPickingHub(false)
              }}
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              Reset Hub
            </button>
          </div>
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
          <HubSelector
            isPickingHub={isPickingHub}
            onSelectHub={({ latitude, longitude }) => {
              setHubPoint({
                ...hubPoint,
                latitude,
                longitude,
              })
              setIsPickingHub(false)
            }}
          />
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <Marker
            position={[hubPoint.latitude, hubPoint.longitude]}
            icon={BIN_ICONS.blue}
          >
            <Popup>
              <div className="min-w-[180px] text-slate-900">
                <div className="text-base font-bold">{hubPoint.id}</div>
                <div className="mt-2 text-sm">Route starting point for collection vehicles.</div>
              </div>
            </Popup>
          </Marker>

          {bins.map((bin) => (
            <Marker
              key={bin.id}
              position={[bin.latitude, bin.longitude]}
              icon={
                routeBinsById[bin.id]
                  ? createRouteStopIcon(routeBinsById[bin.id], getMarkerColor(bin.fillLevel))
                  : getBinIcon(bin.fillLevel)
              }
            >
              <Popup>
                <div className="min-w-[180px] text-slate-900">
                  <div className="text-base font-bold">{bin.id}</div>
                  <div className="mt-2 space-y-1 text-sm">
                    {routeBinsById[bin.id] && <div>Route Stop: {routeBinsById[bin.id]}</div>}
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
            <>
              <Polyline
                positions={roadRoute}
                pathOptions={{ color: '#ffffff', weight: 10, opacity: 0.85, smoothFactor: 2 }}
              />
              <Polyline
                positions={roadRoute}
                pathOptions={{ color: '#dc2626', weight: 5, opacity: 0.95, smoothFactor: 2 }}
              />
            </>
          )}
        </MapContainer>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
          Route Priority
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
            Start: {hubPoint.id}
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

        {directions.length > 0 && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {directions.map((direction) => (
              <div
                key={direction.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                <p className="font-semibold text-slate-900">
                  {direction.order}. {direction.from} to {direction.to}
                </p>
                <p className="mt-1">
                  Fill priority: {direction.fillLevel}%
                  {direction.distanceKm && ` | Distance: ${direction.distanceKm} km`}
                  {direction.durationMin !== null && ` | ETA: ${direction.durationMin} min`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
