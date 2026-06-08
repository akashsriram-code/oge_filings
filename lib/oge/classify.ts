import type { AssetType } from './types';

export interface ClassificationResult {
  normalizedDescription: string;
  assetType: AssetType;
  sector: string;
  confidence: number;
  flags: string[];
}

const SECTOR_PATTERNS: Array<[RegExp, string]> = [
  [/\b(APPLE|MICROSOFT|NVIDIA|BROADCOM|ORACLE|ADOBE|AMD|ADVANCED MICRO|INTEL|MICRON|QUALCOMM|ASML|CLOUDFLARE|DATADOG|DOCUSIGN|DYNATRACE|ELASTIC|FISERV|FAIR ISAAC|FACTSET|BOX INC|BLACKLINE|DIODES|AXCELIS|ACI WORLDWIDE)\b/, 'Information Technology'],
  [/\b(ALPHABET|GOOGLE|META|NETFLIX|DISNEY|DOORDASH|DRAFTKINGS|DUOLINGO|ROBLOX|PINTEREST|SPOTIFY|ROKU)\b/, 'Communication Services'],
  [/\b(AMAZON|TESLA|HOME DEPOT|LOWES|NIKE|MCDONALD|STARBUCKS|LULULEMON|PAPA JOHNS|BRINKER|BOOT BARN|DICKS SPORTING|ACUSHNET|AIRBNB|CARMAX|AUTONATION)\b/, 'Consumer Discretionary'],
  [/\b(COCA COLA|PEPSICO|PROCTER|WALMART|COSTCO|CAL MAINE|GENERAL MILLS|KELLANOVA|KROGER|COLGATE)\b/, 'Consumer Staples'],
  [/\b(JPMORGAN|BANK|BANC|GOLDMAN|MORGAN STANLEY|BLACKSTONE|BLACKROCK|VISA|MASTERCARD|PAYPAL|COINBASE|CME|CBOE|ASSURED GUARANTY|ARTISAN PARTNERS|BREAD FINL|COMMERCE BANCSHARES)\b/, 'Financials'],
  [/\b(EXXON|CHEVRON|CONOCOPHILLIPS|OCCIDENTAL|SLB|HALLIBURTON|VALERO|MARATHON PETROLEUM|ARCHROCK|CACTUS|DNOW|ENERGY|OIL|GAS|PETROLEUM)\b/, 'Energy'],
  [/\b(ELI LILLY|PFIZER|MERCK|JOHNSON|ABBVIE|ABBOTT|THERMO FISHER|MEDTRONIC|UNITEDHEALTH|CENTENE|APELLIS|ADMA BIOLOGICS|AMNEAL|ASTRANA HEALTH|ADDUS HOMECARE|BIOLIFE|AVANOS)\b/, 'Health Care'],
  [/\b(BOEING|CATERPILLAR|UNION PACIFIC|UPS|EATON|QUANTA|GENERAL ELECTRIC|AAR CORP|ABM INDS|ALAMO GROUP|AMENTUM|APOGEE|ARCOSA|ARGAN|ARMSTRONG WORLD|BEACON|COPART)\b/, 'Industrials'],
  [/\b(NEXTERA|CONSTELLATION ENERGY|DUKE ENERGY|SOUTHERN CO|ENTERGY|EXELON|AVISTA|UTILITY|ELECTRIC|POWER)\b/, 'Utilities'],
  [/\b(REIT|REALTY|RLTY|CROWN CASTLE|ESSEX PPTY|ARBOR RLTY|BLACKSTONE MTG TR|ARMOUR RESIDENTIAL|APPLE HOSPITALITY)\b/, 'Real Estate'],
  [/\b(NEWMONT|FREEPORT|DOW INC|DUPONT|STEEL|MATERIALS|CHEMICAL)\b/, 'Materials'],
];

const MUNICIPAL_PATTERN = /\b(SCH DIST|SCHOOL DIST|CNTY|COUNTY|CITY|TWN|TOWN|ST\b|STATE|AUTH|REV|MUNI|MUNICIPAL|HLTH|HOSP|UNIV|PUB IMPT|WTR|SEWER|TRANS AUTH|GO BOND|B\/E|TAX EXEMPT)\b/;
const ETF_PATTERN = /\b(ETF|ISHARES|SPDR|VANGUARD|INVESCO|SELECT SECTOR|JPMORGAN BETABUILDERS|MSCI|NASDAQ|S&P 500|FUND|TRUST)\b/;
const PREFERRED_PATTERN = /\b(PFD|PREFERRED|CONV PFD|DEPOSITARY SH|HYBRID|CAP SECS)\b/;
const BOND_PATTERN = /\b(DUE|DTD|CUSIP|NOTE|NT\b|BOND|DEBENTURE|SR UNSEC|REGS DUE|% DUE|CALLABLE)\b|\b\d{1,2}\.\d{2,3}%\b/;
const EQUITY_PATTERN = /\b(INC|CORP|PLC|LTD|HLDGS|HOLDINGS|CLASS [A-Z]|COM STK|COMMON|EQUITY|SHARES)\b/;

export function classifySecurity(description: string): ClassificationResult {
  const normalizedDescription = normalizeSecurityDescription(description);
  const flags: string[] = [];

  let assetType: AssetType = 'Other';
  let sector = 'Other';
  let confidence = 0.55;

  if (MUNICIPAL_PATTERN.test(normalizedDescription) && BOND_PATTERN.test(normalizedDescription)) {
    assetType = 'Municipal Bond';
    sector = 'Municipal Bonds';
    confidence = 0.9;
  } else if (ETF_PATTERN.test(normalizedDescription)) {
    assetType = 'ETF / Fund';
    sector = 'ETF / Funds';
    confidence = 0.88;
  } else if (PREFERRED_PATTERN.test(normalizedDescription)) {
    assetType = 'Preferred / Hybrid';
    sector = sectorFromDescription(normalizedDescription) || 'Preferred / Hybrid';
    confidence = 0.82;
  } else if (BOND_PATTERN.test(normalizedDescription)) {
    assetType = 'Corporate Bond';
    sector = sectorFromDescription(normalizedDescription) || 'Corporate Credit';
    confidence = 0.78;
  } else if (EQUITY_PATTERN.test(normalizedDescription)) {
    assetType = 'Equity';
    sector = sectorFromDescription(normalizedDescription) || 'Unclassified Equity';
    confidence = sector === 'Unclassified Equity' ? 0.62 : 0.78;
  } else {
    const inferredSector = sectorFromDescription(normalizedDescription);
    if (inferredSector) {
      assetType = 'Equity';
      sector = inferredSector;
      confidence = 0.66;
    }
  }

  if (sector === 'Other' || sector === 'Unclassified Equity' || confidence < 0.7) {
    flags.push('Needs sector review');
  }
  if (assetType === 'Other') {
    flags.push('Needs asset-type review');
  }

  return {
    normalizedDescription,
    assetType,
    sector,
    confidence,
    flags,
  };
}

export function normalizeSecurityDescription(description: string): string {
  return description
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSecurityKey(description: string): string {
  return normalizeSecurityDescription(description)
    .replace(/\b(DUE|DTD)\b.*$/g, '')
    .replace(/\b\d{1,2}\.\d{2,3}%.*$/g, '')
    .replace(/\b(CLASS|CL)\s+[A-Z]\b/g, '')
    .replace(/\b(COMMON|COM STK|EQUITY|SHARES)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function sectorFromDescription(description: string): string | null {
  for (const [pattern, sector] of SECTOR_PATTERNS) {
    if (pattern.test(description)) return sector;
  }
  return null;
}
