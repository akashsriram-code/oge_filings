import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseOgeAmountRange } from '../lib/oge/amounts';
import { classifySecurity } from '../lib/oge/classify';
import { buildApiResponse, loadTrumpOgeDataset } from '../lib/oge/data';
import {
  broadSectorFromSic,
  buildSecurityReferenceCache,
  emptyEnrichmentFields,
  enrichTransactions,
  parseNasdaqSymbolDirectory,
  parseSecCompanyTickers,
} from '../lib/oge/enrichment';
import { filterTransactions } from '../lib/oge/filter';
import { buildEquityStockSummaries, deriveEquityStockName } from '../lib/oge/stocks';
import type { OgeTransaction } from '../lib/oge/types';
import { buildTrumpOgeWorkbook } from '../lib/oge/workbook';

async function main() {
  testAmountParsing();
  testClassification();
  testSecurityEnrichment();
  testEquityStocks();
  await testCacheShape();
  await testFiltering();
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
}

async function testCacheShape() {
  const dataset = await loadTrumpOgeDataset();
  assert.ok(dataset.sourceFilings.length >= 1, 'source filings should be present');
  assert.ok(dataset.transactions.length >= 1, 'transactions should be present');
  assert.ok(dataset.holdingsEstimates.length >= 1, 'holdings estimates should be present');
  assert.ok(dataset.securityReference.entries.length >= 1, 'security reference should be present');
  assert.ok(dataset.securityEnrichments.length >= 1, 'security enrichment cache should be present');
  assert.equal(dataset.cacheMeta.transactionCount, dataset.transactions.length);
  assert.equal(dataset.cacheMeta.sourceFilingCount, dataset.sourceFilings.length);
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
  const workbook = buildTrumpOgeWorkbook(response);
  const expectedSheets = ['Transactions', 'Equity Stocks', 'Estimated Holdings', 'Sector Summary', 'Security Enrichment', 'Filing Sources', 'Review Queue', 'Methodology'];
  for (const sheet of expectedSheets) {
    assert.ok(workbook.SheetNames.includes(sheet), `missing sheet ${sheet}`);
  }
  const transactionRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Transactions);
  assert.ok('resolved_ticker' in transactionRows[0], 'transactions export should include resolved_ticker');
  const stockRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Equity Stocks']);
  assert.ok('net_direction' in stockRows[0], 'equity stocks export should include net_direction');
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
