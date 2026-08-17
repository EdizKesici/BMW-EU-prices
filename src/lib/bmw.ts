// BMW URL parser + UCP API client
// Calls the public BMW UCP API (prod.ucp.bmw.cloud) with the public API key
// embedded in the BMW configurator's JS bundle.

import { createHash } from 'node:crypto'
import {
  type BmwConfigUrl,
  type BmwFullPricingResponse,
  type BmwPriceTreeNode,
  type BmwTax,
  type CountryPriceQuote,
  type OptionPrice,
  type ComparisonResult,
  SUPPORTED_COUNTRIES,
} from './types'

// Public API key - extracted from configure.bmw.be's JS bundle
// (settings.APP.backend.settingsPricing.headers["x-api-key"])
// This key is shipped to every browser that visits the BMW configurator,
// so it is not secret in any meaningful sense.
const BMW_UCP_API_KEY = 'OmFpaEFpV0VUaUlrWTJ2Tnp0ZGdiUTd1NDhxR3JOcHRacXg1UWQK'
const BMW_UCP_BASE = 'https://prod.ucp.bmw.cloud'

// ---------- URL parsing ----------

/**
 * Parse a BMW configurator URL like:
 *   https://configure.bmw.be/fr_BE/configure/G80/31HJ/FLKSW,P0300,S01CB,.../EI0026CH
 *
 * Structure:
 *   /{locale}/configure/{range}/{model}/{comma-separated-options}[/{accessory-ids}]
 *
 * Extracts: source country, locale, model range, model code, selected options, accessories.
 */
export function parseBmwConfigUrl(rawUrl: string): BmwConfigUrl {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }

  // Hostname: configure.bmw.{tld} → extract tld
  const host = url.hostname // configure.bmw.be
  const match = host.match(/^configure\.bmw\.([a-z]{2})$/i)
  if (!match) {
    throw new Error(
      `Unrecognized hostname: ${host}. Expected: configure.bmw.{country} (e.g. configure.bmw.be)`
    )
  }
  const sourceCountry = match[1].toLowerCase()

  // Path: /{locale}/configure/{range}/{model}/{options}[/{accessories}]
  // Example: /fr_BE/configure/G80/31HJ/FLKSW,P0300,S01CB,S01DG,.../EI0026CH
  const pathParts = url.pathname.split('/').filter(Boolean)
  // pathParts: ['fr_BE', 'configure', 'G80', '31HJ', 'FLKSW,P0300,...', 'EI0026CH']
  if (pathParts.length < 4 || pathParts[1] !== 'configure') {
    throw new Error(
      `Invalid URL path. Expected: /{locale}/configure/{range}/{model}/{options}. Got: ${url.pathname}`
    )
  }

  const locale = pathParts[0]
  const modelRange = pathParts[2]
  const modelCode = pathParts[3]
  const optionsString = pathParts[4] ?? ''
  const accessoriesString = pathParts[5] ?? ''

  const selectedOptions = optionsString
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const accessories = accessoriesString
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    sourceCountry,
    locale,
    modelRange,
    modelCode,
    selectedOptions,
    accessories,
    originalUrl: rawUrl,
  }
}

/**
 * Compute a deterministic hash of a configuration (model + sorted options + accessories).
 * Used as cache key.
 */
export function configHash(config: BmwConfigUrl): string {
  const sorted = [...config.selectedOptions].sort().join(',')
  const sortedAcc = [...config.accessories].sort().join(',')
  const input = `${config.modelRange}|${config.modelCode}|${sorted}|${sortedAcc}`
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

// ---------- BMW UCP API call (POST full calculation) ----------

/**
 * Fetch the complete vehicle pricing (base + options + total) for a configuration
 * in a given country.
 *
 * Endpoint:
 *   POST /pricing/calculation/public-calculation/price-lists/{source},con/brands/{brand}/countries/{country}
 *
 * Two sources are tried in order:
 *   1. 'pcaso' (default for older models like M3 31HJ)
 *   2. 'sprint-cus' (newer models like G60 11FL - the i5/Series 5 hybrid line)
 *
 * The body must include settings, validityDates, and configuration with selectedOptions.
 *
 * IMPORTANT: For some countries (ES, NL, FI...), BMW requires `availableOptions` to be
 * populated (not empty) to compute local taxes like BPM (NL), emission (ES), co2 (FI/LT/LV).
 * Without these, BMW returns: "emission.wltp.co2Value cannot be null when used in
 * conditionGroups with operation:greaterEquals" (PRI_B_1004).
 *
 * We fetch `availableOptions` via the /localisations/.../options/ endpoint (cached 7 days
 * per model+country) before doing the pricing call.
 *
 * The response is a nested priceTreeNode where:
 *   - root = grand total (vehicle + options + duties)
 *   - MODEL_TOTAL = base vehicle price (without options)
 *   - OPTION_TOTAL > OTHER_OPTIONS > OPTION (key=code) = per-option prices
 */

// Cache: (country|modelCode) -> availableOptions[], TTL 7 days
// Available options rarely change (only when BMW adds new option codes for a model)
const availableOptionsCache = new Map<
  string,
  { options: string[]; expiresAt: number }
>()
const AVAILABLE_OPTIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Cache: (country|modelCode|sortedSelectedOptions) -> { options, source }, TTL 7 days
// Constructible options depend on the selected options (BMW may swap some codes per country)
const constructibleOptionsCache = new Map<
  string,
  { value: { options: string[]; source: string }; expiresAt: number }
>()

/**
 * Fetch all available option codes for a model in a country, for a given source.
 * Uses the /localisations/overridden-vehicle-data/.../options/ endpoint.
 */
async function fetchAvailableOptions(params: {
  country: string
  modelCode: string
  language: string
  effectDate: string
  orderDate: string
  source: string
}): Promise<string[]> {
  const cacheKey = `${params.country}|${params.modelCode}|${params.source}`
  const cached = availableOptionsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.options
  }

  const source = params.source
  const app = source === 'sprint-cus' ? 'connext-sprint' : 'connext'
  const url = `${BMW_UCP_BASE}/localisations/overridden-vehicle-data/sources/${source}/brands/bmwCar/countries/${params.country}/effect-dates/${params.effectDate}/order-dates/${params.orderDate}/applications/${app}/models/${params.modelCode}/options/languages/${params.language}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-api-key': BMW_UCP_API_KEY,
        Origin: `https://configure.bmw.${params.country}`,
        Referer: `https://configure.bmw.${params.country}/`,
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })
    if (!response.ok) {
      return []
    }
    const data = (await response.json()) as Record<string, unknown>
    const optionCodes = Object.keys(data)
    if (optionCodes.length > 0) {
      availableOptionsCache.set(cacheKey, {
        options: optionCodes,
        expiresAt: Date.now() + AVAILABLE_OPTIONS_TTL_MS,
      })
    }
    return optionCodes
  } catch {
    return []
  }
}

/**
 * Resolve the actual constructible options for a config in a country.
 *
 * BMW.es does this internally before calling the pricing endpoint:
 *   1. User selects options in the configurator
 *   2. Configurator calls /rulesolver/constructibility-check/ to filter out
 *      options that don't exist in this country (e.g. S0886 in ES becomes S0883)
 *   3. Only the filtered, constructible options are sent to the pricing endpoint
 *
 * If we skip this step, the pricing engine fails for countries with CO2-dependent
 * taxes (ES emission, NL BPM, FI co2, etc.) because it can't resolve the config.
 *
 * Returns the list of option codes that BMW accepts as constructible.
 */
async function fetchConstructibleOptions(params: {
  country: string
  modelCode: string
  selectedOptions: string[]
  effectDate: string
  orderDate: string
  source: string
}): Promise<{ options: string[]; source: string } | null> {
  const cacheKey = `construct|${params.country}|${params.modelCode}|${params.source}|${params.selectedOptions.sort().join(',')}`
  const cached = constructibleOptionsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const source = params.source
  const app = source === 'sprint-cus' ? 'connext-sprint' : 'connext'
  const includedElements = params.selectedOptions.join(',')
  const url = `${BMW_UCP_BASE}/rulesolver/constructibility-check/rule-sets/${source},con/brands/bmwCar/countries/${params.country}/effect-dates/${params.effectDate}/order-dates/${params.orderDate}/models/${params.modelCode}?included-elements=${includedElements}&mandatory-elements=&add-rules-for-mandatory-element-classes=fabric,paint,rim&excluded-elements=&application=${app}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-api-key': BMW_UCP_API_KEY,
        Origin: `https://configure.bmw.${params.country}`,
        Referer: `https://configure.bmw.${params.country}/`,
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as {
      constructible: boolean
      configuration?: { elements?: Record<string, { code: string }> }
    }
    const elements = data.configuration?.elements ?? {}
    const constructibleOptions = Object.values(elements).map((e) => e.code)
    if (constructibleOptions.length > 0) {
      const value = { options: constructibleOptions, source }
      constructibleOptionsCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + AVAILABLE_OPTIONS_TTL_MS,
      })
      return value
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Pre-warm the BMW backend for countries that require CO2/mass data to compute taxes.
 *
 * Some countries (EE, GR, LV, LT, etc.) fail with "emission.wltp.co2Value cannot be null"
 * unless BMW has already computed the WLTP/OTD data for this configuration+country.
 *
 * BMW configurator does this naturally by calling /otd/... and /garage/anon-configurations
 * before the pricing endpoint. We replicate this flow when needed.
 *
 * We do this for ALL countries (it's cheap, ~100ms) so we don't need to maintain a list.
 */
async function prewarmBackend(params: {
  country: string
  modelCode: string
  modelRange: string
  selectedOptions: string[]
  effectDate: string
  orderDate: string
}): Promise<void> {
  const cacheKey = `prewarm|${params.country}|${params.modelCode}|${params.selectedOptions.sort().join(',')}`
  // Simple dedup - don't prewarm the same config twice in the same session
  if (prewarmCache.has(cacheKey)) {
    return
  }
  prewarmCache.add(cacheKey)

  // Step 1: OTD call (returns technical specs, also caches CO2/mass on BMW's side)
  const otdUrl = `${BMW_UCP_BASE}/otd/country-groups/eu27+/ag-models/${params.modelCode}/validity-dates/${params.effectDate}/otd-for-configuration?included-options=${params.selectedOptions.join(',')}`
  try {
    await fetch(otdUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-api-key': BMW_UCP_API_KEY,
        Origin: `https://configure.bmw.${params.country}`,
        Referer: `https://configure.bmw.${params.country}/`,
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })
  } catch {
    // ignore - not critical
  }

  // Step 2: garage POST (creates an anonymous configuration, caches it on BMW's side)
  const garageBody = {
    configuration: {
      modelCode: params.modelCode,
      options: params.selectedOptions,
      accessories: {},
      effectDate: params.orderDate,
      orderDate: params.orderDate,
    },
    mandator: { modelRange: params.modelRange },
  }
  const garageUrl = `${BMW_UCP_BASE}/garage/applications/connext/brands/bmwCar/countries/${params.country}/anon-configurations`
  try {
    const garageBodyJson = JSON.stringify(garageBody)
    await fetch(garageUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': BMW_UCP_API_KEY,
        Origin: `https://configure.bmw.${params.country}`,
        Referer: `https://configure.bmw.${params.country}/`,
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Length': String(new TextEncoder().encode(garageBodyJson).length),
      },
      body: garageBodyJson,
      cache: 'no-store',
    })
  } catch {
    // ignore - not critical
  }
}

// In-process set to avoid duplicate prewarm calls
const prewarmCache = new Set<string>()

export async function fetchFullPricing(params: {
  country: string
  modelCode: string
  modelRange: string
  selectedOptions: string[]
  accessories: string[]
  language: string
  taxDate?: string
  effectDate?: string
}): Promise<BmwFullPricingResponse> {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  // Effect date is typically ~30 days in the future (production lead time)
  const effectDate =
    params.effectDate ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const taxDate = params.taxDate ?? today
  const orderDate = today

  // Try both sources (pcaso for older models, sprint-cus for newer G60/i5/etc.)
  // For each source, we do a constructibility-check first to filter out country-incompatible
  // option codes, then call pricing with the filtered options.
  const sources = ['pcaso', 'sprint-cus']
  let lastError: Error | null = null

  for (const source of sources) {
    // Step 1: fetch available options for this country+model+source (cached 7 days)
    const baseAvailableOptions = await fetchAvailableOptions({
      country: params.country,
      modelCode: params.modelCode,
      language: params.language,
      effectDate,
      orderDate,
      source,
    })

    // Step 2: resolve constructible options for this source
    const constructible = await fetchConstructibleOptions({
      country: params.country,
      modelCode: params.modelCode,
      selectedOptions: params.selectedOptions,
      effectDate,
      orderDate,
      source,
    })
    const effectiveSelectedOptions = constructible?.options ?? params.selectedOptions

    // Step 3: pre-warm BMW backend (OTD + garage) with the SAME options+dates
    // as the pricing call. Required for countries like EE, GR, LV, LT that compute
    // taxes based on CO2/mass - BMW caches this data keyed on (config, effectDate).
    await prewarmBackend({
      country: params.country,
      modelCode: params.modelCode,
      modelRange: params.modelRange,
      selectedOptions: effectiveSelectedOptions,
      effectDate,
      orderDate,
    })

    // Step 4: use availableOptions as-is (DO NOT merge with selectedOptions)
    const availableOptions = baseAvailableOptions

    const body = {
      settings: {
        priceTree: 'DEFAULT',
        ignoreInvalidOptionCodes: true,
        ignoreOptionsWithUndefinedPrices: true,
        roundingScale: 1,
        optimizedPriceDate: false,
        accessoriesMustFitConfiguration: false,
      },
      validityDates: {
        taxDate,
        effectDate,
      },
      configuration: {
        model: params.modelCode,
        selectedOptions: effectiveSelectedOptions,
        availableOptions,
      },
      // Pass accessories (EI*, SE*) from the URL - they're priced separately by BMW
      // and added to the vehicle total. Without them, prices are off by thousands of euros.
      selectedAccessories: params.accessories.map((id) => ({
        accessoryId: id,
        quantity: 1,
      })),
      additionalParams: {
        isVolt48Variant: { key: 'isVolt48Variant', value: true },
        applicationMode: { key: 'applicationMode', value: 'default' },
        ecoBonusEligibility: { key: 'ecoBonusEligibility', value: 'full' },
        ecoBonusScope: { key: 'ecoBonusScope', value: 'governmental' },
        newEcoBonusSolution: { key: 'newEcoBonusSolution', value: false },
        ecoBonusScrapping: { key: 'ecoBonusScrapping', value: 'none' },
      },
    }

    // Try with isVolt48Variant=true first (required for newer hybrid models like G60 i5)
    // If BMW returns 412 PRECONDITION_FAILED or 400 with CO2 error, retry with isVolt48Variant=false
    // (older non-hybrid models like M3 31HJ don't support isVolt48Variant=true)
    const bodyJson = JSON.stringify(body)
    const url = `${BMW_UCP_BASE}/pricing/calculation/public-calculation/price-lists/${source},con/brands/bmwCar/countries/${params.country}`

    const fetchWithParams = async (bodyStr: string) => {
      return fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'x-api-key': BMW_UCP_API_KEY,
          Origin: `https://configure.bmw.${params.country}`,
          Referer: `https://configure.bmw.${params.country}/`,
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Length': String(new TextEncoder().encode(bodyStr).length),
        },
        body: bodyStr,
        cache: 'no-store',
      })
    }

    let response = await fetchWithParams(bodyJson)

    // Check the response. If it's a "Model not found" or "Datasource not found",
    // don't retry with fallback params - these errors are model/country-specific
    // and retrying won't help. Just continue to the next source.
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      const isModelNotFound = errText.includes('Model not found') || errText.includes('No model with modelCode exists')
      const isDatasourceNotFound = errText.includes('Datasource not found')

      if (isModelNotFound) {
        // Model genuinely doesn't exist in this country - throw immediately
        throw new Error(
          `BMW UCP API error ${response.status} for country=${params.country} (source=${source}): ${errText.slice(0, 200)}`
        )
      }

      if (isDatasourceNotFound) {
        // This source doesn't exist for this country - try the other source
        lastError = new Error(
          `BMW UCP API error ${response.status} for country=${params.country} (source=${source}): ${errText.slice(0, 200)}`
        )
        continue
      }

      // For 412 PRECONDITION_FAILED or 400 with CO2 error, retry with isVolt48Variant=false
      // (older non-hybrid models like M3 31HJ don't support isVolt48Variant=true)
      const needsFallback =
        response.status === 412 ||
        errText.includes('emission.wltp.co2Value') ||
        errText.includes('Calculating tax')

      if (needsFallback) {
        const fallbackBody = {
          ...body,
          additionalParams: {
            isVolt48Variant: { key: 'isVolt48Variant', value: false },
            applicationMode: { key: 'applicationMode', value: 'default' },
            ecoBonusEligibility: { key: 'ecoBonusEligibility', value: 'full' },
            ecoBonusScope: { key: 'ecoBonusScope', value: 'governmental' },
            newEcoBonusSolution: { key: 'newEcoBonusSolution', value: false },
            ecoBonusScrapping: { key: 'ecoBonusScrapping', value: 'none' },
          },
        }
        const fallbackBodyJson = JSON.stringify(fallbackBody)
        response = await fetchWithParams(fallbackBodyJson)
      } else {
        // Other error - keep the response as-is (it will be processed below)
        // Re-create a response-like object since we consumed the body
        lastError = new Error(
          `BMW UCP API error ${response.status} for country=${params.country} (source=${source}): ${errText.slice(0, 200)}`
        )
        continue
      }
    }

    if (response.ok) {
      return (await response.json()) as BmwFullPricingResponse
    }

    const text = await response.text().catch(() => '<no body>')
    const err = new Error(
      `BMW UCP API error ${response.status} for country=${params.country} (source=${source}): ${text.slice(0, 200)}`
    )
    lastError = err
    // Try next source
  }

  throw lastError ?? new Error('Unknown BMW UCP error')
}

/**
 * Detect if an error message indicates the model is not available in the country.
 * BMW returns different error messages depending on the source and failure mode:
 *   - "Model not found for given vgModelCode" (pricing endpoint, pcaso)
 *   - "No model with modelCode exists in the datasource" (constructibility endpoint, pcaso)
 *   - "Datasource not found given source='sprint-cus'" (when sprint-cus doesn't exist for country)
 *
 * If pcaso says the model doesn't exist, the model is genuinely not available.
 * If only sprint-cus says "Datasource not found", we can't conclude (pcaso might still work).
 */
function isModelNotAvailableError(errMsg: string): boolean {
  return (
    errMsg.includes('Model not found') ||
    errMsg.includes('No model with modelCode exists') ||
    // BMW returns this when the country doesn't have the 'con' channel for this model
    // (meaning BMW doesn't sell this model in this country at all)
    errMsg.includes("There is no channel 'con' in the country")
  )
}

// ---------- Tree traversal helpers ----------

/**
 * Find the first node in the tree matching a category.
 */
function findNodeByCategory(
  node: BmwPriceTreeNode,
  category: string
): BmwPriceTreeNode | null {
  if (node.category === category) return node
  for (const sub of node.subNodes ?? []) {
    const found = findNodeByCategory(sub, category)
    if (found) return found
  }
  return null
}

/**
 * Find ALL nodes in the tree matching a category.
 */
function findAllNodesByCategory(
  node: BmwPriceTreeNode,
  category: string,
  results: BmwPriceTreeNode[] = []
): BmwPriceTreeNode[] {
  if (node.category === category) results.push(node)
  for (const sub of node.subNodes ?? []) {
    findAllNodesByCategory(sub, category, results)
  }
  return results
}

// ---------- Normalization ----------

/**
 * Extract atomic per-option prices from the price tree.
 * Walks OPTION_TOTAL > OTHER_OPTIONS > OPTION nodes to get each option's price.
 */
function extractOptionPrices(
  root: BmwPriceTreeNode,
  vatRate: number
): OptionPrice[] {
  const optionNodes = findAllNodesByCategory(root, 'OPTION')
  const options: OptionPrice[] = optionNodes
    .filter((n) => n.key) // only nodes with an option code
    .map((n) => ({
      code: n.key!,
      netPrice: n.effectivePrice.netPrice,
      grossPrice: n.effectivePrice.grossPrice,
      vatRate,
      vatAmount: n.effectivePrice.totalTaxes,
    }))
  // Sort by code for stable display
  options.sort((a, b) => a.code.localeCompare(b.code))
  return options
}

/**
 * Build a normalized CountryPriceQuote for a single country.
 */
export function buildQuote(
  country: (typeof SUPPORTED_COUNTRIES)[number],
  raw: BmwFullPricingResponse
): CountryPriceQuote {
  const root = raw.priceTreeNode

  // Base model price (without options)
  const modelNode = findNodeByCategory(root, 'MODEL_TOTAL')
  const baseNetPrice = modelNode?.effectivePrice.netPrice ?? 0
  const baseGrossPrice = modelNode?.effectivePrice.grossPrice ?? 0

  // Per-option prices (atomic)
  const options = extractOptionPrices(root, country.vatRate)

  // Options total (BMW displays this as "options price")
  const optionTotalNode = findNodeByCategory(root, 'OPTION_TOTAL')
  const optionsNetTotal = optionTotalNode?.effectivePrice.netPrice ?? 0
  const optionsGrossTotal = optionTotalNode?.effectivePrice.grossPrice ?? 0

  // Grand total = base + options (root net price)
  const totalNetPrice = root.effectivePrice.netPrice
  const totalGrossPrice = root.effectivePrice.grossPrice

  // All taxes (atomic): VAT + BPM + emission + delivery + register + recycle + ...
  const taxes: BmwTax[] = root.effectivePrice.taxes.map((t) => ({
    taxCategory: t.taxCategory,
    taxKey: t.taxKey,
    taxPercentage: t.taxPercentage,
    taxValue: t.taxValue,
    taxBase: t.taxBase,
  }))

  // Sum of NON-VAT taxes (BPM, emission, delivery, etc.) - hidden costs
  const additionalTaxesTotal = taxes
    .filter((t) => !isVatKey(t.taxKey))
    .reduce((sum, t) => sum + t.taxValue, 0)

  // Counts
  const paidOptionsCount = options.filter((o) => o.netPrice > 0).length
  const includedOptionsCount = options.length - paidOptionsCount

  // Warnings
  const warnings: string[] = []
  if (raw.invalidOptionCodes.length > 0) {
    warnings.push(
      `${raw.invalidOptionCodes.length} invalid option(s) for this country: ${raw.invalidOptionCodes.slice(0, 5).join(', ')}${raw.invalidOptionCodes.length > 5 ? '...' : ''}`
    )
  }
  if (raw.optionsWithUndefinedPrices.length > 0) {
    warnings.push(
      `${raw.optionsWithUndefinedPrices.length} option(s) without price in this country`
    )
  }

  return {
    country: country.code,
    countryName: country.name,
    currency: raw.metadata.currency,
    vatRate: country.vatRate,
    fetchedAt: new Date().toISOString(),
    baseNetPrice,
    baseGrossPrice,
    options,
    optionsNetTotal,
    optionsGrossTotal,
    totalNetPrice,
    totalGrossPrice,
    taxes,
    additionalTaxesTotal,
    paidOptionsCount,
    includedOptionsCount,
    invalidOptionCodes: raw.invalidOptionCodes,
    optionsWithUndefinedPrices: raw.optionsWithUndefinedPrices,
    metadata: raw.metadata,
    warnings,
    errorCategory: null,
  }
}

/**
 * Detect if a tax key is VAT (vs BPM, emission, etc.)
 * BMW uses different keys: VAT, BTW, vat, vat-S depending on country
 */
function isVatKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower === 'vat' || lower === 'btw' || lower.startsWith('vat-')
}

// ---------- Comparison orchestration ----------

/**
 * Compare a single BMW configuration across all supported countries.
 * Uses a concurrency limit of 6 to avoid being rate-limited by BMW's WAF.
 */
export async function compareConfigAcrossCountries(
  config: BmwConfigUrl
): Promise<ComparisonResult> {
  const concurrencyLimit = 6
  const quotes: CountryPriceQuote[] = []
  const errors: Array<{ country: string; err: unknown }> = []

  // Process countries in batches to avoid rate-limiting
  for (let i = 0; i < SUPPORTED_COUNTRIES.length; i += concurrencyLimit) {
    const batch = SUPPORTED_COUNTRIES.slice(i, i + concurrencyLimit)
    const batchResults = await Promise.all(
      batch.map(async (country) => {
        try {
          const raw = await fetchFullPricing({
            country: country.code,
            modelCode: config.modelCode,
            modelRange: config.modelRange,
            selectedOptions: config.selectedOptions,
            accessories: config.accessories,
            language: country.locale.split('_')[0],
          })
          return buildQuote(country, raw)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          // Distinguish "model not available in this country" vs "technical error"
          const isModelNotFound = isModelNotAvailableError(errMsg)
          const errorCategory: 'model_not_available' | 'technical_error' = isModelNotFound
            ? 'model_not_available'
            : 'technical_error'
          const friendlyMsg = isModelNotFound
            ? `Model not available in this country`
            : `Technical error: ${errMsg.slice(0, 150)}`
          return {
            country: country.code,
            countryName: country.name,
            currency: country.currency,
            vatRate: country.vatRate,
            fetchedAt: new Date().toISOString(),
            baseNetPrice: 0,
            baseGrossPrice: 0,
            options: [],
            optionsNetTotal: 0,
            optionsGrossTotal: 0,
            totalNetPrice: 0,
            totalGrossPrice: 0,
            taxes: [],
            additionalTaxesTotal: 0,
            paidOptionsCount: 0,
            includedOptionsCount: 0,
            invalidOptionCodes: [],
            optionsWithUndefinedPrices: [],
            metadata: {
              currency: country.currency,
              modelPriceType: '',
              optionPriceType: '',
              optionCombinationPriceType: '',
            },
            warnings: [friendlyMsg],
            errorCategory,
          } satisfies CountryPriceQuote
        }
      })
    )
    quotes.push(...batchResults)
  }

  return {
    config,
    configHash: configHash(config),
    quotes,
    generatedAt: new Date().toISOString(),
  }
}
