import type { MetadataRoute } from 'next'

// Auto-generated robots.txt — Next.js App Router convention.
// Served at /robots.txt, instructs crawlers (Googlebot, Bingbot, DuckDuckBot)
// on what they can crawl.
//
// - Allow everything except /api/* (API routes are not for crawlers)
// - Point to the sitemap for discovery
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api'],
    },
    sitemap: 'https://bmw-eu-prices.vercel.app/sitemap.xml',
  }
}