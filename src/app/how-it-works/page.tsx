'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <h1 className="text-xl font-bold">How it works</h1>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">The principle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              In the EU, when you buy a new car in another member state, you don&apos;t pay
              VAT in the country of purchase. You pay it in your country of{' '}
              <strong>residence</strong>.
            </p>
            <p>
              The dealer sells you the car ex-VAT with an invoice marked &quot;VAT not
              collected - article 138 directive 2006/112/EC&quot;. You bring the car home,
              and pay local VAT upon registration.
            </p>
            <p>
              As a result, manufacturers set <strong>different ex-VAT prices</strong> per
              country. The same BMW can cost 10,000 EUR less ex-VAT in Hungary than in
              France. This tool lets you see these gaps in real time.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Where does the data come from?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Prices come directly from the BMW UCP API
              (<code className="text-xs bg-muted px-1 py-0.5 rounded">prod.ucp.bmw.cloud</code>),
              the same one used by the official BMW configurator
              (<code className="text-xs bg-muted px-1 py-0.5 rounded">configure.bmw.be</code>).
            </p>
            <p>
              The API key used is public - it is included in the BMW configurator&apos;s
              JavaScript code, downloaded by every visitor. We simply reuse the same key.
            </p>
            <p>
              Exchange rates come from the free API{' '}
              <a
                href="https://frankfurter.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                frankfurter.dev
              </a>{' '}
              (ECB daily rates, updated every 6 hours).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">What&apos;s included in the calculation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>The cross-border calculator includes:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Ex-VAT price of vehicle + options + accessories (from BMW)</li>
              <li>Conversion to your currency (real-time rates)</li>
              <li>Transport estimate (0.80 EUR/km between capitals)</li>
              <li>VAT of your residence country (EU principle, article 138)</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">What&apos;s NOT included</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>These elements are not calculated and must be added manually:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>
                <strong>Regional registration taxes</strong> (TMC Belgium, BPM Netherlands,
                ISV Portugal, NOVA Austria, etc.) - vary by region/country
              </li>
              <li>
                <strong>CO2 malus</strong> (Belgium, France) - calculated on registration
                based on WLTP emissions
              </li>
              <li>
                <strong>Dealer fees</strong> (variable, ~200-500 EUR)
              </li>
              <li>
                <strong>Transport insurance</strong> if you use a transport company
              </li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              Why aren&apos;t these taxes included? They vary by region (Flanders vs Wallonia
              vs Brussels in Belgium), personal situation (large families, etc.), and require
              precise WLTP data per configuration. Estimating them approximately would give a
              false sense of precision.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">FAQ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Why do some countries show &quot;N/A&quot;?</p>
              <p className="text-muted-foreground mt-1">
                BMW doesn&apos;t sell all models in all countries. For example, the BMW i5 (G60)
                is not available in Estonia, Finland, Lithuania, Latvia, or Sweden. The tool
                detects these cases automatically.
              </p>
            </div>
            <div>
              <p className="font-medium">Why do some countries show &quot;Error&quot;?</p>
              <p className="text-muted-foreground mt-1">
                Some countries (Estonia, Greece, Latvia, Lithuania) require BMW to compute
                CO2 emissions before pricing the car. For complex plug-in hybrid configurations,
                this preliminary call can fail. Try again later or use the other countries.
              </p>
            </div>
            <div>
              <p className="font-medium">Are the prices accurate?</p>
              <p className="text-muted-foreground mt-1">
                Yes, to the nearest euro. The ex-VAT prices shown are identical to those on
                the official BMW configurator, since we use the same data source. Any
                discrepancies (1-2 EUR) are due to VAT rounding.
              </p>
            </div>
            <div>
              <p className="font-medium">Can the dealer refuse to sell ex-VAT?</p>
              <p className="text-muted-foreground mt-1">
                Legally no (free movement of goods in the EU). In practice, some dealers refuse
                or discourage export sales. This is more common in countries with low margins.
                A direct phone call to the dealer is often more effective than an email.
              </p>
            </div>
            <div>
              <p className="font-medium">How long does transport take?</p>
              <p className="text-muted-foreground mt-1">
                3-10 business days depending on distance and transporter. Prices range from
                0.50 EUR to 1.20 EUR/km depending on truck type (open/closed), consolidation
                (grouped loading), and season.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Limitations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>24 EU countries supported (Cyprus, Ireland, and Malta excluded - BMW doesn&apos;t offer enough models there)</li>
              <li>Switzerland and Norway excluded (not in EU, different VAT principle)</li>
              <li>Prices are valid for today and may change</li>
            </ul>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button asChild>
            <Link href="/">Back to comparator</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
