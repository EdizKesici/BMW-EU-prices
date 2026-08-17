import { NextRequest, NextResponse } from 'next/server'
import { compareConfigAcrossCountries, configHash, parseBmwConfigUrl } from '@/lib/bmw'
import type { ComparisonResult } from '@/lib/types'
import { SUPPORTED_COUNTRIES } from '@/lib/types'

// In-memory cache: (configHash) -> ComparisonResult, TTL 24h
// Persisted across requests in dev (HMR keeps module state).
const cache = new Map<string, { value: ComparisonResult; expiresAt: number }>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

// Force dynamic - never cache at the route level (we have our own cache)
export const dynamic = 'force-dynamic'
// Disable static optimization
export const revalidate = 0

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const configUrl = url.searchParams.get('configUrl')

  if (!configUrl) {
    return NextResponse.json(
      {
        error:
          "Missing 'configUrl' parameter. Example: ?configUrl=https://configure.bmw.be/fr_BE/configure/G80/31HJ/FLKSW,P0300",
        supportedCountries: SUPPORTED_COUNTRIES.map((c) => c.code),
      },
      { status: 400 }
    )
  }

  // Parse the BMW configurator URL
  let config
  try {
    config = parseBmwConfigUrl(configUrl)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid URL' },
      { status: 400 }
    )
  }

  // Cache check
  // Uses configHash() (modelRange + modelCode + sorted options + sorted accessories)
  // so two configs that only differ by accessories (EI*/SE* codes) don't collide.
  const cacheKey = configHash(config)
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ ...cached.value, cached: true })
  }

  // Fetch from BMW UCP API for each country in parallel
  const result = await compareConfigAcrossCountries(config)

  // Store in cache
  cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS })

  return NextResponse.json({ ...result, cached: false })
}
