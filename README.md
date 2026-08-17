# BMW EU Prices

Compare ex-VAT prices of BMW configurations across 24 EU countries. Find the cheapest country to buy your BMW.

## How it works

When you buy a new car in another EU country, you pay VAT in your country of **residence**, not in the country of purchase. This means manufacturers set different ex-VAT prices per country - the same BMW can cost €10,000 less ex-VAT in Hungary than in France.

This tool fetches prices directly from the BMW UCP API (`prod.ucp.bmw.cloud`) - the same backend used by the official BMW configurator. Prices are accurate to the nearest euro.

## Features

- **24 EU countries** supported (BE, NL, DE, FR, ES, BG, AT, CZ, DK, EE, FI, GR, HR, HU, IT, LT, LU, LV, PL, PT, RO, SE, SI, SK)
- **Price map** - color-coded by price, hover for details
- **Cross-border calculator** - total cost if you buy in country X and live in country Y
- **Real-time exchange rates** (ECB rates via frankfurter.dev)
- **History** - save configurations with custom labels (localStorage)
- **Export** - CSV and JSON
- **Dark mode**

## Quick start

### Docker (recommended)

```bash
docker compose up --build
```

Then open http://localhost:3000

### Local development

```bash
bun install
bun run dev
```

Then open http://localhost:3000

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

**Not included:** regional registration taxes, CO2 malus, dealer fees. Add manually based on your situation.

## Tech stack

- **Next.js 16** (App Router, standalone output)
- **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui**
- **d3-geo** + **topojson** for the map
- **next-themes** for dark mode

## Data sources

- **Prices:** BMW UCP API (`prod.ucp.bmw.cloud`) - public API key embedded in the BMW configurator's JavaScript
- **Exchange rates:** [frankfurter.dev](https://frankfurter.dev) (ECB daily rates)
- **Map geometry:** [world-atlas](https://github.com/topojson/world-atlas) (50m resolution)

## Limitations
- 24 EU countries (Cyprus, Ireland, Malta excluded - BMW doesn't offer enough models there)
- Prices are valid for today and may change

## License

MIT
