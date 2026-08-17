// Type definitions for the BMW cross-border price comparison
// Atomic structure designed for clear filtering (one row per option, per country)

// ---------- BMW configuration (parsed from URL) ----------

export interface BmwConfigUrl {
  /** Source country TLD extracted from hostname: configure.bmw.{tld} → 'be' | 'nl' | ... */
  sourceCountry: string
  /** Locale: 'fr_BE' | 'nl_NL' | ... */
  locale: string
  /** Model range code, e.g. 'G80' for M3 sedan */
  modelRange: string
  /** AG model code, e.g. '31HJ' */
  modelCode: string
  /** Selected options, e.g. ['FLKSW', 'P0300', 'S01CB', ...] */
  selectedOptions: string[]
  /** Accessory IDs at the end of the URL path (e.g. 'EI0026CH') */
  accessories: string[]
  /** Original URL (kept for reference / debugging) */
  originalUrl: string
}

// ---------- BMW UCP API response shapes ----------

export interface BmwPrice {
  netListPrice: number
  netPrice: number
  grossListPrice: number
  grossListPriceUnrounded: number
  grossPrice: number
  grossPriceUnrounded: number
  totalTaxes: number
  taxes: Array<{
    taxCategory: string
    taxKey: string
    taxPercentage: number
    taxValue: number
    taxBase: number
  }>
  netDiscount?: number
  grossDiscount?: number
}

export interface BmwPriceTreeNode {
  effectivePrice: BmwPrice
  category: string
  /** Option code, present on leaf OPTION nodes (e.g. 'S01CB', 'FLKSW') */
  key?: string
  quantity: number
  subNodes?: BmwPriceTreeNode[]
}

export interface BmwFullPricingResponse {
  priceTreeNode: BmwPriceTreeNode
  invalidOptionCodes: string[]
  optionsWithUndefinedPrices: string[]
  invalidAccessoryIds: string[]
  accessoryWithUndefinedPrices: {
    accessoryHardware: unknown[]
    accessoryPriceOnRequest: unknown[]
    accessoryInstallation: unknown[]
  }
  metadata: {
    currency: string
    modelPriceType: string
    optionPriceType: string
    optionCombinationPriceType: string
  }
}

// ---------- Our normalized atomic shape ----------

export interface OptionPrice {
  /** BMW option code, e.g. 'S01CB', 'FLKSW' (paint), 'P0490' (rim), 'S07A2' (package) */
  code: string
  /** Net price (HTVA) in the country's currency. 0 means included in base model */
  netPrice: number
  /** Gross price (TTC) including VAT */
  grossPrice: number
  /** VAT rate applied, e.g. 0.21 for 21% */
  vatRate: number
  /** VAT amount */
  vatAmount: number
}

export interface BmwTax {
  taxCategory: string // PRODUCT | PROPORTIONAL_DUTY | DUTY
  taxKey: string // VAT | BTW | BPM | emission | DeliveryCosts | etc.
  taxPercentage: number
  taxValue: number
  taxBase: number
}

export interface CountryPriceQuote {
  /** ISO-2 lowercase country code: 'be', 'nl', 'de', ... */
  country: string
  /** Display name: 'Belgique', 'Pays-Bas', ... */
  countryName: string
  /** Currency code: 'EUR', 'CZK', 'DKK', 'HUF', 'PLN', 'SEK', 'NOK', 'CHF' */
  currency: string
  /** VAT rate applied in this country, e.g. 0.21 */
  vatRate: number
  /** When this quote was fetched */
  fetchedAt: string

  /** Base model price HTVA (without any option, without accessories) */
  baseNetPrice: number
  /** Base model price TTC */
  baseGrossPrice: number

  /** Per-option prices (atomic) - includes options with 0 price (included in base) */
  options: OptionPrice[]
  /** Sum of all option net prices (HTVA) - what BMW shows as "options price" */
  optionsNetTotal: number
  /** Sum of all option gross prices (TTC) */
  optionsGrossTotal: number

  /** Grand total vehicle + options HTVA = baseNetPrice + optionsNetTotal */
  totalNetPrice: number
  /** Grand total vehicle + options TTC = baseGrossPrice + optionsGrossTotal */
  totalGrossPrice: number

  /** All taxes applied (VAT + BPM + emission + delivery etc.) - atomic breakdown */
  taxes: BmwTax[]
  /** Sum of NON-VAT taxes (BPM, emission, delivery, etc.) - what locals pay extra */
  additionalTaxesTotal: number

  /** Number of options with non-zero price */
  paidOptionsCount: number
  /** Number of options included in base (price = 0) */
  includedOptionsCount: number

  /** Codes of options that BMW rejected (not available in this country) */
  invalidOptionCodes: string[]
  /** Codes of options that BMW has no price for in this country */
  optionsWithUndefinedPrices: string[]

  /** BMW API metadata */
  metadata: BmwFullPricingResponse['metadata']
  /** Warnings: invalid option codes, options without price, etc. */
  warnings: string[]
  /** Error category - distinguishes "model not available" from "technical error" */
  errorCategory?: 'model_not_available' | 'technical_error' | null
}

export interface ComparisonResult {
  config: BmwConfigUrl
  /** SHA-256 hash of sorted selected options (for caching) */
  configHash: string
  quotes: CountryPriceQuote[]
  /** When the comparison was generated */
  generatedAt: string
  /** Whether this result was served from cache */
  cached?: boolean
}

// ---------- Cross-border calculator ----------

export interface CrossBorderResult {
  /** Residence country code */
  residenceCountry: string
  /** Per-origin-country total cost if I live in residence and buy in origin */
  rows: CrossBorderRow[]
}

export interface CrossBorderRow {
  /** Origin country (where the car is purchased) */
  originCountry: string
  originCountryName: string
  currency: string
  /** HTVA price in origin country (in origin currency) */
  htvaInOriginCurrency: number
  /** HTVA price converted to residence currency */
  htvaInResidenceCurrency: number
  /** Transport cost estimate (origin → residence), in residence currency */
  transportCost: number
  /** VAT due in residence country (HTVA × residence VAT rate) */
  vatInResidence: number
  /** Total cost = htvaInResidenceCurrency + transport + vat */
  totalCost: number
  /** Notes (e.g. "Modèle non disponible") */
  notes: string[]
}

// ---------- Supported countries ----------

export interface CountryDef {
  code: string
  name: string
  tld: string
  locale: string
  vatRate: number
  currency: string
}

/**
 * All EU countries supported by the BMW UCP API.
 *
 * 25 pays sur 27 (CY, IE, MT ne proposent pas ce modèle - erreur "Model not found").
 * Source: testé le 2026-08-15 en appelant l'API BMW directement.
 *
 * IMPORTANT: Suisse (CH) et Norvège (NO) ne sont PAS dans l'UE - ils sont exclus
 * du comparateur même si l'API BMW les supporte, car le principe TVA cross-border
 * UE (article 138 directive 2006/112/CE) ne s'y applique pas.
 *
 * Note: l'API retourne `metadata.currency` par appel, on fait confiance à ça plutôt
 * qu'à cette liste (la devise ici est juste un fallback pour l'UI avant réponse API).
 */
export const SUPPORTED_COUNTRIES: CountryDef[] = [
  { code: 'be', name: 'Belgium',      tld: 'be', locale: 'fr_BE', vatRate: 0.21, currency: 'EUR' },
  { code: 'nl', name: 'Netherlands',  tld: 'nl', locale: 'nl_NL', vatRate: 0.21, currency: 'EUR' },
  { code: 'de', name: 'Germany',      tld: 'de', locale: 'de_DE', vatRate: 0.19, currency: 'EUR' },
  { code: 'fr', name: 'France',       tld: 'fr', locale: 'fr_FR', vatRate: 0.20, currency: 'EUR' },
  { code: 'es', name: 'Spain',        tld: 'es', locale: 'es_ES', vatRate: 0.21, currency: 'EUR' },
  { code: 'bg', name: 'Bulgaria',     tld: 'bg', locale: 'bg_BG', vatRate: 0.20, currency: 'EUR' },
  { code: 'at', name: 'Austria',      tld: 'at', locale: 'de_AT', vatRate: 0.20, currency: 'EUR' },
  { code: 'cz', name: 'Czechia',      tld: 'cz', locale: 'cs_CZ', vatRate: 0.21, currency: 'CZK' },
  { code: 'dk', name: 'Denmark',      tld: 'dk', locale: 'da_DK', vatRate: 0.25, currency: 'DKK' },
  { code: 'ee', name: 'Estonia',      tld: 'ee', locale: 'et_EE', vatRate: 0.24, currency: 'EUR' },
  { code: 'fi', name: 'Finland',      tld: 'fi', locale: 'fi_FI', vatRate: 0.26, currency: 'EUR' },
  { code: 'gr', name: 'Greece',       tld: 'gr', locale: 'el_GR', vatRate: 0.24, currency: 'EUR' },
  { code: 'hr', name: 'Croatia',      tld: 'hr', locale: 'hr_HR', vatRate: 0.25, currency: 'EUR' },
  { code: 'hu', name: 'Hungary',      tld: 'hu', locale: 'hu_HU', vatRate: 0.27, currency: 'HUF' },
  { code: 'it', name: 'Italy',        tld: 'it', locale: 'it_IT', vatRate: 0.22, currency: 'EUR' },
  { code: 'lt', name: 'Lithuania',    tld: 'lt', locale: 'lt_LT', vatRate: 0.21, currency: 'EUR' },
  { code: 'lu', name: 'Luxembourg',   tld: 'lu', locale: 'fr_LU', vatRate: 0.17, currency: 'EUR' },
  { code: 'lv', name: 'Latvia',       tld: 'lv', locale: 'lv_LV', vatRate: 0.21, currency: 'EUR' },
  { code: 'pl', name: 'Poland',       tld: 'pl', locale: 'pl_PL', vatRate: 0.23, currency: 'PLN' },
  { code: 'pt', name: 'Portugal',     tld: 'pt', locale: 'pt_PT', vatRate: 0.23, currency: 'EUR' },
  { code: 'ro', name: 'Romania',      tld: 'ro', locale: 'ro_RO', vatRate: 0.19, currency: 'EUR' },
  { code: 'se', name: 'Sweden',       tld: 'se', locale: 'sv_SE', vatRate: 0.25, currency: 'SEK' },
  { code: 'si', name: 'Slovenia',     tld: 'si', locale: 'sl_SI', vatRate: 0.22, currency: 'EUR' },
  { code: 'sk', name: 'Slovakia',     tld: 'sk', locale: 'sk_SK', vatRate: 0.23, currency: 'EUR' },
]

export const COUNTRY_MAP: Record<string, CountryDef> = Object.fromEntries(
  SUPPORTED_COUNTRIES.map((c) => [c.code, c])
)
