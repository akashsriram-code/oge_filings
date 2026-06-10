# Trump Index Dashboard

Standalone Reuters dashboard for analyzing Donald J. Trump OGE disclosures from January 1, 2015 onward. The first screen is the Trump Index: a ranked, cited exposure signal built from disclosed assets, income rows, liabilities, holdings estimates, transactions, filings, public-source security enrichment, and source reliability badges.

## Run

```bash
npm install
npm run ingest:trump-oge
npm run dev
```

Open `http://127.0.0.1:3000`.

## Data Refresh

The daily GitHub Action in `.github/workflows/trump-oge-refresh.yml` refreshes the cache and deploys GitHub Pages:

- pages the OGE public disclosure API,
- filters Donald J. Trump records from January 1, 2015 onward,
- fingerprints OGE PDFs with SHA-256,
- registers older official, archived-copy, and request-only historical sources,
- bootstraps structured transaction rows from Open Cabinet,
- parses the latest annual 278e Part 6 and Part 8 text into asset/income rows, baseline holdings, and liabilities with review flags,
- enriches public-company securities from SEC and Nasdaq Trader reference data,
- builds Trump Index entries and sector/asset rollups,
- builds an event overlay from Federal Register tariff/trade records, FOMC calendar entries, and optional curated manual events,
- writes versioned cache files under `data/oge/trump/`,
- runs tests, build, and Playwright smoke checks,
- commits cache changes when the data changes,
- builds a static Next.js export under `out/`,
- uploads and deploys that artifact with GitHub Pages.

In GitHub repository settings, set Pages source to **GitHub Actions**. The Pages build uses `NEXT_PUBLIC_BASE_PATH=/<repo-name>`, so project pages work at the repository path. The dashboard exports XLSX workbooks in the browser, which keeps export working on static hosting.

## OpenArena API

GitHub Pages hosts the static dashboard. The live natural-language query endpoint is the Vercel App Router route at `app/api/ask/route.ts`.

Set these Vercel environment variables:

```bash
OPENARENA_BEARER_TOKEN=...
OPENARENA_TRUMP_INDEX_WORKFLOW_ID=...
OPENARENA_BASE_URL=https://aiopenarena.thomsonreuters.com
OPENARENA_API_SHARED_SECRET=...
```

Set `NEXT_PUBLIC_OPENARENA_API_BASE=https://<your-vercel-host>` in the GitHub Pages build environment if the Ask panel should call the Vercel API from the static dashboard.

## Data Notes

OGE values are disclosed as statutory ranges. Midpoint totals are estimates, not exact trade or portfolio values.

The Trump Index score is 50% log-scaled current midpoint exposure rank, 30% absolute midpoint change rank, and 20% gross transaction activity rank. Confidence and source reliability are displayed beside the score but do not reduce the score.

The latest annual 278e text parser populates baseline holdings and liabilities conservatively. Rows with parser review flags, missing baseline matches, ambiguous asset types, archived-copy sources, metadata-only sources, or low-confidence sector labels are surfaced in the review queue and audit sheets.

The event overlay is proximity analysis only. Automated events come from public Federal Register and Federal Reserve sources; Reuters-curated context can be added to `data/oge/trump/manual-events.json` with source links. Event proximity does not imply motive, coordination, or causation.

## Verify

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
```
