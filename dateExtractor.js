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

const MONTH_RE = 'January|February|March|April|May|June|July|August|September|Sept|Sep|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Oct|Nov|Dec';

// "Month Day, Year" or "Month Day" (year inferred from context if absent)
const DATE_RE = new RegExp(`(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, 'gi');

// Ranges: "September 29 - October 6, 2026" / "Sept 2-15, 2026" / "Sep. 22- Oct 1"
const RANGE_RE = new RegExp(
  `(between\\s+|from\\s+|week of\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})\\s*(-|–|—|to|and)\\s*(?:(${MONTH_RE})\\.?\\s+)?(\\d{1,2})(?:,?\\s*(\\d{4}))?`,
  'gi'
);

// Bare month-to-month ranges: "May – July 2026"
const MONTH_RANGE_RE = new RegExp(
  `(${MONTH_RE})\\.?\\s*[-–—]\\s*(${MONTH_RE})\\.?\\s+(\\d{4})`,
  'gi'
);

// "TBA"
const TBA_RE = /(\w+)\s+(?:APPLICATION\s+DUE\s+DATE|DUE\s+DATE|DEADLINE|DATES|DATE)\s+TBA/gi;

// Seasonal periods: "Fall 2026", "Early Spring 2027", "Mid-to-late Summer 2026".
// Ported from the VBA's FindPeriods, which explicitly handled season words —
// missed in the initial JS port, which only recognized month names. A phrase
// like "will be available Fall 2026" carries real signal even with no exact
// date, and shouldn't produce nothing.
const SEASON_RE = /\b(early|late|mid(?:-to-late)?)?[\s-]*(spring|summer|fall|autumn|winter)\.?\s+(\d{4})\b/gi;
// Representative day-of-year per season (astronomical-ish, "mid" of season),
// shifted earlier/later for Early/Late modifiers. Good enough for min/max
// date-range classification — not meant to be a precise calendar date.
const SEASON_ANCHOR = { spring: [3, 20], summer: [6, 21], fall: [9, 22], autumn: [9, 22], winter: [12, 21] };

// Context keyword categories — ported from GetContextTag/GetVerbNounTag.
// ORDER MATTERS: most specific first. A bare "deadline" is the least
// informative signal and must be checked LAST among the meaningful
// categories, otherwise "Recommendation letters deadline: Jan 11" gets
// swallowed into generic "deadline" before ever reaching "recommenders".
//
// Two categories worth flagging as still-uncertain assumptions:
//  - internal_deadline: "deadline to apply for/receive Emory's internal
//    endorsement" (confirmed distinct from feedback_deadline below).
//  - feedback_deadline: "deadline to begin advising process to receive
//    feedback on drafts" — split out from internal_deadline after
//    confirming these are NOT the same gate in your process.
const CONTEXT_CATEGORIES = [
  {
    tag: 'recommenders',
    patterns: [
      /letters?\s+of\s+recommendation/i,
      /recommendation\s+letters?/i,
      /recommenders?.{0,25}(due|deadline|submit|upload)/i,
      /(due|deadline|submit).{0,25}recommenders?/i,
      /follow.?up\s+with\s+recommenders/i,
      /letter.{0,20}(due|deadline)/i,
    ],
  },
  {
    tag: 'feedback_deadline',
    patterns: [
      /receive\s+feedback/i,
      /request\s+feedback/i,
      /feedback\s+(deadline|due|on)/i,
      /begin\s+the\s+advising\s+process/i,
    ],
  },
  {
    tag: 'internal_deadline',
    patterns: [
      /internal\s*(application)?\s*deadline/i,
      /institutional\s+endorsement/i,
      /indicate\s+your\s+intent\s+to\s+apply/i,
      /internal\s+application/i,
      /campus\s+deadline/i,
    ],
  },
  { tag: 'interview', patterns: [/campus\s+interview/i, /practice\s+interview/i, /\binterview/i] },
  { tag: 'results', patterns: [/admissions?\s+decisions?/i, /selection\s+cycle/i, /notification/i, /finalists?/i, /awardees?\s+announced/i, /scholars?\s+announced/i] },
  { tag: 'open', patterns: [/application(s)?\s+open/i, /open\s+date/i, /application\s+period/i, /now\s+open/i, /begin\s+online\s+application/i, /register\s+and\s+begin/i, /\bopens\b/i, /will\s+be\s+available/i, /available\s+(starting|beginning|in)/i] },
  {
    tag: 'deadline', // generic catch-all — deliberately last
    patterns: [/final\s+application\s+deadline/i, /application\s+deadline/i, /submit.{0,15}application/i, /must\s+be\s+submitted/i, /nomination\s+submission\s+deadline/i, /due\s+date/i, /\bdeadline/i],
  },
];

// Deadline-flavored tags that only make sense for a PUNCTUAL date, not a
// span of time. A date RANGE describes a period (e.g. a program's session
// dates), not a due date — so even if "deadline" happens to appear nearby
// (e.g. a page-level header bleeding in), a range should never be tagged as
// one of these. This is what was misfiring on Amgen's page: 14 program-date
// RANGES were getting tagged "deadline" because a single "APPLICATION
// DEADLINE:" header sat at the top of an otherwise separator-free block.
const PUNCTUAL_ONLY_TAGS = new Set(['deadline', 'internal_deadline', 'feedback_deadline', 'recommenders']);

function tagContext(snippet, opts) {
  const isRange = opts && opts.isRange;
  for (const cat of CONTEXT_CATEGORIES) {
    if (isRange && PUNCTUAL_ONLY_TAGS.has(cat.tag)) continue;
    if (cat.patterns.some((p) => p.test(snippet))) return cat.tag;
  }
  return 'other';
}

// Sentence-boundary extraction — ported from the VBA's GetSentenceAtPosition.
// Walks outward from a match position to the nearest boundary character
// (newline, period, tab, or middle-dot), rather than a fixed character
// radius — but capped at MAX_WALK so a boundary-free block of text (e.g. a
// densely packed table with no periods) can't let a distant, unrelated
// header bleed all the way into every date's context.
const MAX_WALK = 150;
function getSentenceAt(text, pos, matchLen) {
  const isBoundary = (ch) => ch === '\n' || ch === '\r' || ch === '.' || ch === '\t' || ch === '\u00B7';
  let start = pos;
  while (start > 0 && pos - start < MAX_WALK && !isBoundary(text[start - 1])) start--;
  let end = pos + matchLen;
  while (end < text.length && end - (pos + matchLen) < MAX_WALK && !isBoundary(text[end])) end++;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
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
 * @returns {Array<{raw, date, dateEnd, type, context, isTentative, hint}>}
 *   `hint` is the nearby text the tagger saw when deciding the context —
 *   always populated so any tag (not just unresolved "other" ones) can be
 *   spot-checked against its source, since a confident-but-wrong tag (e.g.
 *   a deadline mislabeled "open" because "Application Opens" bled in from
 *   an adjacent sentence) is just as important to catch as an unresolved one.
 */
function extractDates(text, inferredYear) {
  if (inferredYear === undefined) inferredYear = new Date().getFullYear();
  const results = [];
  const claimedRanges = []; // char ranges already consumed by RANGE_RE / MONTH_RANGE_RE

  // A date with no explicit year (e.g. "the October 16 deadline" appearing
  // later in a doc that said "October 16, 2025" earlier) should inherit that
  // document's actual cycle year, not whatever year the scraper happens to
  // run in. Blindly using the scrape-time year turned "October 16" into
  // "October 16, 2026" — a full year wrong and in the FUTURE relative to the
  // real Nov 2025 cycle — which silently corrupted status classification.
  // Build a position->year map from every 4-digit 20xx year actually written
  // in the text, and for any match missing a year, use the nearest one.
  const yearPositions = [];
  const yearScanRe = /\b(20\d{2})\b/g;
  let ym;
  while ((ym = yearScanRe.exec(text))) {
    yearPositions.push({ pos: ym.index, year: parseInt(ym[1], 10) });
  }
  function nearestYear(pos) {
    if (!yearPositions.length) return inferredYear;
    let best = yearPositions[0], bestDist = Math.abs(pos - best.pos);
    for (const yp of yearPositions) {
      const dist = Math.abs(pos - yp.pos);
      if (dist < bestDist) { best = yp; bestDist = dist; }
    }
    return best.year;
  }

  const withHint = (entry, snippet) => {
    entry.hint = snippet;
    return entry;
  };

  // 1. TBA
  let m;
  const tbaRe = new RegExp(TBA_RE.source, 'gi');
  while ((m = tbaRe.exec(text))) {
    const snippet = getSentenceAt(text, m.index, m[0].length);
    results.push(withHint({
      raw: m[0], date: null, dateEnd: null, type: 'TBA',
      context: tagContext(snippet),
      isTentative: false,
    }, snippet));
  }

  // 2. Explicit day-day / month-day ranges
  const rangeRe = new RegExp(RANGE_RE.source, 'gi');
  while ((m = rangeRe.exec(text))) {
    const full = m[0], mon1 = m[2], day1 = m[3], mon2 = m[5], day2 = m[6], year = m[7];
    const startISO = toISO(mon1, day1, year, nearestYear(m.index));
    const endISO = toISO(mon2 || mon1, day2, year, nearestYear(m.index));
    if (startISO) {
      claimedRanges.push([m.index, m.index + full.length]);
      const snippet = getSentenceAt(text, m.index, full.length);
      results.push(withHint({
        raw: full.trim(), date: startISO, dateEnd: endISO || startISO, type: 'range',
        context: tagContext(snippet, { isRange: true }),
        isTentative: /tentative/i.test(snippet),
      }, snippet));
    }
  }

  // 3. Month-to-month ranges ("May – July 2026")
  const monRangeRe = new RegExp(MONTH_RANGE_RE.source, 'gi');
  while ((m = monRangeRe.exec(text))) {
    const full = m[0], mon1 = m[1], mon2 = m[2], year = m[3];
    const startISO = toISO(mon1, '1', year, nearestYear(m.index));
    if (startISO) {
      claimedRanges.push([m.index, m.index + full.length]);
      const snippet = getSentenceAt(text, m.index, full.length);
      results.push(withHint({
        raw: full.trim(), date: startISO, dateEnd: null, type: 'period',
        context: tagContext(snippet, { isRange: true }),
        isTentative: false,
      }, snippet));
    }
  }

  // 3b. Seasonal periods ("Fall 2026", "Early Spring 2027") — not month
  // names, so DATE_RE/RANGE_RE never see these at all without this branch.
  const seasonRe = new RegExp(SEASON_RE.source, 'gi');
  while ((m = seasonRe.exec(text))) {
    const full = m[0], modifier = (m[1] || '').toLowerCase(), season = m[2].toLowerCase(), year = m[3];
    const anchor = SEASON_ANCHOR[season];
    if (!anchor) continue;
    let [mm, dd] = anchor;
    if (modifier === 'early') dd = Math.max(1, dd - 15);
    else if (modifier === 'late') dd = Math.min(28, dd + 15);
    const d = new Date(Date.UTC(parseInt(year, 10), mm - 1, dd));
    const iso = d.toISOString().slice(0, 10);
    claimedRanges.push([m.index, m.index + full.length]);
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'period',
      context: tagContext(snippet, { isRange: true }), // treated like a range: a season is a span, not a punctual deadline
      isTentative: true, // seasonal estimates are inherently approximate — always flagged so status logic doesn't treat them as firm
    }, snippet));
  }

  // 4. Single dates (skip anything already inside a claimed range)
  const dateRe = new RegExp(DATE_RE.source, 'gi');
  while ((m = dateRe.exec(text))) {
    const inRange = claimedRanges.some(function (r) { return m.index >= r[0] && m.index < r[1]; });
    if (inRange) continue;
    const full = m[0], mon = m[1], day = m[2], year = m[3];
    const dayNum = parseInt(day, 10);
    if (dayNum > 31) continue; // guards against stray 4-digit years matching \d{1,2}
    const iso = toISO(mon, day, year, nearestYear(m.index));
    if (!iso) continue;
    const snippet = getSentenceAt(text, m.index, full.length);
    results.push(withHint({
      raw: full.trim(), date: iso, dateEnd: null, type: 'date',
      context: tagContext(snippet),
      isTentative: /tentative|estimated/i.test(snippet),
    }, snippet));
  }

  return results;
}

// ==========================================================================
// Status classification — ported from the MS List helper-column formula.
// Needs a MinDate (earliest "open"-type date) and MaxDate (latest
// "deadline"-type date) for the *current/upcoming* cycle.
// ==========================================================================
function classifyStatus(minDate, maxDate, today) {
  if (today === undefined) today = new Date();
  const DAY = 86400000;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (!maxDate) return 'Input Needed';
  const min = minDate ? Date.parse(minDate) : null;
  const max = Date.parse(maxDate);
  const daysSince = function (ms) { return Math.floor((t - ms) / DAY); };
  const daysUntil = function (ms) { return Math.floor((ms - t) / DAY); };

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

// "Lookout for Open Date" deliberately excluded — it fires whenever only a
// single far-future date is on file (no explicit "open" date found), which
// is a normal steady-state for many awards, not an actionable problem.
const STALE_STATUSES = new Set([
  'Urgent: Update Needed Now',
  'Check for Deadline Immediately',
]);

module.exports = { extractDates, tagContext, classifyStatus, STALE_STATUSES };
