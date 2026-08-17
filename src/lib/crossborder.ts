// Cross-border calculator (simplified V5)
// Computes the total cost when buying a car in country X while living in country Y.
//
// Key principle (EU single market):
//   When you buy a NEW car in another EU country and bring it home to register,
//   you pay VAT in your country of RESIDENCE, not in the country of purchase.
//   The dealer in the origin country sells the car ex-VAT (HTVA) with an invoice
//   marked "TVA non perçue - article 138 directive 2006/112/CE".
//
// Total cost (simplified) = HTVA(origin, in residence currency) + transport + VAT(residence)
//
// We intentionally do NOT include:
//   - Regional registration taxes (TMC BE, BPM NL, ISV PT, etc.) - too chaotic, varies by region
//   - CO2 malus (BE/FR) - would require WLTP data + complex regional formulas
//   - Local taxes from BMW API - they apply to local buyers, not cross-border
//
// The user can add these manually if they want a more precise total.

import type { ComparisonResult, CountryPriceQuote, CrossBorderRow } from './types'
import { COUNTRY_MAP } from './types'

// ---------- FX rates ----------
// Fetched at runtime from frankfurter.dev (ECB rates, free, no API key).
// Fallback hardcoded rates (Aug 2026) if API fails.

export const FALLBACK_FX_TO_EUR: Record<string, number> = {
  // 1 unit of foreign currency = X EUR
  EUR: 1,
  CZK: 0.0413,   // 1 CZK = €0.0413 (1 EUR ≈ 24.21 CZK)
  DKK: 0.1338,   // 1 DKK = €0.1338 (1 EUR ≈ 7.476 DKK)
  HUF: 0.00276,  // 1 HUF = €0.00276 (1 EUR ≈ 362.6 HUF)
  PLN: 0.2322,   // 1 PLN = €0.2322 (1 EUR ≈ 4.307 PLN)
  SEK: 0.0909,   // 1 SEK = €0.0909 (1 EUR ≈ 11.0 SEK)
}

let fxRatesCache: { rates: Record<string, number>; expiresAt: number } | null = null
const FX_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * Fetch FX rates from frankfurter.dev (ECB daily rates, free, no API key needed).
 * Returns rates as "1 unit of currency = X EUR" for easy conversion.
 * Cached for 6 hours.
 */
export async function getFxRates(): Promise<Record<string, number>> {
  if (fxRatesCache && fxRatesCache.expiresAt > Date.now()) {
    return fxRatesCache.rates
  }
  try {
    // frankfurter returns "1 EUR = X foreign" - we want "1 foreign = X EUR" so we invert
    const res = await fetch(
      'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CZK,DKK,HUF,PLN,SEK',
      { cache: 'no-store' }
    )
    if (!res.ok) throw new Error(`FX API ${res.status}`)
    const data = (await res.json()) as { rates: Record<string, number> }
    // Convert: 1 foreign = 1 / rate EUR
    const rates: Record<string, number> = { EUR: 1 }
    for (const [currency, eurPerForeign] of Object.entries(data.rates)) {
      rates[currency] = 1 / eurPerForeign
    }
    fxRatesCache = { rates, expiresAt: Date.now() + FX_TTL_MS }
    return rates
  } catch {
    // Fallback to hardcoded rates
    return FALLBACK_FX_TO_EUR
  }
}

/**
 * Convert an amount from one currency to another via EUR as bridge.
 * Uses the provided FX rates map (1 unit of currency = X EUR).
 */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  fxRates: Record<string, number>
): number {
  if (from === to) return amount
  const fromRate = fxRates[from]
  const toRate = fxRates[to]
  if (!fromRate || !toRate) {
    throw new Error(`Devises non supportées: ${from} → ${to}`)
  }
  // amount_in_EUR = amount * fromRate (since fxRates[currency] = "1 unit in EUR")
  const amountInEur = amount * fromRate
  return amountInEur / toRate
}

// ---------- Transport cost estimation ----------
// Approximate road distance (km) between capitals.
// Source: Google Maps approximations, capped at 3000 km for sanity.
// Transport cost = €0.80/km for open-truck single-car transport (industry average 2026).
// This is intentionally rough - actual quotes vary €0.50-€1.20/km depending on:
//   - open vs closed truck (closed = +50%)
//   - single car vs consolidated load (consolidated = -30%)
//   - season (summer = +20% demand)
//   - urgent vs scheduled (urgent = +30%)

const TRANSPORT_RATE_EUR_PER_KM = 0.80

// Distances between capitals (km, road). Symmetric.
const CAPITAL_DISTANCES_KM: Record<string, Record<string, number>> = {
  be: { be: 0, nl: 200, de: 650, fr: 300, es: 1300, bg: 1700, at: 900, cz: 900, dk: 950, ee: 1800, fi: 2100, gr: 2100, hr: 1200, hu: 1300, it: 1200, lt: 1500, lu: 200, lv: 1600, pl: 1100, pt: 1700, ro: 1800, se: 1500, si: 1100, sk: 1100 },
  nl: { be: 200, nl: 0, de: 600, fr: 450, es: 1400, bg: 1800, at: 950, cz: 850, dk: 750, ee: 1700, fi: 2000, gr: 2200, hr: 1250, hu: 1350, it: 1250, lt: 1450, lu: 300, lv: 1550, pl: 1050, pt: 1800, ro: 1900, se: 1450, si: 1150, sk: 1150 },
  fr: { be: 300, nl: 450, de: 950, fr: 0, es: 1050, bg: 1900, at: 1100, cz: 1100, dk: 1150, ee: 2000, fi: 2300, gr: 2300, hr: 1400, hu: 1500, it: 1100, lt: 1700, lu: 350, lv: 1800, pl: 1300, pt: 1500, ro: 2000, se: 1700, si: 1300, sk: 1300 },
  de: { be: 650, nl: 600, de: 0, fr: 950, es: 1650, bg: 1600, at: 600, cz: 350, dk: 450, ee: 1500, fi: 1800, gr: 2000, hr: 900, hu: 950, it: 1200, lt: 1200, lu: 700, lv: 1300, pl: 550, pt: 2050, ro: 1700, se: 1100, si: 850, sk: 750 },
  it: { be: 1200, nl: 1250, de: 1200, fr: 1100, es: 1500, bg: 1100, at: 700, cz: 900, dk: 1400, ee: 2200, fi: 2500, gr: 1500, hr: 600, hu: 800, it: 0, lt: 1600, lu: 1000, lv: 1700, pl: 1100, pt: 1900, ro: 1300, se: 1700, si: 500, sk: 850 },
  es: { be: 1300, nl: 1400, fr: 1050, de: 1650, es: 0, bg: 2400, at: 1700, cz: 1800, dk: 1850, ee: 2700, fi: 3000, gr: 2500, hr: 1700, hu: 1800, it: 1500, lt: 2400, lu: 1400, lv: 2500, pl: 2000, pt: 600, ro: 2300, se: 2400, si: 1600, sk: 1700 },
  at: { be: 900, nl: 950, de: 600, fr: 1100, es: 1700, bg: 1000, at: 0, cz: 250, dk: 850, ee: 1400, fi: 1700, gr: 1500, hr: 250, hu: 250, it: 700, lt: 1100, lu: 800, lv: 1200, pl: 600, pt: 2050, ro: 800, se: 1300, si: 250, sk: 70 },
  cz: { be: 900, nl: 850, de: 350, fr: 1100, es: 1800, bg: 1100, at: 250, cz: 0, dk: 600, ee: 1300, fi: 1600, gr: 1500, hr: 500, hu: 500, it: 900, lt: 1000, lu: 700, lv: 1100, pl: 500, pt: 2150, ro: 900, se: 1100, si: 450, sk: 250 },
  dk: { be: 950, nl: 750, de: 450, fr: 1150, es: 1850, bg: 1700, at: 850, cz: 600, dk: 0, ee: 900, fi: 1200, gr: 1900, hr: 950, hu: 1050, it: 1400, lt: 800, lu: 800, lv: 900, pl: 600, pt: 2300, ro: 1600, se: 600, si: 1000, sk: 850 },
  ee: { be: 1800, nl: 1700, de: 1500, fr: 2000, es: 2700, bg: 2000, at: 1400, cz: 1300, dk: 900, ee: 0, fi: 300, gr: 2300, hr: 1400, hu: 1400, it: 2200, lt: 300, lu: 1600, lv: 200, pl: 900, pt: 2900, ro: 1700, se: 700, si: 1500, sk: 1300 },
  fi: { be: 2100, nl: 2000, de: 1800, fr: 2300, es: 3000, bg: 2200, at: 1700, cz: 1600, dk: 1200, ee: 300, fi: 0, gr: 2500, hr: 1700, hu: 1700, it: 2500, lt: 600, lu: 1900, lv: 400, pl: 1200, pt: 3000, ro: 1900, se: 400, si: 1800, sk: 1600 },
  gr: { be: 2100, nl: 2200, de: 2000, fr: 2300, es: 2500, bg: 500, at: 1500, cz: 1500, dk: 1900, ee: 2300, fi: 2500, gr: 0, hr: 1100, hu: 800, it: 1500, lt: 1400, lu: 1900, lv: 1500, pl: 1300, pt: 2700, ro: 600, se: 2200, si: 1100, sk: 900 },
  hr: { be: 1200, nl: 1250, de: 900, fr: 1400, es: 1700, bg: 1100, at: 250, cz: 500, dk: 950, ee: 1400, fi: 1700, gr: 1100, hr: 0, hu: 250, it: 600, lt: 1100, lu: 900, lv: 1200, pl: 700, pt: 2150, ro: 700, se: 1300, si: 100, sk: 300 },
  hu: { be: 1300, nl: 1350, de: 950, fr: 1500, es: 1800, bg: 600, at: 250, cz: 500, dk: 1050, ee: 1400, fi: 1700, gr: 800, hr: 250, hu: 0, it: 800, lt: 1100, lu: 1000, lv: 1200, pl: 600, pt: 2250, ro: 500, se: 1400, si: 250, sk: 200 },
  lt: { be: 1500, nl: 1450, de: 1200, fr: 1700, es: 2400, bg: 1300, at: 1100, cz: 1000, dk: 800, ee: 300, fi: 600, gr: 1400, hr: 1100, hu: 1100, it: 1600, lt: 0, lu: 1400, lv: 250, pl: 600, pt: 2700, ro: 1300, se: 900, si: 1200, sk: 1100 },
  lu: { be: 200, nl: 300, de: 700, fr: 350, es: 1400, bg: 1700, at: 800, cz: 700, dk: 800, ee: 1600, fi: 1900, gr: 1900, hr: 900, hu: 1000, it: 1000, lt: 1400, lu: 0, lv: 1500, pl: 900, pt: 1800, ro: 1500, se: 1300, si: 950, sk: 850 },
  lv: { be: 1600, nl: 1550, de: 1300, fr: 1800, es: 2500, bg: 1400, at: 1200, cz: 1100, dk: 900, ee: 200, fi: 400, gr: 1500, hr: 1200, hu: 1200, it: 1700, lt: 250, lv: 0, lu: 1500, pl: 700, pt: 2800, ro: 1400, se: 800, si: 1300, sk: 1200 },
  pl: { be: 1100, nl: 1050, de: 550, fr: 1300, es: 2000, bg: 1200, at: 600, cz: 500, dk: 600, ee: 900, fi: 1200, gr: 1300, hr: 700, hu: 600, it: 1100, lt: 600, lu: 900, lv: 700, pl: 0, pt: 2450, ro: 900, se: 900, si: 750, sk: 550 },
  pt: { be: 1700, nl: 1800, fr: 1500, de: 2050, es: 600, bg: 2700, at: 2050, cz: 2150, dk: 2300, ee: 2900, fi: 3000, gr: 2700, hr: 2150, hu: 2250, it: 1900, lt: 2700, lu: 1800, lv: 2800, pl: 2450, pt: 0, ro: 2600, se: 2600, si: 2100, sk: 2200 },
  ro: { be: 1800, nl: 1900, de: 1700, fr: 2000, es: 2300, bg: 200, at: 800, cz: 900, dk: 1600, ee: 1700, fi: 1900, gr: 600, hr: 700, hu: 500, it: 1300, lt: 1300, lu: 1500, lv: 1400, pl: 900, pt: 2600, ro: 0, se: 1700, si: 750, sk: 650 },
  se: { be: 1500, nl: 1450, de: 1100, fr: 1700, es: 2400, bg: 2000, at: 1300, cz: 1100, dk: 600, ee: 700, fi: 400, gr: 2200, hr: 1300, hu: 1400, it: 1700, lt: 900, lu: 1300, lv: 800, pl: 900, pt: 2600, ro: 1700, se: 0, si: 1400, sk: 1200 },
  si: { be: 1100, nl: 1150, de: 850, fr: 1300, es: 1600, bg: 1100, at: 250, cz: 450, dk: 1000, ee: 1500, fi: 1800, gr: 1100, hr: 100, hu: 250, it: 500, lt: 1200, lu: 950, lv: 1300, pl: 750, pt: 2100, ro: 750, se: 1400, si: 0, sk: 300 },
  sk: { be: 1100, nl: 1150, de: 750, fr: 1300, es: 1700, bg: 700, at: 70, cz: 250, dk: 850, ee: 1300, fi: 1600, gr: 900, hr: 300, hu: 200, it: 850, lt: 1100, lu: 850, lv: 1200, pl: 550, pt: 2200, ro: 650, se: 1200, si: 300, sk: 0 },
}

/**
 * Estimate road transport cost between two countries (€, in EUR).
 * Based on €0.80/km for open-truck transport of one car (industry average 2026).
 * Returns 0 if origin === residence (no transport needed).
 */
function estimateTransport(origin: string, residence: string): number {
  if (origin === residence) return 0
  const distances = CAPITAL_DISTANCES_KM[residence]
  if (!distances) return 800 // fallback
  const km = distances[origin]
  if (!km) return 800 // fallback
  return Math.round(km * TRANSPORT_RATE_EUR_PER_KM)
}

/**
 * Compute cross-border rows for each origin country given a residence.
 * Uses dynamic FX rates.
 *
 * Simplified formula:
 *   totalCost = HTVA(origin, in residence currency) + transport + VAT(residence)
 *
 * No regional registration taxes, no CO2 malus, no local taxes.
 * The user can add these manually if they want a more precise total.
 */
export async function computeCrossBorder(
  comparison: ComparisonResult,
  residenceCountry: string
): Promise<CrossBorderRow[]> {
  const residence = COUNTRY_MAP[residenceCountry]
  if (!residence) {
    throw new Error(`Unsupported residence country: ${residenceCountry}`)
  }
  const residenceCurrency = residence.currency

  // Fetch dynamic FX rates
  const fxRates = await getFxRates()

  const rows: CrossBorderRow[] = comparison.quotes.map((quote) => {
    const origin = COUNTRY_MAP[quote.country]
    if (!origin || quote.totalNetPrice === 0) {
      return {
        originCountry: quote.country,
        originCountryName: quote.countryName,
        currency: residenceCurrency,
        htvaInOriginCurrency: 0,
        htvaInResidenceCurrency: 0,
        transportCost: 0,
        vatInResidence: 0,
        totalCost: 0,
        notes: [quote.warnings[0] ?? 'Not available'],
      }
    }

    // HTVA in origin currency
    const htvaInOriginCurrency = quote.totalNetPrice
    // HTVA converted to residence currency
    const htvaInResidenceCurrency = convertCurrency(
      htvaInOriginCurrency,
      quote.currency,
      residenceCurrency,
      fxRates
    )
    // Transport (origin → residence)
    const transportCost = estimateTransport(quote.country, residenceCountry)
    // VAT due in residence (on HTVA) - EU principle: VAT paid in residence country
    const vatInResidence = htvaInResidenceCurrency * residence.vatRate

    const totalCost = htvaInResidenceCurrency + transportCost + vatInResidence

    return {
      originCountry: quote.country,
      originCountryName: quote.countryName,
      currency: residenceCurrency,
      htvaInOriginCurrency,
      htvaInResidenceCurrency,
      transportCost,
      vatInResidence,
      totalCost,
      notes: [],
    }
  })

  // Filter out rows with no HTVA (errors / model not available)
  return rows.filter((r) => r.htvaInOriginCurrency > 0)
}
