'use client'

import { useRef, useState, useMemo, useEffect } from 'react'
import { Map, Source, Layer, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTheme } from 'next-themes'
import { RotateCcw } from 'lucide-react'
import type { CountryPriceQuote } from '@/lib/types'
import { COUNTRY_MAP } from '@/lib/types'

// OpenFreeMap public styles — no API key, no quota, no cookies.
// Positron = minimalist light (very "Apple/Stripe"); dark = soft dark.
const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'

// Color scale (kept identical to the previous SVG version so the visual
// identity is preserved): green → yellow → red.
function getColor(eur: number, min: number, max: number): string {
  if (max === min) return '#22c55e'
  const ratio = (eur - min) / (max - min)
  if (ratio < 0.5) {
    const r = ratio * 2
    return `rgb(${Math.round(r * 255)},217,${Math.round((0.37 - r * 0.37) * 255)})`
  }
  const g = 0.85 - (ratio - 0.5) * 2 * 0.85
  return `rgb(255,${Math.round(g * 255)},0)`
}

// Compute [[minLng, minLat], [maxLng, maxLat]] for a set of features.
// Used to auto-fit the map on the countries with a valid price.
function computeBBox(
  features: GeoJSON.Feature[]
): [[number, number], [number, number]] | null {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90
  let found = false
  const visit = (coords: unknown) => {
    if (!Array.isArray(coords) || coords.length === 0) return
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords as number[]
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      found = true
    } else {
      for (const c of coords as unknown[]) visit(c)
    }
  }
  for (const f of features) {
    if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
      visit(f.geometry.coordinates as unknown)
    }
  }
  if (!found) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

const eurFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const eurCompactFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
})

interface PriceMapProps {
  quotes: CountryPriceQuote[]
  fxRates: Record<string, number>
}

interface HoverState {
  country: string
}

const INITIAL_VIEW = {
  longitude: 12,
  latitude: 50,
  zoom: 3.4,
  bearing: 0,
  pitch: 0,
}

export function PriceMap({ quotes, fxRates }: PriceMapProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const mapRef = useRef<MapRef>(null)
  const [rawGeojson, setRawGeojson] = useState<GeoJSON.FeatureCollection | null>(null)
  const [hovered, setHovered] = useState<HoverState | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // Load the 24-country EU GeoJSON once.
  useEffect(() => {
    let cancelled = false
    fetch('/eu-countries.geojson')
      .then((r) => r.json())
      .then((data: GeoJSON.FeatureCollection) => {
        if (!cancelled) setRawGeojson(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const quoteMap = useMemo(() => {
    const m: Record<string, CountryPriceQuote> = {}
    for (const q of quotes) m[q.country] = q
    return m
  }, [quotes])

  const pricesEur = useMemo(
    () =>
      quotes
        .filter((q) => q.totalNetPrice > 0)
        .map((q) => q.totalNetPrice * (fxRates[q.currency] ?? 1)),
    [quotes, fxRates]
  )
  const minEur = pricesEur.length > 0 ? Math.min(...pricesEur) : 0
  const maxEur = pricesEur.length > 0 ? Math.max(...pricesEur) : 1

  // Inject compact price string into each feature's properties so the symbol
  // layer can render "BE\n€42k" labels.
  const enrichedGeojson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!rawGeojson) return null
    return {
      ...rawGeojson,
      features: rawGeojson.features.map((f) => {
        const iso = (f.properties as { iso_a2?: string }).iso_a2 ?? ''
        const q = quoteMap[iso]
        const priceShort =
          q && q.totalNetPrice > 0
            ? eurCompactFmt.format(q.totalNetPrice * (fxRates[q.currency] ?? 1))
            : ''
        return {
          ...f,
          properties: { ...(f.properties ?? {}), price_short: priceShort },
        }
      }),
    }
  }, [rawGeojson, quoteMap, fxRates])

  // Identify the cheapest country (in EUR equivalent) for the MIN highlight.
  const minCountryCode = useMemo(() => {
    let best: string | null = null
    let bestEur = Number.POSITIVE_INFINITY
    for (const q of quotes) {
      if (q.totalNetPrice <= 0) continue
      const eur = q.totalNetPrice * (fxRates[q.currency] ?? 1)
      if (eur < bestEur) {
        bestEur = eur
        best = q.country
      }
    }
    return best
  }, [quotes, fxRates])

  // Data-driven fill-color: green→yellow→red for priced countries, muted
  // grey-blue for "model not available", transparent for everything else.
  const fillColorExpr = useMemo(() => {
    const stops: (string | number)[] = []
    for (const q of quotes) {
      if (q.totalNetPrice > 0) {
        const eur = q.totalNetPrice * (fxRates[q.currency] ?? 1)
        stops.push(q.country, getColor(eur, minEur, maxEur))
      } else {
        stops.push(q.country, 'rgba(148,163,184,0.35)')
      }
    }
    return ['match', ['get', 'iso_a2'], ...stops, 'transparent'] as unknown as (
      | string
      | string[]
      | number[]
    )[]
  }, [quotes, fxRates, minEur, maxEur])

  // Outline color & width: thicker + dark for the cheapest country, thin white
  // (light mode) or thin slate (dark mode) for the rest.
  const lineColorExpr = useMemo(() => {
    if (minCountryCode) {
      return [
        'match',
        ['get', 'iso_a2'],
        minCountryCode,
        '#000000',
        isDark ? '#1e293b' : '#ffffff',
      ] as (string | string[])[]
    }
    return [isDark ? '#1e293b' : '#ffffff'] as (string | string[])[]
  }, [minCountryCode, isDark])

  const lineWidthExpr = useMemo(() => {
    if (minCountryCode) {
      return [
        'match',
        ['get', 'iso_a2'],
        minCountryCode,
        2,
        0.6,
      ] as (number | string[])[]
    }
    return [0.6] as (number | string[])[]
  }, [minCountryCode])

  // Auto-fit on the countries that have a valid price. Refits whenever the
  // quotes set changes (i.e. a new comparison is loaded).
  useEffect(() => {
    if (!mapLoaded || !rawGeojson || !mapRef.current) return
    const available = new Set(
      quotes.filter((q) => q.totalNetPrice > 0).map((q) => q.country)
    )
    if (available.size === 0) return
    const feats = rawGeojson.features.filter((f) =>
      available.has((f.properties as { iso_a2?: string }).iso_a2 ?? '')
    )
    const bbox = computeBBox(feats)
    if (!bbox) return
    mapRef.current.fitBounds(bbox, { padding: 32, duration: 600 })
  }, [mapLoaded, rawGeojson, quotes])

  function handleReset() {
    mapRef.current?.easeTo({
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      bearing: 0,
      pitch: 0,
      duration: 600,
    })
  }

  function handleMouseMove(e: MapLayerMouseEvent) {
    const f = e.features?.[0]
    if (!f) {
      if (hovered) setHovered(null)
      return
    }
    const iso = (f.properties as { iso_a2?: string }).iso_a2 ?? ''
    if (!hovered || hovered.country !== iso) {
      setHovered({ country: iso })
    }
  }

  function handleMouseLeave() {
    if (hovered) setHovered(null)
  }

  const hoveredQuote = hovered ? quoteMap[hovered.country] : null
  const hoveredEur =
    hoveredQuote && hoveredQuote.totalNetPrice > 0
      ? hoveredQuote.totalNetPrice * (fxRates[hoveredQuote.currency] ?? 1)
      : 0

  return (
    <div className="w-full relative">
      <Map
        ref={mapRef}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        initialViewState={INITIAL_VIEW}
        cooperativeGestures
        interactiveLayerIds={['countries-fill']}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onLoad={() => setMapLoaded(true)}
        style={{ width: '100%', height: 420, maxHeight: 420 }}
      >
        {enrichedGeojson && (
          <Source
            id="eu"
            type="geojson"
            data={enrichedGeojson}
            promoteId="iso_a2"
          >
            <Layer
              id="countries-fill"
              type="fill"
              paint={{
                'fill-color': fillColorExpr as never,
                'fill-opacity': 0.92,
              }}
            />
            <Layer
              id="countries-line"
              type="line"
              paint={{
                'line-color': lineColorExpr as never,
                'line-width': lineWidthExpr as never,
              }}
            />
            <Layer
              id="country-labels"
              type="symbol"
              layout={{
                'text-field': [
                  'case',
                  ['==', ['get', 'price_short'], ''],
                  ['upcase', ['get', 'iso_a2']],
                  ['concat', ['upcase', ['get', 'iso_a2']], '\n', ['get', 'price_short']],
                ] as never,
                'text-size': 11,
                'text-anchor': 'center',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
              }}
              paint={{
                'text-color': '#000000',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.6,
              }}
            />
          </Source>
        )}
      </Map>

      {/* Legend — gradient + min/max, kept identical to the previous SVG version */}
      <div
        className="absolute bottom-2 right-2 bg-card/95 border rounded-md shadow-md px-3 py-2 pointer-events-none"
        style={{ backdropFilter: 'blur(4px)' }}
      >
        <div className="text-[9px] font-bold text-foreground mb-1">
          Ex-VAT price (EUR):
        </div>
        <div
          className="h-2 w-32 rounded-sm"
          style={{
            background:
              'linear-gradient(to right, #22c55e 0%, #eab308 50%, #ef4444 100%)',
          }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-[8px] text-muted-foreground">
            {minEur > 0 ? eurFmt.format(minEur) : '-'}
          </span>
          <span className="text-[8px] text-muted-foreground">
            {maxEur > 0 ? eurFmt.format(maxEur) : '-'}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleReset}
        className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground"
        style={{ backdropFilter: 'blur(4px)' }}
      >
        <RotateCcw className="h-3 w-3" />
        Reset view
      </button>

      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground/70 pointer-events-none select-none">
        Scroll to zoom · Drag to pan
      </div>

      {hovered && hoveredQuote && (
        <div className="absolute top-2 right-2 bg-card border rounded-md shadow-md px-3 py-2 text-xs pointer-events-none max-w-[200px]">
          <div className="font-semibold">
            {COUNTRY_MAP[hoveredQuote.country]?.name ?? hoveredQuote.country}
          </div>
          {hoveredQuote.totalNetPrice > 0 ? (
            <>
              <div className="text-muted-foreground">
                Ex-VAT:{' '}
                {new Intl.NumberFormat('en-IE', {
                  style: 'currency',
                  currency: hoveredQuote.currency,
                  maximumFractionDigits: 0,
                }).format(hoveredQuote.totalNetPrice)}
              </div>
              <div className="text-muted-foreground">
                ≈ {eurFmt.format(hoveredEur)}
              </div>
              {hoveredQuote.invalidOptionCodes.length +
                hoveredQuote.optionsWithUndefinedPrices.length >
                0 && (
                <div className="text-amber-600 dark:text-amber-400 mt-1">
                  {hoveredQuote.invalidOptionCodes.length +
                    hoveredQuote.optionsWithUndefinedPrices.length}{' '}
                  partial option(s)
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">
              {hoveredQuote.errorCategory === 'model_not_available'
                ? 'Model not available'
                : 'Technical error'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
