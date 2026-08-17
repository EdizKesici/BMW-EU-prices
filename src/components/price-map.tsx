'use client'

import { useMemo, useState, useEffect } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { CountryPriceQuote } from '@/lib/types'
import { COUNTRY_MAP } from '@/lib/types'

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

interface GeoFeature {
  id: string | number
  properties: { name: string }
  geometry: { type: string; coordinates: number[][][] | number[][][][] }
}

const SVG_W = 720
const SVG_H = 560

export function PriceMap({ quotes, fxRates }: PriceMapProps) {
  const [geoData, setGeoData] = useState<GeoFeature[] | null>(null)
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null)

  useEffect(() => {
    fetch('/world-50m.json')
      .then((r) => r.json())
      .then((topo: Topology) => {
        const countries = feature<{ name: string }>(
          topo,
          topo.objects.countries as GeometryCollection<{ name: string }>
        )
        setGeoData(countries.features as GeoFeature[])
      })
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

  // Fixed projection centered on continental Europe
  // Scale 480 = zoom level that shows all EU countries from Portugal to Finland
  // without too much empty space around the edges
  const { euPaths, bgPaths } = useMemo(() => {
    if (!geoData) return { euPaths: [], bgPaths: [] }

    const proj = geoMercator()
      .center([13, 55])
      .scale(440)
      .translate([SVG_W / 2, SVG_H / 2 + 30])
      .clipExtent([[0, 0], [SVG_W, SVG_H]])

    const pathGen = geoPath(proj)

    const eu = geoData
      .filter((f) => ISO_TO_COUNTRY[String(f.id).padStart(3, '0')])
      .map((f) => {
        const iso = String(f.id).padStart(3, '0')
        const countryCode = ISO_TO_COUNTRY[iso] ?? ''
        const q = quoteMap[countryCode]
        const eur = q && q.totalNetPrice > 0
          ? q.totalNetPrice * (fxRates[q.currency] ?? 1)
          : 0
        const d = pathGen(f as never) ?? ''
        const centroid = pathGen.centroid(f as never)
        return {
          countryCode,
          countryName: COUNTRY_MAP[countryCode]?.name ?? f.properties.name,
          d,
          hasPrice: q?.totalNetPrice > 0,
          eur,
          quote: q,
          cx: centroid[0],
          cy: centroid[1],
        }
      })

    const bg = geoData
      .filter((f) => !ISO_TO_COUNTRY[String(f.id).padStart(3, '0')])
      .map((f) => ({
        id: f.id,
        d: pathGen(f as never) ?? '',
      }))
      .filter((p) => p.d !== '') // Only keep visible paths

    return { euPaths: eu, bgPaths: bg }
  }, [geoData, quoteMap, fxRates])

  if (!geoData) {
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
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-auto" style={{ maxHeight: '600px' }}>
        <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="hsl(var(--muted) / 0.15)" rx="8" />

        {/* Non-EU countries (light gray) - only visible ones due to clipExtent */}
        {bgPaths.map((p) => (
          <path key={`bg-${p.id}`} d={p.d} fill="hsl(var(--muted) / 0.35)" stroke="hsl(var(--border))" strokeWidth={0.4} />
        ))}

        {/* EU countries colored by price */}
        {euPaths.map((p) => {
          const color = p.hasPrice ? getColor(p.eur) : 'hsl(var(--muted) / 0.5)'
          const isMin = p.hasPrice && p.eur === minEur
          const isHovered = hoveredCountry === p.countryCode
          return (
            <path
              key={p.countryCode}
              d={p.d}
              fill={color}
              stroke={isMin ? '#000' : isHovered ? 'hsl(var(--foreground))' : 'hsl(var(--background))'}
              strokeWidth={isMin ? 1.5 : isHovered ? 1.2 : 0.6}
              opacity={p.hasPrice ? (isHovered ? 1 : 0.88) : 0.5}
              style={{ cursor: p.hasPrice ? 'pointer' : 'default', transition: 'opacity 0.15s' }}
              onMouseEnter={() => setHoveredCountry(p.countryCode)}
              onMouseLeave={() => setHoveredCountry(null)}
            />
          )
        })}

        {/* Labels for countries with prices */}
        {euPaths.filter((p) => p.hasPrice && !isNaN(p.cx)).map((p) => {
          const isMin = p.eur === minEur
          return (
            <g key={`label-${p.countryCode}`} pointerEvents="none">
              {isMin && (
                <circle cx={p.cx} cy={p.cy - 12} r={4} fill="#22c55e" stroke="#000" strokeWidth={1} />
              )}
              <text
                x={p.cx}
                y={p.cy - 2}
                textAnchor="middle"
                fontSize={8}
                fontWeight="bold"
                fill="#000"
                opacity={0.9}
              >
                {p.countryCode.toUpperCase()}
              </text>
              <text
                x={p.cx}
                y={p.cy + 8}
                textAnchor="middle"
                fontSize={7}
                fill="#000"
                opacity={0.7}
              >
                {eurFmt.format(p.eur)}
              </text>
            </g>
          )
        })}

        {/* Legend */}
        <g transform="translate(380, 480)">
          <rect x="-8" y="-18" width="240" height="34" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="0.5" rx="4" opacity="0.95" />
          <text x="0" y="-6" fontSize="9" fontWeight="bold" fill="hsl(var(--foreground))">
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
          <text x="0" y="18" fontSize="7" fill="hsl(var(--muted-foreground))">
            {minEur > 0 ? eurFmt.format(minEur) : '-'}
          </text>
          <text x="120" y="18" textAnchor="end" fontSize="7" fill="hsl(var(--muted-foreground))">
            {maxEur > 0 ? eurFmt.format(maxEur) : '-'}
          </text>
        </g>
      </svg>

      {/* Hover tooltip */}
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
