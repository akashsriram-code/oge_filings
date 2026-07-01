import { promises as fs } from 'fs';
import path from 'path';
import { buildApiResponse, loadTrumpOgeDataset } from './data';
import type { TrumpIndexCitation, TrumpIndexEntry, TrumpOgeApiResponse, TrumpOgeFilters } from './types';

const DEFAULT_OPENARENA_BASE_URL = 'https://aiopenarena.thomsonreuters.com';
const DEFAULT_TIMEOUT_SECONDS = 180;

interface AskRequest {
  question?: string;
  filters?: TrumpOgeFilters;
  selectedIndexIds?: string[];
  includeSourceDocuments?: boolean;
}

export interface AskRouteRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface AskRouteResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  empty?: boolean;
}

interface AskFacts {
  question: string;
  cacheVersion: string;
  filters: TrumpOgeFilters;
  selectedIndexIds: string[];
  kpis: TrumpOgeApiResponse['kpis'];
  topIndexEntries: Array<ReturnType<typeof compactIndexEntry>>;
  topSectorRollups: TrumpOgeApiResponse['trumpIndexRollups'];
  yearlyExposureSummaries: TrumpOgeApiResponse['yearlyExposureSummaries'];
  citations: TrumpIndexCitation[];
  caveats: string[];
}

class OpenArenaError extends Error {
  constructor(public status: number | null, message: string) {
    super(message);
  }
}

export async function handleAskRequest(req: AskRouteRequest): Promise<AskRouteResult> {
  if (req.method === 'OPTIONS') {
    return askResult(204, null, true);
  }

  if (req.method !== 'POST') {
    return askResult(405, { error: 'Use POST.' });
  }

  try {
    const body = parseBody(req.body);
    const question = body.question?.trim();
    if (!question) {
      return askResult(400, { error: 'Missing question.' });
    }

    const dataset = await loadTrumpOgeDataset();
    const response = buildApiResponse(dataset, body.filters || {});
    const facts = buildAskFacts({
      question,
      response,
      filters: body.filters || {},
      selectedIndexIds: body.selectedIndexIds || [],
    });
    const sessionId = `ask-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const openArena = await askOpenArena(question, facts, Boolean(body.includeSourceDocuments));
    const answer = openArena.answer || buildFallbackAnswer(facts);
    const payload = {
      answer,
      calculations: {
        kpis: facts.kpis,
        topIndexEntries: facts.topIndexEntries,
        topSectorRollups: facts.topSectorRollups,
        yearlyExposureSummaries: facts.yearlyExposureSummaries,
      },
      citations: facts.citations,
      caveats: facts.caveats,
      suggestedFilters: suggestFilters(facts),
      sessionId,
      cacheVersion: facts.cacheVersion,
      openArenaStatus: openArena.status,
      openArenaError: openArena.error || null,
    };

    await persistAskSession({
      sessionId,
      timestamp: new Date().toISOString(),
      question,
      filters: body.filters || {},
      selectedIndexIds: body.selectedIndexIds || [],
      includeSourceDocuments: Boolean(body.includeSourceDocuments),
      answer,
      citations: facts.citations,
      workflowId: process.env.OPENARENA_TRUMP_INDEX_WORKFLOW_ID || process.env.OPENARENA_WORKFLOW_ID || null,
      cacheVersion: facts.cacheVersion,
      openArenaStatus: openArena.status,
      openArenaError: openArena.error || null,
    });

    return askResult(200, payload);
  } catch (error) {
    const status = error instanceof OpenArenaError && error.status ? error.status : 500;
    return askResult(status, {
      error: error instanceof Error ? error.message : 'Internal Server Error',
    });
  }
}

export default async function handler(req: AskRouteRequest): Promise<AskRouteResult> {
  return handleAskRequest(req);
}

function buildAskFacts({
  question,
  response,
  filters,
  selectedIndexIds,
}: {
  question: string;
  response: TrumpOgeApiResponse;
  filters: TrumpOgeFilters;
  selectedIndexIds: string[];
}): AskFacts {
  const selected = selectedIndexIds.length > 0
    ? response.trumpIndex.filter((entry) => selectedIndexIds.includes(entry.id))
    : response.trumpIndex.slice(0, 12);
  const citations = uniqueCitations(selected.flatMap((entry) => entry.citations));

  return {
    question,
    cacheVersion: response.cacheMeta.generatedAt,
    filters,
    selectedIndexIds,
    kpis: response.kpis,
    topIndexEntries: selected.map(compactIndexEntry),
    topSectorRollups: response.trumpIndexRollups.filter((rollup) => rollup.rollupType === 'sector').slice(0, 10),
    yearlyExposureSummaries: response.yearlyExposureSummaries.slice(-12),
    citations,
    caveats: [
      'Numbers are calculated deterministically from disclosed OGE statutory ranges using midpoint estimates, not exact portfolio values.',
      'Trump Index confidence and source reliability are displayed beside scores but do not reduce the score.',
      'Issuer-context tickers explain likely public-company issuer context for bonds and preferred securities; they are not direct bond identifiers unless a CUSIP/ISIN/FIGI is present.',
      'Instrument reference links point only to exact reviewed identifier-derived instrument pages, such as MSRB EMMA security details by municipal CUSIP. Rows without CUSIP/ISIN/FIGI remain marked for identifier review rather than linked to generic search or API mapping URLs.',
      'Event proximity is contextual and is not used as a scoring input or causal claim.',
      'Archived-copy and metadata-only sources require reporter review before publication language relies on original filing text.',
    ],
  };
}

function compactIndexEntry(entry: TrumpIndexEntry) {
  return {
    id: entry.id,
    score: entry.score,
    displayName: entry.displayName,
    assetType: entry.assetType,
    sector: entry.sector,
    resolvedTicker: entry.resolvedTicker,
    resolvedIssuerName: entry.resolvedIssuerName,
    resolvedExchange: entry.resolvedExchange,
    resolvedCik: entry.resolvedCik,
    issuerContextTicker: entry.issuerContextTicker,
    issuerContextIssuerName: entry.issuerContextIssuerName,
    issuerContextExchange: entry.issuerContextExchange,
    issuerContextCik: entry.issuerContextCik,
    issuerContextSector: entry.issuerContextSector,
    issuerContextSource: entry.issuerContextSource,
    issuerContextConfidence: entry.issuerContextConfidence,
    issuerContextFlags: entry.issuerContextFlags,
    instrumentKind: entry.instrumentKind,
    instrumentIssuerName: entry.instrumentIssuerName,
    instrumentCoupon: entry.instrumentCoupon,
    instrumentMaturityDate: entry.instrumentMaturityDate,
    instrumentCallable: entry.instrumentCallable,
    instrumentCallDate: entry.instrumentCallDate,
    instrumentCallPrice: entry.instrumentCallPrice,
    instrumentYieldToCall: entry.instrumentYieldToCall,
    instrumentYieldToMaturity: entry.instrumentYieldToMaturity,
    instrumentIssuerState: entry.instrumentIssuerState,
    instrumentIssuerCategory: entry.instrumentIssuerCategory,
    instrumentReferenceLabel: entry.instrumentReferenceLabel,
    instrumentReferenceSource: entry.instrumentReferenceSource,
    instrumentReferenceUrl: entry.instrumentReferenceUrl,
    instrumentReferenceStatus: entry.instrumentReferenceStatus,
    instrumentEvidenceSourceUrl: entry.instrumentEvidenceSourceUrl,
    instrumentEvidenceNote: entry.instrumentEvidenceNote,
    instrumentReviewStatus: entry.instrumentReviewStatus,
    instrumentCusip: entry.instrumentCusip,
    instrumentIsin: entry.instrumentIsin,
    instrumentFigi: entry.instrumentFigi,
    instrumentSummary: entry.instrumentSummary,
    instrumentMatchSource: entry.instrumentMatchSource,
    instrumentMatchConfidence: entry.instrumentMatchConfidence,
    instrumentContextFlags: entry.instrumentContextFlags,
    currentMidpoint: entry.currentMidpoint,
    changeMidpoint: entry.changeMidpoint,
    changePct: entry.changePct,
    purchaseMidpoint: entry.purchaseMidpoint,
    saleMidpoint: entry.saleMidpoint,
    netFlowMidpoint: entry.netFlowMidpoint,
    netDirection: entry.netDirection,
    transactionCount: entry.transactionCount,
    filingCount: entry.filingCount,
    firstSeenDate: entry.firstSeenDate,
    lastSeenDate: entry.lastSeenDate,
    exposureComponent: entry.exposureComponent,
    changeComponent: entry.changeComponent,
    activityComponent: entry.activityComponent,
    confidence: entry.confidence,
    sourceReliability: entry.sourceReliability,
    reviewFlags: entry.reviewFlags,
  };
}

async function askOpenArena(question: string, facts: AskFacts, includeSourceDocuments: boolean): Promise<{ status: 'openarena' | 'fallback'; answer: string; error?: string }> {
  const bearerToken = process.env.OPENARENA_BEARER_TOKEN?.trim();
  const workflowId = (process.env.OPENARENA_TRUMP_INDEX_WORKFLOW_ID || process.env.OPENARENA_WORKFLOW_ID || '').trim();
  if (!bearerToken || !workflowId) {
    return { status: 'fallback', answer: '', error: 'OPENARENA_BEARER_TOKEN or workflow ID is not configured.' };
  }

  const baseUrl = (process.env.OPENARENA_BASE_URL || DEFAULT_OPENARENA_BASE_URL).trim();
  const timeoutSeconds = envInteger('OPENARENA_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS);
  const payload = {
    workflow_id: workflowId,
    query: buildOpenArenaPrompt(question, facts, includeSourceDocuments),
    is_persistence_allowed: false,
    input_variables: {},
    conversation_id: null,
  };

  try {
    const response = await callOpenArenaInference({
      baseUrl,
      bearerToken,
      payload,
      timeoutSeconds,
    });
    const answer = extractOpenArenaAnswer(response);
    return answer
      ? { status: 'openarena', answer }
      : { status: 'fallback', answer: '', error: 'OpenArena returned an empty answer.' };
  } catch (error) {
    return {
      status: 'fallback',
      answer: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildOpenArenaPrompt(question: string, facts: AskFacts, includeSourceDocuments: boolean): string {
  return `
You are assisting Reuters reporters with a Trump OGE financial disclosure dashboard.

Use the deterministic JSON facts below as the source of numerical truth. Do not invent figures, dates, scores, transactions, or holdings. Explain what the index indicates, cite the provided source URLs/labels, and keep uncertainty explicit.

The Trump Index score is 50% log-scaled current exposure rank, 30% absolute midpoint change rank, and 20% gross transaction activity rank. Confidence and source reliability are displayed separately and do not reduce the score.

User question:
${question}

Source-document mode requested: ${includeSourceDocuments ? 'yes, but only source metadata/citations are currently attached in this v1 endpoint' : 'no'}

Deterministic facts JSON:
${JSON.stringify(facts, null, 2)}
`.trim();
}

async function callOpenArenaInference({
  baseUrl,
  bearerToken,
  payload,
  timeoutSeconds,
}: {
  baseUrl: string;
  bearerToken: string;
  payload: Record<string, unknown>;
  timeoutSeconds: number;
}): Promise<Record<string, unknown>> {
  const url = `${baseUrl.replace(/\/$/, '')}/v3/inference`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await postJson(url, bearerToken, payload, timeoutSeconds);
    } catch (error) {
      const status = error instanceof OpenArenaError ? error.status : null;
      if (status !== 504 || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }

  throw new Error('OpenArena inference retry loop exited unexpectedly.');
}

async function postJson(
  url: string,
  bearerToken: string,
  payload: Record<string, unknown>,
  timeoutSeconds: number
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  }, timeoutSeconds);
  const text = await response.text();

  if (!response.ok) {
    throw new OpenArenaError(response.status, `OpenArena POST ${url} failed with HTTP ${response.status}: ${text || response.statusText}`);
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`OpenArena returned malformed JSON from ${url}.`);
  }
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutSeconds: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutSeconds} seconds: ${input}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpenArenaAnswer(payload: Record<string, unknown>): string {
  const result = payload.result as Record<string, unknown> | undefined;
  const answer = result?.answer;
  if (typeof answer === 'string') return answer.trim();
  if (answer && typeof answer === 'object') {
    for (const value of Object.values(answer as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return typeof payload.answer === 'string' ? payload.answer.trim() : '';
}

function buildFallbackAnswer(facts: AskFacts): string {
  const rows = facts.topIndexEntries.slice(0, 5);
  if (rows.length === 0) {
    return 'No Trump Index entries match the current filters. The deterministic cache is available, but OpenArena is not configured for narrative explanation.';
  }

  const bullets = rows.map((row, index) =>
    `${index + 1}. ${row.displayName}: score ${row.score}, ${row.netDirection.toLowerCase()}, current midpoint ${formatUsd(row.currentMidpoint)}, net flow ${formatUsd(row.netFlowMidpoint)}.${row.instrumentSummary ? ` ${row.instrumentSummary}` : ''}`
  );
  return [
    'OpenArena is not configured, so this is a deterministic fallback summary from the cached Trump Index facts.',
    ...bullets,
    'Use the citations array for source URLs and review badges before publication.',
  ].join('\n');
}

function suggestFilters(facts: AskFacts): TrumpOgeFilters[] {
  const top = facts.topIndexEntries[0];
  if (!top) return [];
  return [
    top.resolvedTicker || top.issuerContextTicker
      ? { ...facts.filters, ticker: top.resolvedTicker || top.issuerContextTicker }
      : { ...facts.filters, issuer: top.issuerContextIssuerName || top.instrumentIssuerName || top.displayName },
    { ...facts.filters, sector: top.sector },
    { ...facts.filters, assetType: top.assetType },
  ];
}

function parseBody(body: unknown): AskRequest {
  if (typeof body === 'string') return JSON.parse(body) as AskRequest;
  if (body && typeof body === 'object') return body as AskRequest;
  return {};
}

function uniqueCitations(citations: TrumpIndexCitation[]): TrumpIndexCitation[] {
  const seen = new Set<string>();
  const result: TrumpIndexCitation[] = [];
  for (const citation of citations) {
    const key = citation.sourceId || citation.sourceUrl || citation.label;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result.slice(0, 12);
}

function askResult(status: number, body: unknown, empty = false): AskRouteResult {
  return {
    status,
    body,
    empty,
    headers: {
      'Access-Control-Allow-Origin': process.env.OPENARENA_CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...(empty ? {} : { 'Content-Type': 'application/json' }),
    },
  };
}

async function persistAskSession(record: Record<string, unknown>) {
  if (process.env.VERCEL) return;
  const logfile = path.join(process.cwd(), 'data', 'oge', 'trump', 'ask-sessions.local.jsonl');
  await fs.appendFile(logfile, `${JSON.stringify(record)}\n`, 'utf8').catch(() => undefined);
}

function envInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}
