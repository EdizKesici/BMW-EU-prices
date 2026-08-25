'use client'

import { useMemo, useState, useEffect } from 'react'
import { geoMercator, geoPath, geoArea, geoCentroid, geoBounds } from 'd3-geo'
import { feature } from 'topojson-client'
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Marker,
  createCoordinates,
} from '@vnedyalk0v/react19-simple-maps'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, Geometry, FeatureCollection } from 'geojson'
import type { CountryPriceQuote } from '@/lib/types'
import { COUNTRY_MAP } from '@/lib/types'
import { RotateCcw } from 'lucide-react'

// ISO 3166-1 numeric → our country codes
const ISO_TO_COUNTRY: Record<string, string> = {
  '056': 'be', '528': 'nl', '276': 'de', '250': 'fr', '724': 'es', '100': 'bg',
  '040': 'at', '203': 'cz', '208': 'dk', '233': 'ee', '246': 'fi', '300': 'gr',
  '191': 'hr', '348': 'hu', '380': 'it', '440': 'lt', '442': 'lu', '428': 'lv',
  '616': 'pl', '620': 'pt', '642': 'ro', '752': 'se', '705': 'si', '703': 'sk',
}

interface PriceMapProps {
  quotes: CountryPriceQuote[]
  fxRates: Record<string, number>
}

const SVG_W = 720
const SVG_H = 560
const FIT_PADDING = 24

// Modest clip margin (not the whole world): some countries' multipolygons
// include geometry very far from Europe (see mainlandGeometry below), and
// Mercator wraps badly for shapes reaching the antimeridian. A tight-ish
// clip keeps all of that firmly out of view.
const CLIP_MARGIN_X = 190
const CLIP_MARGIN_Y = 190

// Label size tiers, in projected pixel units. Below DOT_ONLY_MAX a country
// is too small on screen for any text to fit without spilling into a
// neighbour - just a dot, full detail stays on hover. Between the two, just
// the 2-letter code. Above CODE_ONLY_MAX, the full code + price label.
const DOT_ONLY_MAX = 7
const CODE_ONLY_MAX = 20

function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value))
}

// Some countries' multipolygons bundle territory very far from mainland
// Europe into the exact same feature - e.g. this dataset's "France" includes
// French Guiana, Réunion, Martinique, Mayotte and Guadeloupe, and its
// "Netherlands" includes Curaçao and Sint Maarten. For label placement/sizing
// we only want the largest ring by real-world area - i.e. the mainland.
function mainlandGeometry(geometry: Geometry): Geometry {
  if (geometry.type !== 'MultiPolygon') return geometry
  let best = geometry.coordinates[0]
  let bestArea = 0
  for (const poly of geometry.coordinates) {
    const a = geoArea({ type: 'Polygon', coordinates: poly } as never)
    if (a > bestArea) {
      bestArea = a
      best = poly
    }
  }
  return { type: 'Polygon', coordinates: best } as Geometry
}

interface LabelInfo {
  countryCode: string
  coordinates: [number, number]
  minDim: number
}

export function PriceMap({ quotes, fxRates }: PriceMapProps) {
  const [rawTopology, setRawTopology] = useState<Topology | null>(null)
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    fetch('/world-50m.json')
      .then((r) => r.json())
      .then((topo: Topology) => setRawTopology(topo))
      .catch(() => {})
  }, [])

  const quoteMap = useMemo(() => {
    const m: Record<string, CountryPriceQuote> = {}
    for (const q of quotes) m[q.country] = q
    return m
  }, [quotes])

  const pricesEur = useMemo(() => {
    return quotes
      .filter((q) => q.totalNetPrice > 0)
      .map((q) => q.totalNetPrice * (fxRates[q.currency] ?? 1))
  }, [quotes, fxRates])

  const minEur = pricesEur.length > 0 ? Math.min(...pricesEur) : 0
  const maxEur = pricesEur.length > 0 ? Math.max(...pricesEur) : 1

  function getColor(eur: number): string {
    if (maxEur === minEur) return '#22c55e'
    const ratio = (eur - minEur) / (maxEur - minEur)
    if (ratio < 0.5) {
      const r = ratio * 2
      return `rgb(${Math.round(r * 255)}, 217, ${Math.round((0.37 - r * 0.37) * 255)})`
    }
    const g = 0.85 - (ratio - 0.5) * 2 * 0.85
    return `rgb(255, ${Math.round(g * 255)}, 0)`
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

  // Force ZoomableGroup to remount (clean pan/zoom reset) whenever a new
  // comparison comes in.
  useEffect(() => {
    queueMicrotask(() => setResetKey((k) => k + 1))
  }, [quotes])

  const availableCountryCodes = useMemo(() => {
    return new Set(quotes.filter((q) => q.totalNetPrice > 0).map((q) => q.country))
  }, [quotes])

  // Parsed once for our own fit/label computations. <Geographies> below
  // parses the same file again on its own for rendering - kept decoupled
  // rather than threading pre-parsed features through props neither
  // component was designed to accept; the extra parse is cheap.
  const parsedFeatures = useMemo(() => {
    if (!rawTopology) return null
    const objectKey = Object.keys(rawTopology.objects)[0]
    if (!objectKey) return null
    const collection = feature(
      rawTopology,
      rawTopology.objects[objectKey] as GeometryCollection
    ) as unknown as FeatureCollection
    const allFeatures = collection.features as Feature<Geometry, { name: string }>[]
    const euFeatures = allFeatures.filter((f) => ISO_TO_COUNTRY[String(f.id).padStart(3, '0')])
    return { euFeatures }
  }, [rawTopology])

  // Auto-fitted (and clipped) projection, recentered on whichever countries
  // currently have a usable price - falls back to the full EU set before
  // any comparison has run. Also computes each country's label position
  // (mainland-only centroid, blended toward its bounding-box center) and
  // on-screen size (drives the label tier above).
  const mapData = useMemo(() => {
    if (!parsedFeatures) return null
    const { euFeatures } = parsedFeatures

    const featuresToFit = availableCountryCodes.size > 0
      ? euFeatures.filter((f) =>
          availableCountryCodes.has(ISO_TO_COUNTRY[String(f.id).padStart(3, '0')] ?? '')
        )
      : euFeatures

    // Fit against mainland-only geometry (see mainlandGeometry below): using
    // the raw features here would let overseas territories bundled into the
    // same feature (French Guiana/Réunion/Martinique for France, Curaçao for
    // the Netherlands, Azores/Canaries for Portugal/Spain) distort the fit
    // itself, not just label placement - most visible with small subsets
    // where a France/Netherlands really throws off the aspect ratio.
    const fitFeatures = featuresToFit.map((f) => ({
      type: 'Feature' as const,
      geometry: mainlandGeometry(f.geometry),
      properties: {},
    }))

    // fitExtent only guarantees ONE dimension exactly fills the target box
    // (it preserves aspect ratio, so the other is left with slack) - which
    // one depends entirely on which countries are shown (the full
    // 24-country set is much taller than wide; a Belgium+France+Germany
    // subset is closer to square). Zooming in afterwards to close that gap
    // doesn't work: a uniform zoom scales both axes together, so it just
    // pushes the ALREADY-tight axis (zero slack by definition) straight
    // past the edge - that's what was cropping Sweden/Finland's north or
    // Spain depending on which axis happened to be tight.
    //
    // Fixed properly with a two-pass fit instead: pass 1 fits against the
    // full padded box just to learn the content's natural aspect ratio;
    // pass 2 re-fits against a target box reshaped to match that aspect
    // ratio (with a safety margin), centered in the canvas. That way the
    // fit itself is already tight on both axes and no secondary zoom is
    // needed for the default view at all.
    const trialProjection = geoMercator().fitExtent(
      [[FIT_PADDING, FIT_PADDING], [SVG_W - FIT_PADDING, SVG_H - FIT_PADDING]],
      { type: 'FeatureCollection', features: fitFeatures } as never
    )
    const trialBounds = geoPath(trialProjection).bounds({ type: 'FeatureCollection', features: fitFeatures } as never)
    const contentW = trialBounds[1][0] - trialBounds[0][0]
    const contentH = trialBounds[1][1] - trialBounds[0][1]
    const fullTargetW = SVG_W - 2 * FIT_PADDING
    const fullTargetH = SVG_H - 2 * FIT_PADDING
    const contentAspect = contentW / contentH
    const fullTargetAspect = fullTargetW / fullTargetH

    // Safety margin so content fills ~85% of its tightened box rather than
    // 100% (0% would leave zero breathing room against the clip boundary).
    const FILL_RATIO = 0.85
    let tightW = fullTargetW
    let tightH = fullTargetH
    if (contentAspect < fullTargetAspect) {
      tightW = (fullTargetH * contentAspect) / FILL_RATIO
    } else {
      tightH = (fullTargetW / contentAspect) / FILL_RATIO
    }
    tightW = Math.min(tightW, fullTargetW)
    tightH = Math.min(tightH, fullTargetH)
    const offsetX = FIT_PADDING + (fullTargetW - tightW) / 2
    const offsetY = FIT_PADDING + (fullTargetH - tightH) / 2

    const projection = geoMercator()
      .fitExtent(
        [[offsetX, offsetY], [offsetX + tightW, offsetY + tightH]],
        { type: 'FeatureCollection', features: fitFeatures } as never
      )
      .clipExtent([[-CLIP_MARGIN_X, -CLIP_MARGIN_Y], [SVG_W + CLIP_MARGIN_X, SVG_H + CLIP_MARGIN_Y]])

    // Only used to measure each country's own on-screen footprint (for the
    // label size tiers) - independent from actual rendering, which
    // <Geography>/<Marker> handle themselves via the same projection object.
    const measurePath = geoPath(projection)

    const labels: LabelInfo[] = euFeatures.map((f) => {
      const countryCode = ISO_TO_COUNTRY[String(f.id).padStart(3, '0')] ?? ''
      const mainland = mainlandGeometry(f.geometry)
      const mainlandFeature = { type: 'Feature' as const, geometry: mainland, properties: {} }

      const centroidLonLat = geoCentroid(mainlandFeature as never)
      const boundsLonLat = geoBounds(mainlandFeature as never)
      const bboxCenterLonLat: [number, number] = [
        (boundsLonLat[0][0] + boundsLonLat[1][0]) / 2,
        (boundsLonLat[0][1] + boundsLonLat[1][1]) / 2,
      ]
      // Blend true centroid with bbox-center: pure centroid can land
      // off-visual-center for elongated/crescent shapes (Croatia wrapping
      // the Adriatic, Sweden/Finland's north-south sprawl).
      const lon = centroidLonLat[0] * 0.6 + bboxCenterLonLat[0] * 0.4
      const lat = centroidLonLat[1] * 0.6 + bboxCenterLonLat[1] * 0.4

      const pixelBounds = measurePath.bounds(mainlandFeature as never)
      const minDim = Math.min(
        pixelBounds[1][0] - pixelBounds[0][0],
        pixelBounds[1][1] - pixelBounds[0][1]
      )

      return { countryCode, coordinates: [lon, lat], minDim }
    })

    // The fit above is already tight on both axes, so the default
    // interactive zoom is just 1 - no secondary "fill the gap" zoom needed
    // (that approach is what caused the cropping in the first place).
    const zoom = 1

    // Geographic point that sits at the visual center of our already-fitted
    // projection. ZoomableGroup's own `center` prop defaults to [0,0]
    // (Gulf of Guinea) if left unset, which is NOT a no-op: zooming in from
    // there drags the whole view toward the equator/Africa instead of
    // zooming into our fitted Europe view. Passing the correct geographic
    // center is what makes `zoom` behave like a simple "zoom into what's
    // already framed" instead of re-centering somewhere else entirely.
    const center = projection.invert
      ? projection.invert([SVG_W / 2, SVG_H / 2]) ?? [0, 0]
      : [0, 0]

    return { projection, labels, center: center as [number, number], zoom }
  }, [parsedFeatures, availableCountryCodes])

  if (!rawTopology || !mapData) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    )
  }

  const hovered = hoveredCountry ? quoteMap[hoveredCountry] : null
  const hoveredEur = hovered && hovered.totalNetPrice > 0
    ? hovered.totalNetPrice * (fxRates[hovered.currency] ?? 1)
    : 0

  return (
    <div className="w-full relative">
      <ComposableMap
        projection={mapData.projection}
        width={SVG_W}
        height={SVG_H}
        className="w-full h-auto"
        style={{ maxHeight: '420px' }}
      >
        <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="var(--muted)" opacity="0.15" rx="8" />

        <ZoomableGroup
          key={resetKey}
          center={createCoordinates(mapData.center[0], mapData.center[1])}
          zoom={mapData.zoom}
          minZoom={1}
          maxZoom={10}
        >
          <Geographies geography={rawTopology}>
            {({ geographies }) =>
              geographies.map((geography, index) => {
                const countryCode = ISO_TO_COUNTRY[String(geography.id).padStart(3, '0')]

                if (!countryCode) {
                  return (
                    <Geography
                      key={`bg-${index}-${geography.id ?? 'x'}`}
                      geography={geography}
                      style={{
                        default: { fill: 'var(--muted)', fillOpacity: 0.35, stroke: 'var(--border)', strokeWidth: 0.4 / mapData.zoom, outline: 'none' },
                        hover: { fill: 'var(--muted)', fillOpacity: 0.35, stroke: 'var(--border)', strokeWidth: 0.4 / mapData.zoom, outline: 'none' },
                        pressed: { fill: 'var(--muted)', fillOpacity: 0.35, stroke: 'var(--border)', strokeWidth: 0.4 / mapData.zoom, outline: 'none' },
                      }}
                    />
                  )
                }

                const q = quoteMap[countryCode]
                const hasPrice = !!q && q.totalNetPrice > 0
                const eur = hasPrice ? q.totalNetPrice * (fxRates[q.currency] ?? 1) : 0
                const color = hasPrice ? getColor(eur) : 'var(--muted)'
                const isMin = hasPrice && eur === minEur

                return (
                  <Geography
                    key={`eu-${countryCode}`}
                    geography={geography}
                    onMouseEnter={() => setHoveredCountry(countryCode)}
                    onMouseLeave={() => setHoveredCountry(null)}
                    style={{
                      default: {
                        fill: color,
                        stroke: isMin ? '#000' : 'var(--background)',
                        strokeWidth: (isMin ? 1.5 : 0.6) / mapData.zoom,
                        opacity: hasPrice ? 0.88 : 0.5,
                        outline: 'none',
                        cursor: hasPrice ? 'pointer' : 'default',
                        transition: 'opacity 0.15s',
                      },
                      hover: {
                        fill: color,
                        stroke: 'var(--foreground)',
                        strokeWidth: 1.2 / mapData.zoom,
                        opacity: hasPrice ? 1 : 0.5,
                        outline: 'none',
                        cursor: hasPrice ? 'pointer' : 'default',
                      },
                      pressed: {
                        fill: color,
                        stroke: 'var(--foreground)',
                        strokeWidth: 1.2 / mapData.zoom,
                        opacity: 1,
                        outline: 'none',
                      },
                    }}
                  />
                )
              })
            }
          </Geographies>

          {mapData.labels.map((label) => {
            const q = quoteMap[label.countryCode]
            if (!q || q.totalNetPrice <= 0) return null
            const eur = q.totalNetPrice * (fxRates[q.currency] ?? 1)
            const isMin = eur === minEur
            const coords = createCoordinates(label.coordinates[0], label.coordinates[1])

            if (label.minDim < DOT_ONLY_MAX) {
              return (
                <Marker key={label.countryCode} coordinates={coords}>
                  <circle r={(isMin ? 4.5 : 3) / mapData.zoom} fill={isMin ? '#22c55e' : '#000'} stroke="#fff" strokeWidth={0.8 / mapData.zoom} opacity={0.9} />
                </Marker>
              )
            }

            if (label.minDim < CODE_ONLY_MAX) {
              const fontSize = clamp(label.minDim * 0.5, 8.5, 11) / mapData.zoom
              return (
                <Marker key={label.countryCode} coordinates={coords} style={{ default: { pointerEvents: 'none' } }}>
                  <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="bold" fill="#000" opacity={0.9}>
                    {label.countryCode.toUpperCase()}
                  </text>
                </Marker>
              )
            }

            const nameFontSize = clamp(label.minDim * 0.26, 11, 17) / mapData.zoom
            const priceFontSize = nameFontSize * 0.72
            return (
              <Marker key={label.countryCode} coordinates={coords} style={{ default: { pointerEvents: 'none' } }}>
                <text y={-nameFontSize * 0.15} textAnchor="middle" fontSize={nameFontSize} fontWeight="bold" fill="#000" opacity={0.9}>
                  {label.countryCode.toUpperCase()}
                </text>
                <text y={priceFontSize * 1.2} textAnchor="middle" fontSize={priceFontSize} fill="#000" opacity={0.75}>
                  {eurCompactFmt.format(eur)}
                </text>
              </Marker>
            )
          })}
        </ZoomableGroup>

        {/* Legend - a direct child of ComposableMap (sibling of
            ZoomableGroup), so it never pans/zooms with the map. Tucked in
            the bottom-right corner so it never sits over the middle of the
            fitted content regardless of which countries are being shown. */}
        <g transform={`translate(${SVG_W - 268}, ${SVG_H - 52})`}>
          <rect x="-8" y="-18" width="240" height="34" fill="var(--card)" stroke="var(--border)" strokeWidth="0.5" rx="4" opacity="0.95" />
          <text x="0" y="-6" fontSize="9" fontWeight="bold" fill="var(--foreground)">
            Ex-VAT price (EUR):
          </text>
          <defs>
            <linearGradient id="priceGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="50%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="120" height="8" fill="url(#priceGradient)" rx="2" />
          <text x="0" y="18" fontSize="7" fill="var(--muted-foreground)">
            {minEur > 0 ? eurFmt.format(minEur) : '-'}
          </text>
          <text x="120" y="18" textAnchor="end" fontSize="7" fill="var(--muted-foreground)">
            {maxEur > 0 ? eurFmt.format(maxEur) : '-'}
          </text>
        </g>
      </ComposableMap>

      <button
        type="button"
        onClick={() => setResetKey((k) => k + 1)}
        className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" />
        Reset view
      </button>

      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground/70 pointer-events-none select-none">
        Scroll to zoom · Drag to pan
      </div>

      {hovered && (
        <div className="absolute top-2 right-2 bg-card border rounded-md shadow-md px-3 py-2 text-xs pointer-events-none max-w-[200px]">
          <div className="font-semibold">
            {COUNTRY_MAP[hovered.country]?.name ?? hovered.country}
          </div>
          {hovered.totalNetPrice > 0 ? (
            <>
              <div className="text-muted-foreground">
                Ex-VAT: {new Intl.NumberFormat('en-IE', { style: 'currency', currency: hovered.currency, maximumFractionDigits: 0 }).format(hovered.totalNetPrice)}
              </div>
              <div className="text-muted-foreground">
                ≈ {eurFmt.format(hoveredEur)}
              </div>
              {hovered.invalidOptionCodes.length + hovered.optionsWithUndefinedPrices.length > 0 && (
                <div className="text-amber-600 dark:text-amber-400 mt-1">
                  {hovered.invalidOptionCodes.length + hovered.optionsWithUndefinedPrices.length} partial option(s)
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">
              {hovered.errorCategory === 'model_not_available' ? 'Model not available' : 'Technical error'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
