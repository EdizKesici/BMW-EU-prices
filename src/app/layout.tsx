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
  title: "BMW EU Prices - Compare ex-VAT prices across EU countries",
  description: "Compare ex-VAT prices of BMW configurations across 24 EU countries. Find the cheapest country to buy your BMW.",
  keywords: ["BMW", "price", "ex-VAT", "cross-border", "EU", "comparator"],
  authors: [{ name: "Ediz" }],
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
