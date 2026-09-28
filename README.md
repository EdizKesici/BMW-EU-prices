# BMW EU Prices

Compare ex-VAT prices of BMW configurations across 24 EU countries. Find the cheapest country to buy your BMW.

**Live demo:** https://bmw-eu-prices.vercel.app

## How it works

When you buy a new car in another EU country, you pay VAT in your country of **residence**, not in the country of purchase. This means manufacturers set different ex-VAT prices per country - the same BMW can cost €10,000 less ex-VAT in Hungary than in France.

This tool fetches prices directly from the BMW UCP API (`prod.ucp.bmw.cloud`) - the same backend used by the official BMW configurator. Prices are accurate to the nearest euro.

## Features

- **24 EU countries** supported (BE, NL, DE, FR, ES, BG, AT, CZ, DK, EE, FI, GR, HR, HU, IT, LT, LU, LV, PL, PT, RO, SE, SI, SK)
- **Price map** — color-coded choropleth with hover details (MapLibre GL + OpenFreeMap)
- **Cross-border calculator** — total cost if you buy in country X and live in country Y
- **Real-time exchange rates** (ECB rates via frankfurter.dev)
- **History** — save configurations with custom labels (localStorage)
- **Export** — CSV and JSON
- **Dark mode** — premium black + BMW M signature accents

## Quick start

### Prerequisites

- Node.js 20+ (tested on Node 22)
- npm 10+

### Local development

```bash
npm install
npm run dev
```

Then open http://localhost:3000

### Production build

```bash
npm run build
npm start
```

## Usage

1. Go to the [BMW configurator](https://www.bmw.be/fr_BE/configure.html) and configure your car
2. Copy the URL from your browser's address bar
3. Paste it into BMW EU Prices and click **Compare**
4. Switch between **Table**, **Map**, and **Cross-border** tabs

### Cross-border calculator

Select your residence country to see the total cost of buying in each EU country:
- Ex-VAT price (converted to your currency)
- Transport estimate (€0.80/km between capitals)
- VAT of your residence country


## Tech stack

- **Next.js 16** (App Router)
- **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui**
- **MapLibre GL JS** + **react-map-gl** for the map (vector tiles via OpenFreeMap)
- **next-themes** for dark mode
- **Vercel** for hosting

## Design system

The UI follows the BMW corporate design language extracted from [bmw.com](https://www.bmw.com/):

## Data sources

- **Prices:** BMW UCP API (`prod.ucp.bmw.cloud`) — public API key embedded in the BMW configurator's JavaScript
- **Exchange rates:** [frankfurter.dev](https://frankfurter.dev) (ECB daily rates)
- **Map tiles:** [OpenFreeMap](https://openfreemap.org) — Positron (light) / Dark styles, no API key, no quota, no cookies (RGPD-friendly)

## Limitations

- 24 EU countries (Cyprus, Ireland, Malta excluded — BMW doesn't offer enough models there)
- Prices are valid for today and may change
- Cross-border transport estimate is approximate (€0.80/km between capitals)

## License

MIT
