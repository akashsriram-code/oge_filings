/**
 * Conflict of Interest Analyzer
 * Cross-references Trump's holdings with policy decisions, events, and transactions
 */

import type {
  OgeEvent,
  OgeTransaction,
  TrumpIndexEntry,
  EventCategory,
} from './types';

export interface ConflictIndicator {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: ConflictCategory;
  title: string;
  summary: string;
  holdingTicker: string | null;
  holdingName: string;
  holdingValue: number;
  eventId: string | null;
  eventDate: string | null;
  eventTitle: string | null;
  transactionIds: string[];
  transactionDates: string[];
  windowDays: number | null;
  timelinePosition: 'before' | 'after' | 'during' | null;
  evidenceStrength: number; // 0-1
  sourceUrls: string[];
  tags: string[];
}

export type ConflictCategory =
  | 'tariff-holding'          // Holds stock in company affected by tariff policy
  | 'regulatory-holding'      // Holds stock in company under regulatory review
  | 'government-contract'     // Holds stock in company with government contracts
  | 'suspicious-timing'       // Transaction suspiciously timed around announcements
  | 'market-moving-statement' // Statement about company while holding position
  | 'cabinet-connection'      // Holding connected to cabinet member's former company
  | 'foreign-policy'          // Holding in company affected by foreign policy decision
  | 'fed-rate-sensitive';     // Holding sensitive to Fed rate decisions

export interface ConflictAnalysis {
  generatedAt: string;
  indicators: ConflictIndicator[];
  summary: ConflictSummary;
  byCategory: Record<ConflictCategory, ConflictIndicator[]>;
  bySeverity: Record<ConflictIndicator['severity'], ConflictIndicator[]>;
  timeline: ConflictTimelineEntry[];
}

export interface ConflictSummary {
  totalIndicators: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalExposureAtRisk: number;
  uniqueHoldings: number;
  uniqueEvents: number;
  dateRange: { start: string; end: string } | null;
}

export interface ConflictTimelineEntry {
  date: string;
  type: 'event' | 'transaction' | 'conflict';
  title: string;
  indicators: string[]; // ConflictIndicator IDs
}

// Known policy-sensitive sectors and their triggers
const POLICY_SENSITIVE_SECTORS: Record<string, { triggers: EventCategory[]; keywords: string[] }> = {
  'Energy': {
    triggers: ['tariff', 'white-house'],
    keywords: ['oil', 'gas', 'drilling', 'pipeline', 'energy independence', 'paris accord'],
  },
  'Financials': {
    triggers: ['fed', 'white-house'],
    keywords: ['rate', 'bank', 'regulation', 'dodd-frank', 'deregulation'],
  },
  'Health Care': {
    triggers: ['white-house'],
    keywords: ['obamacare', 'aca', 'drug pricing', 'pharmaceutical', 'healthcare'],
  },
  'Information Technology': {
    triggers: ['tariff', 'white-house', 'truth-social'],
    keywords: ['china', 'semiconductor', 'tech', 'tiktok', 'section 230', 'big tech'],
  },
  'Industrials': {
    triggers: ['tariff', 'white-house'],
    keywords: ['tariff', 'manufacturing', 'infrastructure', 'steel', 'aluminum', 'china'],
  },
  'Consumer Discretionary': {
    triggers: ['tariff', 'truth-social'],
    keywords: ['retail', 'import', 'tariff', 'china goods'],
  },
  'Materials': {
    triggers: ['tariff', 'white-house'],
    keywords: ['steel', 'aluminum', 'tariff', 'mining'],
  },
  'Communication Services': {
    triggers: ['white-house', 'truth-social'],
    keywords: ['media', 'fake news', 'section 230', 'social media'],
  },
};

// Companies frequently mentioned in policy contexts
const POLICY_CONNECTED_TICKERS: Record<string, { categories: ConflictCategory[]; notes: string }> = {
  'AAPL': { categories: ['tariff-holding', 'foreign-policy'], notes: 'China manufacturing exposure' },
  'TSLA': { categories: ['regulatory-holding', 'market-moving-statement'], notes: 'EV credits, Musk relationship' },
  'META': { categories: ['regulatory-holding', 'market-moving-statement'], notes: 'Social media regulation' },
  'GOOGL': { categories: ['regulatory-holding'], notes: 'Antitrust concerns' },
  'AMZN': { categories: ['regulatory-holding', 'market-moving-statement'], notes: 'USPS deal, Bezos/WaPo' },
  'BA': { categories: ['government-contract'], notes: 'Air Force One, defense contracts' },
  'LMT': { categories: ['government-contract'], notes: 'Defense contractor' },
  'RTX': { categories: ['government-contract'], notes: 'Defense contractor' },
  'NOC': { categories: ['government-contract'], notes: 'Defense contractor' },
  'GD': { categories: ['government-contract'], notes: 'Defense contractor' },
  'XOM': { categories: ['cabinet-connection', 'regulatory-holding'], notes: 'Tillerson connection' },
  'CVX': { categories: ['regulatory-holding'], notes: 'Energy policy' },
  'JPM': { categories: ['fed-rate-sensitive', 'regulatory-holding'], notes: 'Bank deregulation' },
  'GS': { categories: ['cabinet-connection', 'fed-rate-sensitive'], notes: 'Multiple cabinet connections' },
  'MS': { categories: ['fed-rate-sensitive'], notes: 'Rate sensitivity' },
  'BAC': { categories: ['fed-rate-sensitive'], notes: 'Rate sensitivity' },
  'WFC': { categories: ['fed-rate-sensitive'], notes: 'Rate sensitivity' },
  'F': { categories: ['tariff-holding'], notes: 'Auto tariffs' },
  'GM': { categories: ['tariff-holding'], notes: 'Auto tariffs' },
  'X': { categories: ['tariff-holding'], notes: 'Steel tariffs' },
  'NUE': { categories: ['tariff-holding'], notes: 'Steel tariffs' },
  'AA': { categories: ['tariff-holding'], notes: 'Aluminum tariffs' },
};

/**
 * Analyze holdings and events for potential conflicts of interest
 */
export function analyzeConflicts(params: {
  holdings: TrumpIndexEntry[];
  transactions: OgeTransaction[];
  events: OgeEvent[];
}): ConflictAnalysis {
  const { holdings, transactions, events } = params;
  const indicators: ConflictIndicator[] = [];
  
  // 1. Check for policy-connected holdings
  for (const holding of holdings) {
    const ticker = holding.resolvedTicker;
    if (ticker && POLICY_CONNECTED_TICKERS[ticker]) {
      const config = POLICY_CONNECTED_TICKERS[ticker];
      for (const category of config.categories) {
        indicators.push({
          id: `policy-${ticker}-${category}`,
          severity: holding.currentMidpoint > 500000 ? 'high' : 'medium',
          category,
          title: `${categoryLabel(category)}: ${holding.displayName}`,
          summary: `Holds ${formatValue(holding.currentMidpoint)} in ${ticker}. ${config.notes}`,
          holdingTicker: ticker,
          holdingName: holding.displayName,
          holdingValue: holding.currentMidpoint,
          eventId: null,
          eventDate: null,
          eventTitle: null,
          transactionIds: [],
          transactionDates: [],
          windowDays: null,
          timelinePosition: null,
          evidenceStrength: 0.7,
          sourceUrls: holding.citations.map(c => c.sourceUrl).filter((u): u is string => Boolean(u)),
          tags: [ticker, category],
        });
      }
    }
  }
  
  // 2. Check for sector-sensitive holdings during relevant events
  for (const holding of holdings) {
    const sector = holding.sector;
    const config = POLICY_SENSITIVE_SECTORS[sector];
    if (!config) continue;
    
    // Find events that match this sector's triggers
    const relevantEvents = events.filter(e => 
      config.triggers.includes(e.category) ||
      config.keywords.some(kw => 
        e.title.toLowerCase().includes(kw) ||
        e.summary.toLowerCase().includes(kw)
      )
    );
    
    for (const event of relevantEvents) {
      // Find transactions within 30 days of the event
      const eventDate = new Date(event.date);
      const windowStart = new Date(eventDate);
      windowStart.setDate(windowStart.getDate() - 30);
      const windowEnd = new Date(eventDate);
      windowEnd.setDate(windowEnd.getDate() + 30);
      
      const relatedTxs = transactions.filter(tx =>
        tx.date &&
        (tx.resolvedTicker === holding.resolvedTicker || 
         tx.issuerContextTicker === holding.issuerContextTicker) &&
        new Date(tx.date) >= windowStart &&
        new Date(tx.date) <= windowEnd
      );
      
      if (relatedTxs.length > 0) {
        const txBeforeEvent = relatedTxs.filter(tx => tx.date && new Date(tx.date) < eventDate);
        const timelinePosition = txBeforeEvent.length > 0 ? 'before' : 'after';
        
        indicators.push({
          id: `timing-${holding.id}-${event.id}`,
          severity: txBeforeEvent.length > 0 ? 'high' : 'medium',
          category: 'suspicious-timing',
          title: `Suspicious timing: ${holding.displayName} transactions near "${event.title}"`,
          summary: `${relatedTxs.length} transaction(s) within 30 days of ${event.category} event. ${txBeforeEvent.length} occurred before the announcement.`,
          holdingTicker: holding.resolvedTicker,
          holdingName: holding.displayName,
          holdingValue: holding.currentMidpoint,
          eventId: event.id,
          eventDate: event.date,
          eventTitle: event.title,
          transactionIds: relatedTxs.map(tx => tx.id),
          transactionDates: relatedTxs.map(tx => tx.date).filter(Boolean),
          windowDays: 30,
          timelinePosition,
          evidenceStrength: txBeforeEvent.length > 0 ? 0.85 : 0.6,
          sourceUrls: [event.sourceUrl, ...relatedTxs.map(tx => tx.sourceUrl).filter((u): u is string => Boolean(u))],
          tags: [sector, event.category, holding.resolvedTicker || ''].filter(Boolean),
        });
      }
    }
  }
  
  // 3. Check for Fed rate sensitivity around Fed events
  const fedEvents = events.filter(e => e.category === 'fed');
  const rateSensitiveHoldings = holdings.filter(h => 
    h.sector === 'Financials' || 
    (h.resolvedTicker && ['JPM', 'GS', 'MS', 'BAC', 'WFC', 'C', 'USB', 'PNC'].includes(h.resolvedTicker))
  );
  
  for (const fedEvent of fedEvents) {
    const totalFinancialExposure = rateSensitiveHoldings.reduce((sum, h) => sum + h.currentMidpoint, 0);
    if (totalFinancialExposure > 100000) {
      indicators.push({
        id: `fed-${fedEvent.id}`,
        severity: totalFinancialExposure > 1000000 ? 'high' : 'medium',
        category: 'fed-rate-sensitive',
        title: `Fed rate decision while holding rate-sensitive assets`,
        summary: `Held ${formatValue(totalFinancialExposure)} in rate-sensitive financials during Fed event: "${fedEvent.title}"`,
        holdingTicker: null,
        holdingName: `${rateSensitiveHoldings.length} financial holdings`,
        holdingValue: totalFinancialExposure,
        eventId: fedEvent.id,
        eventDate: fedEvent.date,
        eventTitle: fedEvent.title,
        transactionIds: [],
        transactionDates: [],
        windowDays: null,
        timelinePosition: 'during',
        evidenceStrength: 0.5,
        sourceUrls: [fedEvent.sourceUrl],
        tags: ['fed', 'financials', 'rate-sensitive'],
      });
    }
  }
  
  // Limit indicators to prevent memory issues (keep top by severity/evidence)
  const limitedIndicators = indicators
    .sort((a, b) => 
      severityOrder(b.severity) - severityOrder(a.severity) ||
      b.evidenceStrength - a.evidenceStrength
    )
    .slice(0, 100);
  
  // Build summary and categorizations
  const byCategory = {} as Record<ConflictCategory, ConflictIndicator[]>;
  const bySeverity = { critical: [], high: [], medium: [], low: [] } as Record<ConflictIndicator['severity'], ConflictIndicator[]>;
  
  for (const indicator of limitedIndicators) {
    if (!byCategory[indicator.category]) byCategory[indicator.category] = [];
    byCategory[indicator.category].push(indicator);
    bySeverity[indicator.severity].push(indicator);
  }
  
  const uniqueHoldings = new Set(limitedIndicators.map(i => i.holdingTicker || i.holdingName)).size;
  const uniqueEvents = new Set(limitedIndicators.filter(i => i.eventId).map(i => i.eventId)).size;
  const dates = limitedIndicators.flatMap(i => [i.eventDate, ...i.transactionDates]).filter((d): d is string => Boolean(d)).sort();
  
  const summary: ConflictSummary = {
    totalIndicators: limitedIndicators.length,
    criticalCount: bySeverity.critical.length,
    highCount: bySeverity.high.length,
    mediumCount: bySeverity.medium.length,
    lowCount: bySeverity.low.length,
    totalExposureAtRisk: indicators.reduce((sum, i) => sum + i.holdingValue, 0),
    uniqueHoldings,
    uniqueEvents,
    dateRange: dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null,
  };
  
  // Build timeline
  const timeline = buildConflictTimeline(limitedIndicators, events, transactions);
  
  return {
    generatedAt: new Date().toISOString(),
    indicators: limitedIndicators,
    summary,
    byCategory,
    bySeverity,
    timeline,
  };
}

function buildConflictTimeline(
  indicators: ConflictIndicator[],
  events: OgeEvent[],
  transactions: OgeTransaction[]
): ConflictTimelineEntry[] {
  const entries = new Map<string, ConflictTimelineEntry>();
  
  // Add events
  for (const event of events) {
    const relatedIndicators = indicators.filter(i => i.eventId === event.id);
    if (relatedIndicators.length > 0) {
      entries.set(`event-${event.date}-${event.id}`, {
        date: event.date,
        type: 'event',
        title: event.title,
        indicators: relatedIndicators.map(i => i.id),
      });
    }
  }
  
  // Add transactions involved in conflicts
  const conflictTxIds = new Set(indicators.flatMap(i => i.transactionIds));
  for (const tx of transactions) {
    if (conflictTxIds.has(tx.id) && tx.date) {
      const key = `tx-${tx.date}-${tx.id}`;
      const relatedIndicators = indicators.filter(i => i.transactionIds.includes(tx.id));
      entries.set(key, {
        date: tx.date,
        type: 'transaction',
        title: `${tx.type}: ${tx.description.slice(0, 50)}...`,
        indicators: relatedIndicators.map(i => i.id),
      });
    }
  }
  
  return Array.from(entries.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function categoryLabel(category: ConflictCategory): string {
  const labels: Record<ConflictCategory, string> = {
    'tariff-holding': 'Tariff-Affected Holding',
    'regulatory-holding': 'Regulatory Interest',
    'government-contract': 'Government Contractor',
    'suspicious-timing': 'Suspicious Timing',
    'market-moving-statement': 'Market-Moving Statement',
    'cabinet-connection': 'Cabinet Connection',
    'foreign-policy': 'Foreign Policy Exposure',
    'fed-rate-sensitive': 'Fed Rate Sensitivity',
  };
  return labels[category] || category;
}

function severityOrder(severity: ConflictIndicator['severity']): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export { categoryLabel, severityOrder };