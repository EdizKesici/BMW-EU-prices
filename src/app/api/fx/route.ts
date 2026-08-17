import { NextResponse } from 'next/server'
import { getFxRates, FALLBACK_FX_TO_EUR } from '@/lib/crossborder'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// FX rates endpoint - serves ECB rates (cached 6h on server)
// Used by the HTVA comparison table to sort countries by EUR-equivalent price.
export async function GET() {
  try {
    const rates = await getFxRates()
    return NextResponse.json({
      rates,
      source: 'frankfurter.dev (ECB)',
      isFallback: rates === FALLBACK_FX_TO_EUR,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'FX error', rates: FALLBACK_FX_TO_EUR, isFallback: true },
      { status: 200 }
    )
  }
}
