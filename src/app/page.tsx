'use client'

import { useState, useMemo, useEffect } from 'react'
import { Loader2, Search, AlertCircle, ExternalLink, ChevronDown, ChevronRight, Download, History, Trash2, X, Map as MapIcon, Table as TableIcon, Calculator, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { ComparisonResult, CountryPriceQuote, CrossBorderRow } from '@/lib/types'
import { SUPPORTED_COUNTRIES, COUNTRY_MAP } from '@/lib/types'
import { computeCrossBorder, FALLBACK_FX_TO_EUR } from '@/lib/crossborder'
import { exportCsv, exportJson, downloadFile, generateFilename } from '@/lib/export'
import { useHistory } from '@/hooks/use-history'
import { ThemeToggle } from '@/components/theme-toggle'
import { PriceMap } from '@/components/price-map'

const EXAMPLE_URL =
  'https://configure.bmw.be/fr_BE/configure/G09/31CS/FVCDA,P0C36,S01CB,S01DF,S01DZ,S0230,S02PA,S02T4,S02TB,S02VB,S02VC,S02VW,S0302,S0322,S0323,S03DN,S03M2,S03PS,S0420,S0423,S0428,S044A,S0453,S04FL,S04HA,S04HB,S04LW,S04MA,S04T2,S04T7,S04U8,S04U9,S04UR,S04V1,S0548,S05AC,S05AL,S05AU,S05AV,S05DN,S0654,S06AE,S06AF,S06AK,S06C4,S06F1,S06NX,S06PA,S06U3,S07CG,S07M9,S07ME,S07RS,S0851,S0886,S08KA,S08R3,S08R9,S08S3,S08WM,S08WN,S0925/EI0026F2,EI0026XW,EI0027VQ,SE000034'

type SortKey = 'totalNet' | 'baseNet' | 'optionsNet' | 'country'

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('totalNet')
  const [residence, setResidence] = useState('be')
  const [fxRates, setFxRates] = useState<Record<string, number>>(FALLBACK_FX_TO_EUR)
  const [fxIsFallback, setFxIsFallback] = useState(true)
  const [crossBorderRows, setCrossBorderRows] = useState<CrossBorderRow[]>([])
  const [crossBorderLoading, setCrossBorderLoading] = useState(false)
  const [labelDialogOpen, setLabelDialogOpen] = useState(false)
  const [pendingLabel, setPendingLabel] = useState('')
  const { history, addEntry, removeEntry, clearHistory, loaded: historyLoaded } = useHistory()

  // Fetch FX rates on mount
  useEffect(() => {
    fetch('/api/fx')
      .then((r) => r.json())
      .then((data) => {
        if (data.rates) {
          setFxRates(data.rates)
          setFxIsFallback(data.isFallback ?? true)
        }
      })
      .catch(() => {
        // Keep fallback rates
      })
  }, [])

  async function handleCompare(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) {
      setError('Please paste a BMW configuration URL')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(
        `/api/pricing?configUrl=${encodeURIComponent(url.trim())}`
      )
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `Error ${res.status}`)
      }
      setResult(data as ComparisonResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Sorted quotes (ex-VAT comparison tab) - uses dynamic FX rates
  const sortedQuotesEur = useMemo(() => {
    if (!result) return []
    const withEur = result.quotes.map((q) => ({
      q,
      totalEur: q.totalNetPrice * (fxRates[q.currency] ?? 1),
      baseEur: q.baseNetPrice * (fxRates[q.currency] ?? 1),
      optionsEur: q.optionsNetTotal * (fxRates[q.currency] ?? 1),
    }))
    withEur.sort((a, b) => {
      if (a.q.totalNetPrice === 0 && b.q.totalNetPrice === 0)
        return a.q.country.localeCompare(b.q.country)
      if (a.q.totalNetPrice === 0) return 1
      if (b.q.totalNetPrice === 0) return -1
      if (sortBy === 'country') return a.q.country.localeCompare(b.q.country)
      const va = sortBy === 'totalNet' ? a.totalEur : sortBy === 'baseNet' ? a.baseEur : sortBy === 'optionsNet' ? a.optionsEur : 0
      const vb = sortBy === 'totalNet' ? b.totalEur : sortBy === 'baseNet' ? b.baseEur : sortBy === 'optionsNet' ? b.optionsEur : 0
      return va - vb
    })
    return withEur.map((x) => x.q)
  }, [result, sortBy, fxRates])

  const cheapestCountry = sortedQuotesEur[0] ?? null

  // Recompute cross-border whenever result or residence changes
  useEffect(() => {
    if (!result) {
      setCrossBorderRows([])
      return
    }
    setCrossBorderLoading(true)
    computeCrossBorder(result, residence)
      .then((rows) => setCrossBorderRows(rows))
      .catch(() => setCrossBorderRows([]))
      .finally(() => setCrossBorderLoading(false))
  }, [result, residence])

  const cheapestCrossBorder = crossBorderRows.length > 0
    ? [...crossBorderRows].sort((a, b) => a.totalCost - b.totalCost)[0]
    : null

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              BMW EU Prices
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Compare ex-VAT prices of BMW configurations across {SUPPORTED_COUNTRIES.length} EU countries.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href="/how-it-works" className="flex items-center gap-1">
                <Info className="h-4 w-4" />
                <span className="hidden sm:inline">How it works</span>
              </a>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Paste a BMW configurator URL, then click Compare.
          </p>
          <a
            href="https://www.bmw.be/fr_BE/configure.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Open BMW configurator
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. BMW Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCompare} className="flex gap-2">
              <Input
                type="url"
                placeholder={EXAMPLE_URL}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 font-mono text-xs"
                aria-label="BMW configuration URL"
              />
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Comparaison ({SUPPORTED_COUNTRIES.length} pays)...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Compare
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  2. Detected configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Field label="Series" value={result.config.modelRange} />
                  <Field label="Model code" value={result.config.modelCode} />
                  <Field
                    label="Source country"
                    value={result.config.sourceCountry.toUpperCase()}
                  />
                  <Field
                    label="Options"
                    value={`${result.config.selectedOptions.length} selected`}
                  />
                  <Field
                    label="Accessories"
                    value={
                      result.config.accessories.length > 0
                        ? `${result.config.accessories.length}`
                        : 'none'
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-1 mt-3">
                  {result.config.selectedOptions.slice(0, 25).map((opt) => (
                    <Badge key={opt} variant="secondary" className="font-mono text-[10px]">
                      {opt}
                    </Badge>
                  ))}
                  {result.config.selectedOptions.length > 25 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{result.config.selectedOptions.length - 25} more
                    </Badge>
                  )}
                </div>
                {result.cached && (
                  <p className="text-[11px] text-muted-foreground italic mt-2">
                    Result served from cache (24h).
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-2">
                  {result.quotes.filter((q) => q.totalNetPrice > 0).length} /{' '}
                  {result.quotes.length} countries returned a valid price. The others
                  do not offer this model.
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPendingLabel(`BMW ${result.config.modelRange} ${result.config.modelCode}`)
                      setLabelDialogOpen(true)
                    }}
                  >
                    <History className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const csv = exportCsv(result, fxRates)
                      downloadFile(csv, generateFilename(result, 'csv'), 'text/csv')
                    }}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const json = exportJson(result)
                      downloadFile(json, generateFilename(result, 'json'), 'application/json')
                    }}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    JSON
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="htva" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="htva" className="flex items-center gap-1">
                  <TableIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">Table</span>
                </TabsTrigger>
                <TabsTrigger value="map" className="flex items-center gap-1">
                  <MapIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">Map</span>
                </TabsTrigger>
                <TabsTrigger value="crossborder" className="flex items-center gap-1">
                  <Calculator className="h-3 w-3" />
                  <span className="hidden sm:inline">Cross-border</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="htva" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      3. Ex-VAT prices by country
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
                      <span className="text-muted-foreground">Sort by:</span>
                      <SortButton active={sortBy === 'totalNet'} onClick={() => setSortBy('totalNet')}>
                        Total ex-VAT
                      </SortButton>
                      <SortButton active={sortBy === 'baseNet'} onClick={() => setSortBy('baseNet')}>
                        Base price
                      </SortButton>
                      <SortButton active={sortBy === 'optionsNet'} onClick={() => setSortBy('optionsNet')}>
                        Options price
                      </SortButton>
                      <SortButton active={sortBy === 'country'} onClick={() => setSortBy('country')}>
                        Country (A-Z)
                      </SortButton>
                    </div>

                    <HtvaComparisonTable
                      quotes={sortedQuotesEur}
                      cheapestCountry={cheapestCountry}
                      fxRates={fxRates}
                    />

                    <div className="mt-4 text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong>Note 1:</strong> Countries marked &quot;Partial&quot; have one or more options not available
                        in that country. See details for the list.
                      </p>
                      <p>
                        <strong>Note 2:</strong> Accessories (EI* codes) from the URL are included in the price.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="map" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      3. Price map (ex-VAT, ≈ EUR)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PriceMap quotes={result.quotes} fxRates={fxRates} />
                    <div className="mt-4 text-xs text-muted-foreground">
                      <p>
                        Green = cheapest, red = most expensive. Hover for details.
                        
                      </p>
                      <p className="mt-1">
                        
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="crossborder" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      3. Total cost if I live in...
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <span className="text-sm text-muted-foreground">Residence country:</span>
                      <Select value={residence} onValueChange={setResidence}>
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPORTED_COUNTRIES.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.name} ({(c.vatRate * 100).toFixed(0)}% VAT)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <CrossBorderTable
                      rows={crossBorderRows}
                      cheapest={cheapestCrossBorder}
                      residenceName={COUNTRY_MAP[residence]?.name ?? residence}
                      loading={crossBorderLoading}
                    />

                    <div className="mt-4 text-xs text-muted-foreground space-y-1">
                      <p>
                        <strong>Formula:</strong> Total cost = ex-VAT (origin country, converted to residence currency)
                        + transport + VAT (residence country).
                      </p>
                      <p>
                        <strong>Transport:</strong> estimated at EUR 0.80/km (open truck, 1 car) between capitals.
                        Actual quotes range EUR 0.50-1.20/km depending on open/closed, consolidation, season.
                      </p>
                      <p>
                        <strong>Not included:</strong> regional registration taxes (TMC BE, BPM NL, ISV PT, etc.),
                        CO2 malus (BE/FR), dealer fees. Add manually based on your situation.
                      </p>
                      {fxIsFallback && (
                        <p className="text-amber-700 dark:text-amber-400">
                          <strong>Warning:</strong> fallback exchange rates (FX API unavailable).
                          EUR amounts may be slightly off.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}

        {!result && !loading && !error && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-muted-foreground">
              <p className="text-sm">
                No comparison to display. Paste a BMW URL above
                then click Compare.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* History section */}
      {historyLoaded && history.length > 0 && (
        <section className="max-w-6xl w-full mx-auto px-4 pb-8">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="h-4 w-4" />
                  History ({history.length})
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={clearHistory}>
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.map((entry) => {
                  const date = new Date(entry.timestamp)
                  const dateStr = date.toLocaleDateString('en-IE', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 p-2 rounded-md border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{entry.label}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {entry.cheapestCountry.toUpperCase()} · {entry.cheapestPrice.toFixed(0)} €
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {dateStr} · {entry.modelRange}/{entry.modelCode} · from {entry.country.toUpperCase()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setUrl(entry.url)
                            // Trigger comparison
                            const form = document.querySelector('form') as HTMLFormElement | null
                            form?.requestSubmit()
                          }}
                          className="h-7 px-2"
                        >
                          <Search className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeEntry(entry.id)}
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Label dialog for saving to history */}
      <Dialog open={labelDialogOpen} onOpenChange={setLabelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save dans l&apos;historique</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Give this configuration a custom name to find it easily later.
            </p>
            <Input
              value={pendingLabel}
              onChange={(e) => setPendingLabel(e.target.value)}
              placeholder="e.g. BMW 530e, blue"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setLabelDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (result && pendingLabel.trim()) {
                    const cheapest = [...result.quotes]
                      .filter((q) => q.totalNetPrice > 0)
                      .sort((a, b) => {
                        const eurA = a.totalNetPrice * (fxRates[a.currency] ?? 1)
                        const eurB = b.totalNetPrice * (fxRates[b.currency] ?? 1)
                        return eurA - eurB
                      })[0]
                    if (cheapest) {
                      addEntry({
                        label: pendingLabel.trim(),
                        url: result.config.originalUrl,
                        modelRange: result.config.modelRange,
                        modelCode: result.config.modelCode,
                        country: result.config.sourceCountry,
                        cheapestCountry: cheapest.country,
                        cheapestPrice:
                          cheapest.totalNetPrice * (fxRates[cheapest.currency] ?? 1),
                        currency: 'EUR',
                      })
                    }
                  }
                  setLabelDialogOpen(false)
                  setPendingLabel('')
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="font-mono text-sm font-medium mt-1">{value}</div>
    </div>
  )
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      className="h-7 px-2 text-xs"
    >
      {children}
    </Button>
  )
}

// ---------- Ex-VAT comparison table ----------

function HtvaComparisonTable({
  quotes,
  cheapestCountry,
  fxRates,
}: {
  quotes: CountryPriceQuote[]
  cheapestCountry: CountryPriceQuote | null
  fxRates: Record<string, number>
}) {
  // Compute the EUR-equivalent minimum for delta display (kept as comment)
  const minTotalEur = quotes.reduce(
    (min, q) => {
      const eur = q.totalNetPrice * (fxRates[q.currency] ?? 1)
      return eur > 0 && eur < min ? eur : min
    },
    Number.POSITIVE_INFINITY
  )

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Country</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Currency</TableHead>
              <TableHead className="text-right">Base ex-VAT</TableHead>
              <TableHead className="text-right">Options ex-VAT</TableHead>
              <TableHead className="text-right">Total ex-VAT</TableHead>
              <TableHead className="text-right">≈ EUR</TableHead>
              <TableHead className="text-right">difference</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((q) => {
              const isCheapest =
                cheapestCountry?.country === q.country && q.totalNetPrice > 0
              const totalEur = q.totalNetPrice * (fxRates[q.currency] ?? 1)
              const delta = totalEur > 0 ? totalEur - minTotalEur : null
              const hasError = q.errorCategory !== null && q.errorCategory !== undefined
              const isModelNotAvailable = q.errorCategory === 'model_not_available'
              const fmt = makeFormatter(q.currency)
              return (
                <TableRow
                  key={q.country}
                  className={isCheapest ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span className="uppercase text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                        {q.country}
                      </span>
                      <span className="hidden sm:inline">{q.countryName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {(q.vatRate * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {q.currency}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {q.baseNetPrice > 0 ? fmt.format(q.baseNetPrice) : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {q.optionsNetTotal > 0 ? (
                      <span>
                        {fmt.format(q.optionsNetTotal)}
                        <span className="text-[10px] text-muted-foreground ml-1">
                          ({q.paidOptionsCount})
                        </span>
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {q.totalNetPrice > 0 ? fmt.format(q.totalNetPrice) : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {totalEur > 0 ? `≈ ${eurFmt.format(totalEur)}` : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {delta !== null && delta > 0.5 ? (
                      <span className="text-red-600 dark:text-red-400">
                        +{eurFmt.format(delta)}
                      </span>
                    ) : delta !== null && Math.abs(delta) < 0.5 ? (
                      <Badge variant="default" className="bg-emerald-600">
                        MIN
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {hasError ? (
                      <Badge
                        variant={isModelNotAvailable ? 'secondary' : 'destructive'}
                        className="text-[10px]"
                        title={q.warnings[0]}
                      >
                        {isModelNotAvailable ? 'N/A' : 'Error'}
                      </Badge>
                    ) : q.invalidOptionCodes.length > 0 || q.optionsWithUndefinedPrices.length > 0 ? (
                      <Badge variant="outline" className="text-[10px]">
                        Partial ({q.invalidOptionCodes.length + q.optionsWithUndefinedPrices.length})
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        OK
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Missing options detail */}
      {quotes.some((q) => q.invalidOptionCodes.length > 0 || q.optionsWithUndefinedPrices.length > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Show missing options by country
          </summary>
          <div className="mt-2 space-y-2 max-h-96 overflow-y-auto">
            {quotes
              .filter((q) => q.invalidOptionCodes.length > 0 || q.optionsWithUndefinedPrices.length > 0)
              .map((q) => (
                <div key={q.country} className="border-l-2 pl-2 py-1 border-muted">
                  <span className="font-mono uppercase text-[10px] bg-muted px-1.5 py-0.5 rounded mr-2">
                    {q.country}
                  </span>
                  {q.invalidOptionCodes.length > 0 && (
                    <span className="text-amber-700 dark:text-amber-400 mr-3">
                      Unavailable ({q.invalidOptionCodes.length}): {q.invalidOptionCodes.slice(0, 8).join(', ')}
                      {q.invalidOptionCodes.length > 8 ? '...' : ''}
                    </span>
                  )}
                  {q.optionsWithUndefinedPrices.length > 0 && (
                    <span className="text-blue-700 dark:text-blue-400">
                      No price ({q.optionsWithUndefinedPrices.length}): {q.optionsWithUndefinedPrices.slice(0, 8).join(', ')}
                      {q.optionsWithUndefinedPrices.length > 8 ? '...' : ''}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ---------- Cross-border table ----------

function CrossBorderTable({
  rows,
  cheapest,
  residenceName,
  loading,
}: {
  rows: CrossBorderRow[]
  cheapest: CrossBorderRow | null
  residenceName: string
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Calculating total cost...
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6">
        No origin countries available for this configuration.
      </div>
    )
  }
  const sorted = [...rows].sort((a, b) => a.totalCost - b.totalCost)
  const fmt = makeFormatter(rows[0]?.currency ?? 'EUR')

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Bought in</TableHead>
              <TableHead className="text-right">ex-VAT (local)</TableHead>
              <TableHead className="text-right">ex-VAT in {rows[0]?.currency ?? 'EUR'}</TableHead>
              <TableHead className="text-right">Transport</TableHead>
              <TableHead className="text-right">VAT {residenceName}</TableHead>
              <TableHead className="text-right">Total cost</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => {
              const isCheapest = cheapest?.originCountry === row.originCountry
              const originFmt = makeFormatter(
                COUNTRY_MAP[row.originCountry]?.currency ?? 'EUR'
              )
              return (
                <TableRow
                  key={row.originCountry}
                  className={isCheapest ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span className="uppercase text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                        {row.originCountry}
                      </span>
                      <span className="hidden sm:inline">{row.originCountryName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {originFmt.format(row.htvaInOriginCurrency)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {fmt.format(row.htvaInResidenceCurrency)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {row.transportCost > 0 ? fmt.format(row.transportCost) : 'inclus'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmt.format(row.vatInResidence)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {isCheapest ? (
                      <Badge variant="default" className="bg-emerald-600 mr-1">
                        MIN
                      </Badge>
                    ) : null}
                    {fmt.format(row.totalCost)}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.notes.length > 0 ? (
                      <Badge variant="outline" className="text-[10px]">
                        Notes
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        OK
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Notes detail */}
      {sorted.some((r) => r.notes.length > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Show detailed notes by country
          </summary>
          <div className="mt-2 space-y-2">
            {sorted
              .filter((r) => r.notes.length > 0)
              .map((row) => (
                <div
                  key={row.originCountry}
                  className="border-l-2 pl-2 py-1 border-muted"
                >
                  <span className="font-mono uppercase text-[10px] bg-muted px-1.5 py-0.5 rounded mr-2">
                    {row.originCountry}
                  </span>
                  {row.notes.map((n, i) => (
                    <span key={i} className="text-muted-foreground">
                      {n}
                      {i < row.notes.length - 1 ? ' - ' : ''}
                    </span>
                  ))}
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ---------- Formatters ----------

const eurFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatterCache = new Map<string, Intl.NumberFormat>()

function makeFormatter(currency: string): Intl.NumberFormat {
  if (formatterCache.has(currency)) return formatterCache.get(currency)!
  let locale = 'en-IE'
  if (currency === 'CZK') locale = 'cs-CZ'
  else if (currency === 'DKK') locale = 'da-DK'
  else if (currency === 'HUF') locale = 'hu-HU'
  else if (currency === 'PLN') locale = 'pl-PL'
  else if (currency === 'SEK') locale = 'sv-SE'
  else if (currency === 'NOK') locale = 'nb-NO'
  else if (currency === 'CHF') locale = 'fr-CH'
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'HUF' ? 0 : 2,
  })
  formatterCache.set(currency, fmt)
  return fmt
}
