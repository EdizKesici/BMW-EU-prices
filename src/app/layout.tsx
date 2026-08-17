import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
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
        className={`${inter.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}
      >
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
