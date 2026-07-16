// ==========================================================================
// dateExtractor.js
// Ported from the NS&FP Word/VBA Procedure Date Extractor.
// Same core ideas, re-expressed for plain-text sources (PDF text, HTML text,
// external site text) instead of a Word Document/Range object:
//   - regex date/range/period/TBA detection
//   - "context tag" from surrounding text (what is this date FOR)
//   - MinDate/MaxDate -> status classification (ported from the MS List formula)
// ==========================================================================

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};

const MONTH_RE = 'January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Oct|Nov|Dec';

// "Month Day, Year" or "Month Day" (year inferred from context if absent)
const DATE_RE = new RegExp(`(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, 'gi');

// Ranges: "September 29 - October 6, 2026" / "Sept 2-15, 2026" / "May - July 2026"
const RANGE_RE = new RegExp(
  `(between\\s+|from\\s+|week of\\s+)?(${MONTH_RE})\\s+(\\d{1,2})\\s*(-|–|—|to|and)\\s*(?:(${MONTH_RE})\\s+)?(\\d{1,2})(?:,?\\s*(\\d{4}))?`,
  'gi'
);

// Bare month-to-month ranges: "May – July 2026"
const MONTH_RANGE_RE = new RegExp(
  `(${MONTH_RE})\\s*[-–—]\\s*(${MONTH_RE})\\.?\\s+(\\d{4})`,
  'gi'
);

// "TBA"
const TBA_RE = /(\w+)\s+(?:APPLICATION\s+DUE\s+DATE|DUE\s+DATE|DEADLINE|DATES|DATE)\s+TBA/gi;

// Context keyword categories — simplified port of GetContextTag/GetVerbNounTag.
// Order matters: first match wins.
const CONTEXT_CATEGORIES = [
  { tag: 'deadline', patterns: [/final application deadline/i, /application deadline/i, /deadline/i, /due date/i, /submit.{0,15}application/i, /must be submitted/i] },
  { tag: 'internal_deadline', patterns: [/internal (application )?deadline/i, /institutional endorsement/i, /begin the advising process/i, /indicate your intent to apply/i, /internal application/i] },
  { tag: 'open', patterns: [/application(s)? open/i, /open date/i, /application period/i, /now open/i, /begin online application/i, /register and begin/i] },
  { tag: 'interview', patterns: [/campus interview/i, /interview/i, /practice interview/i] },
  { tag: 'recommenders', patterns: [/letters? of recommendation/i, /recommenders/i, /follow.up with recommenders/i] },
  { tag: 'results', patterns: [/admissions decisions/i, /selection cycle/i, /notification/i, /finalists/i] },
];

function tagContext(snippet) {
  for (const cat of CONTEXT_CATEGORIES) {
    if (cat.patterns.some((p) => p.test(snippet))) return cat.tag;
  }
  return 'other';
}

// Grab ~90 chars before + after a match index as "context" (rough sentence proxy)
function getSnippet(text, start, len) {
  const from = Math.max(0, start - 90);
  const to = Math.min(text.length, start + len + 90);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

function monthNum(name) {
  return MONTHS[name.slice(0, name.length > 4 ? 4 : 3).toLowerCase()] || MONTHS[name.toLowerCase()];
}

// Turns a regex match into an ISO date. inferredYear used when year is absent
// (procedures docs often omit the year on later mentions in the same cycle).
function toISO(monthName, day, year, inferredYear) {
  const mm = monthNum(monthName);
  if (!mm) return null;
  const yyyy = year ? parseInt(year, 10) : inferredYear;
  if (!yyyy) return null;
  const dd = parseInt(day, 10);
  if (dd < 1 || dd > 31) return null;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.toISOString().slice(0, 10);
}

/**
 * Extract all dates/ranges/TBAs from a block of plain text.
 * @param {string} text
 * @param {number} inferredYear - fallback year for dates that omit one
 * @returns {Array<{raw, date, dateEnd, type, context, isTentative}>}
 */
function extractDates(text, inferredYear = new Date().getFullYear()) {
  const results = [];
  const claimedRanges = []; // char ranges already consumed by RANGE_RE / MONTH_RANGE_RE

  // 1. TBA
  let m;
  const tbaRe = new RegExp(TBA_RE.source, 'gi');
  while ((m = tbaRe.exec(text))) {
    results.push({
      raw: m[0], date: null, dateEnd: null, type: 'TBA',
      context: tagContext(getSnippet(text, m.index, m[0].length)),
      isTentative: false,
    });
  }

  // 2. Explicit day-day / month-day ranges
  const rangeRe = new RegExp(RANGE_RE.source, 'gi');
  while ((m = rangeRe.exec(text))) {
    const [full, , mon1, day1, , mon2, day2, year] = m;
    const startISO = toISO(mon1, day1, year, inferredYear);
    const endISO = toISO(mon2 || mon1, day2, year, inferredYear);
    if (startISO) {
      claimedRanges.push([m.index, m.index + full.length]);
      results.push({
        raw: full.trim(), date: startISO, dateEnd: endISO || startISO, type: 'range',
        context: tagContext(getSnippet(text, m.index, full.length)),
        isTentative: /tentative/i.test(getSnippet(text, m.index, full.length)),
      });
    }
  }

  // 3. Month-to-month ranges ("May – July 2026")
  const monRangeRe = new RegExp(MONTH_RANGE_RE.source, 'gi');
  while ((m = monRangeRe.exec(text))) {
    const [full, mon1, mon2, year] = m;
    const startISO = toISO(mon1, '1', year, inferredYear);
    if (startISO) {
      claimedRanges.push([m.index, m.index + full.length]);
      results.push({
        raw: full.trim(), date: startISO, dateEnd: null, type: 'period',
        context: tagContext(getSnippet(text, m.index, full.length)),
        isTentative: false,
      });
    }
  }

  // 4. Single dates (skip anything already inside a claimed range)
  const dateRe = new RegExp(DATE_RE.source, 'gi');
  while ((m = dateRe.exec(text))) {
    const inRange = claimedRanges.some(([s, e]) => m.index >= s && m.index < e);
    if (inRange) continue;
    const [full, mon, day, year] = m;
    const dayNum = parseInt(day, 10);
    if (dayNum > 31) continue; // guards against stray 4-digit years matching \d{1,2}
    const iso = toISO(mon, day, year, inferredYear);
    if (!iso) continue;
    const snippet = getSnippet(text, m.index, full.length);
    results.push({
      raw: full.trim(), date: iso, dateEnd: null, type: 'date',
      context: tagContext(snippet),
      isTentative: /tentative|estimated/i.test(snippet),
    });
  }

  return results;
}

// ==========================================================================
// Status classification — ported from the MS List helper-column formula.
// Needs a MinDate (earliest "open"-type date) and MaxDate (latest
// "deadline"-type date) for the *current/upcoming* cycle.
// ==========================================================================
function classifyStatus(minDate, maxDate, today = new Date()) {
  const DAY = 86400000;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (!maxDate) return 'Input Needed';
  const min = minDate ? Date.parse(minDate) : null;
  const max = Date.parse(maxDate);
  const daysSince = (ms) => Math.floor((t - ms) / DAY);
  const daysUntil = (ms) => Math.floor((ms - t) / DAY);

  if (min !== null && max <= t && min <= t) {
    // both in the past
    if (daysSince(min) >= 360) return 'Urgent: Update Needed Now';
    if (daysSince(min) >= 330) return 'Check for Deadline Immediately';
    if (daysSince(max) >= 180) return 'New Cycle Dates Pending';
    if (daysSince(max) >= 60) return 'Dormant (Cycle Closed)';
    if (daysSince(max) >= 8) return 'Results Pending';
    return 'Application Closed';
  }
  if (min !== null && min <= t && max >= t) return 'Application Open';
  if (min !== null && min === max) {
    if (daysUntil(max) >= 90) return 'Lookout for Open Date';
    if (daysUntil(max) >= 60) return 'App Open Soon if Not Now';
    if (daysUntil(max) >= 30) return 'Application Likely Open';
    if (daysUntil(max) >= 0) return 'Application Likely Closing Soon';
  }
  if (min !== null && max > min && daysUntil(min) >= 20) return 'Dormant (Waiting for App to Open)';
  if (min !== null && daysUntil(min) >= 0 && daysUntil(min) <= 19) return 'App Opening Soon';
  if (daysUntil(max) >= 1 && daysUntil(max) <= 14) return 'Application Closing Soon';
  if (daysUntil(max) > 14) return 'Application Open';
  return 'Application Closed';
}

const STALE_STATUSES = new Set([
  'Urgent: Update Needed Now',
  'Check for Deadline Immediately',
  'New Cycle Dates Pending',
  'Dormant (Cycle Closed)',
]);

module.exports = { extractDates, tagContext, classifyStatus, STALE_STATUSES };
