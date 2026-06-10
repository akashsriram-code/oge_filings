import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { handleAskRequest } from '../lib/oge/ask';
import { parseOgeAmountRange } from '../lib/oge/amounts';
import { buildHoldingsEstimates } from '../lib/oge/analytics';
import { classifySecurity } from '../lib/oge/classify';
import {
  buildApiResponse,
  buildDashboardBootstrap,
  buildPageResponse,
  clearOgeJsonMemoForTests,
  loadTrumpOgeBootstrap,
  loadTrumpOgeDataset,
} from '../lib/oge/data';
import {
  broadSectorFromSic,
  buildSecurityReferenceCache,
  emptyEnrichmentFields,
  enrichTransactions,
  parseNasdaqSymbolDirectory,
  parseSecCompanyTickers,
} from '../lib/oge/enrichment';
import { buildEventWindows, eventWindowBounds, federalRegisterDocumentToEvent } from '../lib/oge/events';
import { filterTransactions } from '../lib/oge/filter';
import { buildTrumpIndex } from '../lib/oge/index';
import {
  buildPageResponseFromPostgres,
  isPostgresConfigured,
  loadTrumpOgeBootstrapFromPostgres,
} from '../lib/oge/postgres';
import { buildEquityStockSummaries, deriveEquityStockName } from '../lib/oge/stocks';
import type { BaselineHolding, OgeEvent, OgeTransaction, SourceFiling } from '../lib/oge/types';
import { buildTrumpOgeWorkbook } from '../lib/oge/workbook';

async function main() {
  testAmountParsing();
  testClassification();
  testSecurityEnrichment();
  testEquityStocks();
  testEventOverlay();
  testTrumpIndex();
  await testCacheShape();
  await testBootstrapCache();
  await testPageResponses();
  await testJsonMemoization();
  await testPostgresMigrationContract();
  await testPostgresDisabledFallback();
  await testFiltering();
  await testAskApiFallback();
  await testWorkbookExport();
  console.log('All tests passed.');
}

function testEquityStocks() {
  assert.equal(deriveEquityStockName('CLOUDFLARE INC CLASS A'), 'CLOUDFLARE');
  const stocks = buildEquityStockSummaries([
    {
      ...emptyEnrichmentFields(),
      id: '1',
      description: 'CLOUDFLARE INC CLASS A',
      normalizedDescription: 'CLOUDFLARE INC CLASS A',
      ticker: null,
      type: 'Purchase',
      date: '2026-03-30',
      amount: parseOgeAmountRange('$50,001-$100,000'),
      lateFilingFlag: true,
      sourceFilingId: null,
      sourceUrl: null,
      assetType: 'Equity',
      sector: 'Information Technology',
      classificationConfidence: 0.78,
      parserStatus: 'bootstrap-structured',
      reviewFlags: [],
    },
    {
      ...emptyEnrichmentFields(),
      id: '2',
      description: 'CLOUDFLARE INC CLASS A',
      normalizedDescription: 'CLOUDFLARE INC CLASS A',
      ticker: null,
      type: 'Sale',
      date: '2026-04-01',
      amount: parseOgeAmountRange('$15,001-$50,000'),
      lateFilingFlag: false,
      sourceFilingId: null,
      sourceUrl: null,
      assetType: 'Equity',
      sector: 'Information Technology',
      classificationConfidence: 0.78,
      parserStatus: 'bootstrap-structured',
      reviewFlags: [],
    },
  ]);
  assert.equal(stocks[0].stockName, 'Cloudflare');
  assert.equal(stocks[0].purchaseCount, 1);
  assert.equal(stocks[0].saleCount, 1);
  assert.equal(stocks[0].netDirection, 'Net buy');
}

function testSecurityEnrichment() {
  const secEntries = parseSecCompanyTickers({
    fields: ['cik', 'name', 'ticker', 'exchange'],
    data: [
      [100, 'Cloudflare, Inc.', 'NET', 'Nasdaq'],
      [200, 'Advance Auto Parts, Inc.', 'AAP', 'NYSE'],
      [300, 'Acme Corp', 'ACM', 'NYSE'],
      [301, 'Acme Holdings Inc.', 'ACMH', 'Nasdaq'],
      [400, 'First Horizon Corp', 'FHN', 'NYSE'],
      [401, 'First Horizon Corp Depositary Shares', 'FHN-PE', 'NYSE'],
    ],
  });
  const nasdaqEntries = parseNasdaqSymbolDirectory(
    'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nNET|Cloudflare, Inc. - Class A Common Stock|Q|N|N|100|N|N\n',
    'nasdaq-listed'
  );
  const sector = broadSectorFromSic('7372', 'Services-Prepackaged Software');
  const reference = buildSecurityReferenceCache({
    generatedAt: '2026-06-08T00:00:00.000Z',
    secEntries,
    nasdaqEntries,
    sicByCik: {
      '100': { sic: '7372', sicDescription: 'Services-Prepackaged Software', sector },
      '200': { sic: '5531', sicDescription: 'Retail-Auto & Home Supply Stores', sector: broadSectorFromSic('5531', 'Retail-Auto & Home Supply Stores') },
      '400': { sic: '6021', sicDescription: 'National Commercial Banks', sector: broadSectorFromSic('6021', 'National Commercial Banks') },
      '401': { sic: '6021', sicDescription: 'National Commercial Banks', sector: broadSectorFromSic('6021', 'National Commercial Banks') },
    },
    sources: [],
  });

  const resolved = enrichTransactions([
    makeTransaction({
      description: 'CLOUDFLARE INC CLASS A',
      normalizedDescription: 'CLOUDFLARE INC CLASS A',
      sector: 'Unclassified Equity',
      classificationConfidence: 0.62,
      reviewFlags: ['Needs sector review'],
    }),
  ], reference).transactions[0];
  assert.equal(resolved.resolvedTicker, 'NET');
  assert.equal(resolved.resolvedSector, 'Information Technology');
  assert.equal(resolved.sector, 'Information Technology');
  assert.ok(!resolved.reviewFlags.includes('Needs sector review'));

  const abbreviated = enrichTransactions([
    makeTransaction({
      description: 'ADVANCE AUTO PTS INC',
      normalizedDescription: 'ADVANCE AUTO PTS INC',
      sector: 'Unclassified Equity',
      classificationConfidence: 0.62,
      reviewFlags: ['Needs sector review'],
    }),
  ], reference).transactions[0];
  assert.equal(abbreviated.resolvedTicker, 'AAP');
  assert.equal(abbreviated.resolvedSector, 'Consumer Discretionary');

  const ambiguous = enrichTransactions([
    makeTransaction({
      description: 'ACME INC',
      normalizedDescription: 'ACME INC',
      sector: 'Unclassified Equity',
      classificationConfidence: 0.62,
      reviewFlags: ['Needs sector review'],
    }),
  ], reference).transactions[0];
  assert.equal(ambiguous.resolvedTicker, null);
  assert.ok(ambiguous.enrichmentFlags.includes('Multiple possible tickers'));

  const firstHorizon = enrichTransactions([
    makeTransaction({
      description: 'FIRST HORIZON BK MEMPHIS TENN DUE 05/01/2030 05.750% MN 01 DISCRETIONARY ORDER YIELD 4.803% TO PAR CALL YIELD 4.849% TO MATURITY CALLABLE 02/01/30 AT 100.000 TIME OF EXECUTION 11:13',
      normalizedDescription: 'FIRST HORIZON BK MEMPHIS TENN DUE 05/01/2030 05 750% MN 01 DISCRETIONARY ORDER',
      assetType: 'Corporate Bond',
      sector: 'Corporate Credit',
      classificationConfidence: 0.78,
      reviewFlags: [],
    }),
  ], reference).transactions[0];
  assert.equal(firstHorizon.resolvedTicker, null);
  assert.equal(firstHorizon.issuerContextTicker, 'FHN');
  assert.equal(firstHorizon.issuerContextSector, 'Financials');
  assert.equal(firstHorizon.instrumentKind, 'corporate bond/note');
  assert.equal(firstHorizon.instrumentCoupon, 5.75);
  assert.equal(firstHorizon.instrumentMaturityDate, '2030-05-01');
  assert.equal(firstHorizon.instrumentCallDate, '2030-02-01');
  assert.ok(firstHorizon.instrumentSummary?.includes('5.75% coupon'));
  assert.ok(firstHorizon.issuerContextFlags.includes('Issuer context only; not direct instrument ticker'));

  const washingtonMuni = enrichTransactions([
    makeTransaction({
      description: 'WASHINGTON ST HEALT 5% DUE 09/01/35',
      normalizedDescription: 'WASHINGTON ST HEALT 5% DUE 09/01/35',
      assetType: 'Municipal Bond',
      sector: 'Municipal Bonds',
      classificationConfidence: 0.9,
      reviewFlags: [],
    }),
  ], reference).transactions[0];
  assert.equal(washingtonMuni.resolvedTicker, null);
  assert.equal(washingtonMuni.instrumentReferenceLabel, 'MSRB EMMA');
  assert.equal(washingtonMuni.instrumentIssuerName, 'WASHINGTON STATE HEALTH');
  assert.equal(washingtonMuni.instrumentIssuerState, 'Washington');
  assert.equal(washingtonMuni.instrumentIssuerCategory, 'Health care / hospital');
  assert.equal(washingtonMuni.instrumentCoupon, 5);
  assert.equal(washingtonMuni.instrumentMaturityDate, '2035-09-01');
  assert.ok(washingtonMuni.instrumentSummary?.includes('Public reference: MSRB EMMA'));
  assert.ok(washingtonMuni.instrumentReferenceUrl?.includes('emma.msrb.org'));
}

function testEventOverlay() {
  const federalRegisterEvent = federalRegisterDocumentToEvent({
    title: 'Adjusting Imports of Automobiles and Automobile Parts Into the United States',
    publication_date: '2026-03-01',
    html_url: 'https://www.federalregister.gov/documents/example',
    abstract: 'Section 232 tariff action affecting vehicles and parts.',
    document_number: '2026-00001',
  });
  assert.ok(federalRegisterEvent);
  assert.equal(federalRegisterEvent.category, 'tariff');
  assert.ok(federalRegisterEvent.sectors.includes('Consumer Discretionary'));
  assert.equal(eventWindowBounds(federalRegisterEvent, 7).startDate, '2026-02-22');

  const targetedEvent: OgeEvent = {
    id: 'event-net',
    date: '2026-03-30',
    endDate: null,
    category: 'company-news',
    title: 'Cloudflare reference event',
    summary: 'Ticker-targeted event for window tests.',
    sourceName: 'Manual',
    sourceUrl: 'https://example.com',
    tickers: ['NET'],
    sectors: [],
    tags: [],
    importance: 2,
  };
  const windows = buildEventWindows([targetedEvent], [
    makeTransaction({
      id: 'buy-net',
      description: 'CLOUDFLARE INC CLASS A',
      normalizedDescription: 'CLOUDFLARE INC CLASS A',
      resolvedTicker: 'NET',
      type: 'Purchase',
      date: '2026-03-31',
      amount: parseOgeAmountRange('$50,001-$100,000'),
    }),
    makeTransaction({
      id: 'sale-aap',
      description: 'ADVANCE AUTO PTS INC',
      normalizedDescription: 'ADVANCE AUTO PTS INC',
      resolvedTicker: 'AAP',
      type: 'Sale',
      date: '2026-03-31',
      amount: parseOgeAmountRange('$15,001-$50,000'),
    }),
  ]);
  const sevenDay = windows.find((window) => window.windowDays === 7);
  assert.equal(sevenDay?.transactionCount, 1);
  assert.equal(sevenDay?.matchedTickers[0], 'NET');
  assert.equal(sevenDay?.netMidpoint, 75000.5);
}

function testAmountParsing() {
  const parsed = parseOgeAmountRange('$1,000,001-$5,000,000');
  assert.equal(parsed.min, 1000001);
  assert.equal(parsed.max, 5000000);
  assert.equal(parsed.midpoint, 3000000.5);

  const over = parseOgeAmountRange('Over $50,000,000');
  assert.equal(over.min, 50000001);
  assert.equal(over.max, 50000001);
}

function testClassification() {
  const muni = classifySecurity('CONNECTICUT ST HLTH & EDL FACS AUTH REV FAIRFIELD UNIV S B/E 5.00% Due Jul 1, 2026');
  assert.equal(muni.assetType, 'Municipal Bond');
  assert.equal(muni.sector, 'Municipal Bonds');

  const tech = classifySecurity('CLOUDFLARE INC CLASS A');
  assert.equal(tech.assetType, 'Equity');
  assert.equal(tech.sector, 'Information Technology');

  const etf = classifySecurity('SPDR S&P 500 ETF TRUST');
  assert.equal(etf.assetType, 'ETF / Fund');

  const cash = classifySecurity('U.S. Bank Money Market Account (Cash)');
  assert.equal(cash.assetType, 'Other');
  assert.equal(cash.sector, 'Cash & Bank Accounts');
  assert.ok(!cash.flags.includes('Needs asset-type review'));
}

function testTrumpIndex() {
  const sourceFiling: SourceFiling = {
    id: 'annual-source',
    officialName: 'Trump, Donald J.',
    title: 'President',
    agency: 'White House Office',
    documentType: 'Annual 278e',
    filedAt: '2025-06-14',
    filedDate: '2025-06-14',
    amendedAt: null,
    isAmendment: false,
    ogeUrl: 'https://example.com/annual.pdf',
    localFilename: 'annual.pdf',
    bytes: 100,
    sha256: 'SHA',
    parserStatus: 'parsed',
    transactionCount: null,
    notes: 'fixture',
  };
  const baseline: BaselineHolding = {
    id: 'baseline-cash',
    description: 'U.S. Bank Money Market Account (Cash)',
    normalizedDescription: 'U S BANK MONEY MARKET ACCOUNT CASH',
    ...emptyEnrichmentFields(),
    value: parseOgeAmountRange('$1,000,001-$5,000,000'),
    assetType: 'Other',
    sector: 'Cash & Bank Accounts',
    sourceFilingId: sourceFiling.id,
    confidence: 0.74,
    reviewFlags: [],
  };
  const holdings = buildHoldingsEstimates([], [baseline]);
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].sourceFilingId, sourceFiling.id);

  const index = buildTrumpIndex({
    holdings,
    transactions: [],
    sourceFilings: [sourceFiling],
    historicalSources: [],
  }).entries;
  assert.equal(index.length, 1);
  assert.equal(index[0].displayName, baseline.description);
  assert.equal(index[0].sourceReliability, 'official');
  assert.equal(index[0].citations[0].sourceUrl, sourceFiling.ogeUrl);
}

async function testCacheShape() {
  const dataset = await loadTrumpOgeDataset();
  assert.ok(dataset.sourceFilings.length >= 1, 'source filings should be present');
  assert.ok(dataset.transactions.length >= 1, 'transactions should be present');
  assert.ok(dataset.holdingsEstimates.length >= 1, 'holdings estimates should be present');
  assert.ok(dataset.securityReference.entries.length >= 1, 'security reference should be present');
  assert.ok(dataset.securityEnrichments.length >= 1, 'security enrichment cache should be present');
  assert.ok(dataset.events.length >= 1, 'event overlay cache should be present');
  assert.ok(dataset.eventWindows.length >= 1, 'event window cache should be present');
  assert.ok(dataset.historicalSources.length >= 1, 'historical sources should be present');
  assert.ok(dataset.financialDisclosureReports.length >= 1, 'financial disclosure reports should be present');
  assert.ok(dataset.assetIncomeHoldings.length >= 1, 'annual asset-income holdings should be present');
  assert.ok(dataset.baselineHoldings.length >= 1, 'baseline holdings should be present');
  assert.ok(dataset.liabilities.length >= 1, 'annual liabilities should be present');
  assert.ok(dataset.trumpIndex.length >= 1, 'Trump Index should be present');
  assert.ok(dataset.trumpIndexRollups.length >= 1, 'Trump Index rollups should be present');
  for (const filedDate of ['2023-07-08', '2023-10-18', '2024-08-23']) {
    assert.ok(
      dataset.historicalSources.some((source) => source.filedDate === filedDate && source.sourceReliability === 'metadata_only'),
      `request-only metadata source should survive for ${filedDate}`
    );
  }
  for (const reportYear of [2015, 2016, 2020, 2021]) {
    const report = dataset.financialDisclosureReports.find((item) => item.reportYear === reportYear);
    assert.equal(report?.parserStatus, 'parsed', `${reportYear} disclosure should be parsed`);
    assert.ok((report?.assetIncomeCount || 0) > 0, `${reportYear} disclosure should include asset/income rows`);
    assert.ok((report?.liabilityCount || 0) > 0, `${reportYear} disclosure should include liability rows`);
  }
  assert.equal(
    dataset.historicalSources.filter((source) => source.filedDate === '2024-08-23' && source.sourceReliability === 'archived_copy').length,
    6,
    '2024 CREW candidate report parts should be registered'
  );
  assert.equal(dataset.cacheMeta.transactionCount, dataset.transactions.length);
  assert.equal(dataset.cacheMeta.sourceFilingCount, dataset.sourceFilings.length);
  assert.equal(dataset.cacheMeta.eventCount, dataset.events.length);
  assert.equal(dataset.cacheMeta.eventWindowCount, dataset.eventWindows.length);
  assert.equal(dataset.cacheMeta.trumpIndexCount, dataset.trumpIndex.length);
  assert.ok(dataset.cacheMeta.instrumentContextCount >= 1, 'instrument context count should be present');
  assert.ok(dataset.transactions.some((row) => row.instrumentSummary || row.issuerContextTicker), 'instrument summaries or issuer context should be present');
}

async function testBootstrapCache() {
  const dataset = await loadTrumpOgeDataset();
  const bootstrap = await loadTrumpOgeBootstrap();
  const generated = buildDashboardBootstrap(dataset);
  const bootstrapPath = path.join(process.cwd(), 'data', 'oge', 'trump', 'dashboard-bootstrap.json');
  const stats = await fs.stat(bootstrapPath);

  assert.ok(stats.size < 750 * 1024, 'dashboard bootstrap should stay below 750 KB');
  assert.ok(bootstrap.trumpIndex.length > 0, 'bootstrap should include top index entries');
  assert.ok(bootstrap.trumpIndex.length < dataset.trumpIndex.length, 'bootstrap should not include the full index');
  assert.equal(bootstrap.cacheMeta.generatedAt, dataset.cacheMeta.generatedAt);
  assert.equal(generated.trumpIndex[0]?.id, bootstrap.trumpIndex[0]?.id);
  assert.ok(!('transactions' in bootstrap), 'bootstrap must not include raw transactions');
  assert.ok(!('holdingsEstimates' in bootstrap), 'bootstrap must not include full holdings');
  assert.ok(!('events' in bootstrap), 'bootstrap must not include full events');
  assert.ok(!('securityEnrichments' in bootstrap), 'bootstrap must not include full enrichment rows');
  assert.ok(!('sourceFilings' in bootstrap), 'bootstrap must not include full source rows');
}

async function testPageResponses() {
  const dataset = await loadTrumpOgeDataset();
  const index = buildPageResponse(dataset, 'index', {});
  assert.ok(index.trumpIndex && index.trumpIndex.length > 0, 'index page should include index entries');
  assert.ok(index.trumpIndex.length > 80, 'index page should include more than the bootstrap top entries');
  assert.ok(!('transactions' in index), 'index page should not ship raw transactions');

  const timing = buildPageResponse(dataset, 'timing', { year: '2025' });
  assert.ok(timing.transactions && timing.transactions.length > 0, 'timing page should include transaction rows');
  assert.ok(timing.events && timing.events.length > 0, 'timing page should include event context');
  assert.ok(timing.transactions.some((row) => !row.date.startsWith('2025')), 'timing page should ignore global year so the timeline can widen');

  const sectors = buildPageResponse(dataset, 'sectors', {});
  assert.ok(sectors.sectorSummaries && sectors.sectorSummaries.length > 0, 'sectors page should include sector summaries');
  assert.ok(!('transactions' in sectors), 'sectors page should use summaries instead of raw transactions');

  const equities = buildPageResponse(dataset, 'equities', {});
  assert.ok(equities.transactions && equities.transactions.length > 0, 'equity page should include scoped transaction rows');
  assert.ok(equities.transactions.every((row) => row.assetType === 'Equity'), 'equity page should force equity scope');
}

async function testJsonMemoization() {
  clearOgeJsonMemoForTests();
  const first = await loadTrumpOgeDataset();
  const second = await loadTrumpOgeDataset();
  assert.equal(first.transactions, second.transactions, 'warm JSON reads should reuse parsed transaction arrays');
  assert.equal(first.securityReference, second.securityReference, 'warm JSON reads should reuse parsed security reference cache');
  clearOgeJsonMemoForTests();
  const third = await loadTrumpOgeDataset();
  assert.notEqual(first.transactions, third.transactions, 'clearing memoization should force a fresh parse');
}

async function testPostgresMigrationContract() {
  const sql = await fs.readFile(path.join(process.cwd(), 'db', 'migrations', '001_trump_oge_cache.sql'), 'utf8');
  for (const table of [
    'trump_oge_cache_runs',
    'trump_oge_transactions',
    'trump_oge_baseline_holdings',
    'trump_oge_historical_sources',
    'trump_oge_source_filings',
    'trump_oge_events',
    'trump_oge_trump_index_entries',
    'trump_oge_review_queue',
    'trump_oge_asset_income_holdings',
    'trump_oge_liabilities',
  ]) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `migration should create ${table}`);
  }
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS trump_oge_transactions_filter_idx'), 'migration should index transaction filters');
  assert.ok(sql.includes('row_data jsonb NOT NULL'), 'migration should preserve original JSON rows');
}

async function testPostgresDisabledFallback() {
  const oldOgeDatabaseUrl = process.env.TRUMP_OGE_DATABASE_URL;
  const oldContextDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.TRUMP_OGE_DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://context-db-is-not-oge.example/test';
  try {
    assert.equal(isPostgresConfigured(), false);
    assert.equal(await loadTrumpOgeBootstrapFromPostgres(), null);
    assert.equal(await buildPageResponseFromPostgres('index', {}), null);
  } finally {
    if (oldOgeDatabaseUrl) {
      process.env.TRUMP_OGE_DATABASE_URL = oldOgeDatabaseUrl;
    } else {
      delete process.env.TRUMP_OGE_DATABASE_URL;
    }
    if (oldContextDatabaseUrl) {
      process.env.DATABASE_URL = oldContextDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  }
}

async function testFiltering() {
  const dataset = await loadTrumpOgeDataset();
  const lateRows = filterTransactions(dataset.transactions, { lateOnly: true });
  assert.ok(lateRows.length > 0);
  assert.ok(lateRows.every((row) => row.lateFilingFlag));

  const response = buildApiResponse(dataset, { transactionType: 'Purchase' });
  assert.ok(response.transactions.length > 0);
  assert.ok(response.transactions.every((row) => row.type === 'Purchase'));
}

async function testWorkbookExport() {
  const dataset = await loadTrumpOgeDataset();
  const response = buildApiResponse(dataset, { transactionType: 'Purchase' });
  assert.ok(response.eventWindows.every((window) => window.saleMidpoint === 0), 'filtered event windows should honor API transaction filters');
  const workbook = buildTrumpOgeWorkbook(response);
  const expectedSheets = [
    'Trump Index',
    'Trump Index Rollups',
    'Transactions',
    'Equity Stocks',
    'Estimated Holdings',
    'Sector Summary',
    'Security Enrichment',
    'Events',
    'Event Windows',
    'Filing Sources',
    'Historical Sources',
    'Disclosure Reports',
    'Asset Income Holdings',
    'Liabilities',
    'Yearly Exposure',
    'Review Queue',
    'Methodology',
  ];
  for (const sheet of expectedSheets) {
    assert.ok(workbook.SheetNames.includes(sheet), `missing sheet ${sheet}`);
  }
  const transactionRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Transactions);
  assert.ok('resolved_ticker' in transactionRows[0], 'transactions export should include resolved_ticker');
  assert.ok('instrument_summary' in transactionRows[0], 'transactions export should include instrument_summary');
  assert.ok('instrument_reference_label' in transactionRows[0], 'transactions export should include instrument_reference_label');
  const stockRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Equity Stocks']);
  assert.ok('net_direction' in stockRows[0], 'equity stocks export should include net_direction');
}

async function testAskApiFallback() {
  const oldVercel = process.env.VERCEL;
  const oldToken = process.env.OPENARENA_BEARER_TOKEN;
  const oldWorkflow = process.env.OPENARENA_TRUMP_INDEX_WORKFLOW_ID;
  const oldSharedSecret = process.env.OPENARENA_API_SHARED_SECRET;
  process.env.VERCEL = '1';
  delete process.env.OPENARENA_BEARER_TOKEN;
  delete process.env.OPENARENA_TRUMP_INDEX_WORKFLOW_ID;
  process.env.OPENARENA_API_SHARED_SECRET = 'stale-secret-should-not-block-dashboard';

  const result = await handleAskRequest({
    method: 'POST',
    headers: {},
    body: {
      question: 'What are the top Trump Index signals?',
      filters: { assetType: 'Equity' },
    },
  });
  const payload = result.body as Record<string, unknown>;

  process.env.VERCEL = oldVercel;
  if (oldToken) process.env.OPENARENA_BEARER_TOKEN = oldToken;
  if (oldWorkflow) process.env.OPENARENA_TRUMP_INDEX_WORKFLOW_ID = oldWorkflow;
  if (oldSharedSecret) process.env.OPENARENA_API_SHARED_SECRET = oldSharedSecret;

  assert.equal(result.status, 200);
  assert.equal(payload.openArenaStatus, 'fallback');
  assert.ok(String(payload.answer || '').includes('deterministic fallback'));
  assert.ok(Array.isArray(payload.citations));
}

function makeTransaction(overrides: Partial<OgeTransaction>): OgeTransaction {
  return {
    ...emptyEnrichmentFields(),
    id: 'tx-test',
    description: 'TEST INC',
    normalizedDescription: 'TEST INC',
    ticker: null,
    type: 'Purchase',
    date: '2026-03-30',
    amount: parseOgeAmountRange('$50,001-$100,000'),
    lateFilingFlag: false,
    sourceFilingId: null,
    sourceUrl: null,
    assetType: 'Equity',
    sector: 'Unclassified Equity',
    classificationConfidence: 0.62,
    parserStatus: 'bootstrap-structured',
    reviewFlags: [],
    ...overrides,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
