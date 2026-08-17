'use client'

import type { ComparisonResult, CountryPriceQuote } from '@/lib/types'

/**
 * Export comparison results as CSV
 */
export function exportCsv(result: ComparisonResult, fxRates: Record<string, number>): string {
  const headers = [
    'Country',
    'Code',
    'VAT (%)',
    'Currency',
    'Base ex-VAT',
    'Options ex-VAT',
    'Total ex-VAT',
    'Total inc-VAT',
    '≈ EUR',
    'Status',
    'Unavailable options',
    'No-price options',
  ]

  const rows = result.quotes.map((q) => {
    const eurEquiv = q.totalNetPrice * (fxRates[q.currency] ?? 1)
    const status =
      q.totalNetPrice > 0
        ? q.invalidOptionCodes.length + q.optionsWithUndefinedPrices.length > 0
          ? 'Partial'
          : 'OK'
        : q.errorCategory === 'model_not_available'
          ? 'N/A'
          : 'Error'
    return [
      q.countryName,
      q.country.toUpperCase(),
      (q.vatRate * 100).toFixed(0),
      q.currency,
      q.baseNetPrice.toFixed(2),
      q.optionsNetTotal.toFixed(2),
      q.totalNetPrice.toFixed(2),
      q.totalGrossPrice.toFixed(2),
      eurEquiv.toFixed(2),
      status,
      q.invalidOptionCodes.join(';'),
      q.optionsWithUndefinedPrices.join(';'),
    ]
  })

  const csv = [
    headers.join(','),
    ...rows.map((r) => r.map((cell) => `"${cell}"`).join(',')),
  ].join('\n')

  return csv
}

/**
 * Export comparison results as JSON
 */
export function exportJson(result: ComparisonResult): string {
  return JSON.stringify(result, null, 2)
}

/**
 * Download a string as a file
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Generate a filename based on the config
 */
export function generateFilename(result: ComparisonResult, extension: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `bmw-${result.config.modelRange}-${result.config.modelCode}-${date}.${extension}`
}
