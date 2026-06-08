# Trump OGE Filings Dashboard

Standalone Reuters dashboard for analyzing Trump-related OGE filings from January 2025 onward.

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
- filters Donald J. Trump records from January 1, 2025 onward,
- fingerprints OGE PDFs with SHA-256,
- bootstraps structured transaction rows from Open Cabinet,
- enriches public-company securities from SEC and Nasdaq Trader reference data,
- builds an event overlay from Federal Register tariff/trade records, FOMC calendar entries, and optional curated manual events,
- writes versioned cache files under `data/oge/trump/`,
- runs tests, build, and Playwright smoke checks,
- commits cache changes when the data changes,
- builds a static Next.js export under `out/`,
- uploads and deploys that artifact with GitHub Pages.

In GitHub repository settings, set Pages source to **GitHub Actions**. The Pages build uses `NEXT_PUBLIC_BASE_PATH=/<repo-name>`, so project pages work at the repository path. The dashboard exports XLSX workbooks in the browser, which keeps export working on static hosting.

## Data Notes

OGE transaction values are disclosed as statutory ranges. Midpoint totals are estimates, not exact trade values.

The current holdings view is transaction-implied until the annual 278e baseline is extracted and reviewed. Rows with missing baseline matches, ambiguous asset types, or low-confidence sector labels are surfaced in the review queue.

The event overlay is proximity analysis only. Automated events come from public Federal Register and Federal Reserve sources; Reuters-curated context can be added to `data/oge/trump/manual-events.json` with source links. Event proximity does not imply motive, coordination, or causation.

## Verify

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
```
