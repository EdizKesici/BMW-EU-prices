import type { MetadataRoute } from 'next'

// Auto-generated sitemap.xml — Next.js App Router convention.
// Served at /sitemap.xml, automatically picked up by Google Search Console
// and Bing Webmaster Tools.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://bmw-eu-prices.vercel.app'
  const now = new Date()

  return [
    {
      url: base,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${base}/how-it-works`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]
}