import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

// Hanken Grotesk is the closest free/OFL alternative to BMW Type Next Latin
// available on Google Fonts. It is a neo-grotesque drawn from the same
// lineage as Helvetica (Schweizer Haas Grotesk), giving the most BMW-like
// neutrality among Google Fonts options.
//
// Loaded via next/font/google, which self-hosts the font files at build time
// (no runtime request to fonts.googleapis.com → no tracking, no cookies,
// fully RGPD-compliant).
const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL('https://bmw-eu-prices.vercel.app'),
  title: 'BMW EU Prices — Compare ex-VAT prices across 24 EU countries',
  description: 'Compare ex-VAT prices of BMW configurations across 24 EU countries. Find the cheapest country to buy your BMW and calculate cross-border total cost.',
  keywords: ['BMW', 'price', 'ex-VAT', 'cross-border', 'EU', 'comparator', 'BMW configurator'],
  authors: [{ name: 'Ediz' }],
  alternates: {
    canonical: 'https://bmw-eu-prices.vercel.app',
  },
  openGraph: {
    title: 'BMW EU Prices',
    description: 'Compare ex-VAT prices of BMW configurations across 24 EU countries. Find the cheapest country to buy your BMW.',
    url: 'https://bmw-eu-prices.vercel.app',
    siteName: 'BMW EU Prices',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'BMW EU Prices',
    description: 'Compare ex-VAT prices of BMW configurations across 24 EU countries.',
  },
  robots: {
    index: true,
    follow: true,
  },
  // Verification tokens — fill in AFTER creating accounts on Google Search
  // Console and Bing Webmaster Tools (Phase 2 of the SEO setup).
  // Leave empty for now, deploy, then come back here with your tokens.
  verification: {
    google: '',
    other: {
      'msvalidate.01': '',
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${hankenGrotesk.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: '"Hanken Grotesk", system-ui, -apple-system, sans-serif' }}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}