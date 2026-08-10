const SOURCE_LABELS = { procedures: 'Procedures PDF', awardFinder: 'Award Finder Page', external: 'External Site', annualDeadlines: 'Annual Deadlines Page' };
const SHAREPOINT_PROCEDURES_URL = 'https://emory.sharepoint.com/sites/ECNationalScholarshipsandFellowships/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FECNationalScholarshipsandFellowships%2FShared%20Documents%2FGeneral%2FNS%26FP%20Shared%20Files%20NEW%2FProcedures%2F2026%2D2027%20Procedures%2FReady%20For%20Review&viewid=bf2a0db9%2D9ed0%2D418c%2Da9a3%2D1810ebebd4b2&OR=EXCEL%2DWEB%2EBODY%2ENT&CT=1784266616451';

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function link(url, label) {
  return url ? `<a href="${url}" target="_blank">${label}</a>` : label;
}

// Small "Check (source) -> Edit (destination)" caption line under each issue.
// Edit destination depends on the source type:
//  - awardFinder issues -> Cascade edit page for that specific award
//  - procedures issues  -> the shared SharePoint procedures folder (not per-award)
//  - external/annualDeadlines issues -> no edit link, not our page to edit
//    (well, annualDeadlines IS our page too — just need its Cascade edit ID)
function buildCaption(sourceKey, sourceUrls) {
  const checkUrl = sourceUrls && sourceUrls[sourceKey];
  const checkLink = checkUrl ? `Check: ${link(checkUrl, SOURCE_LABELS[sourceKey] || sourceKey)}` : '';
  let editLink = '';
  if (sourceKey === 'awardFinder' && sourceUrls && sourceUrls.cascadeEdit) {
    editLink = `Edit: ${link(sourceUrls.cascadeEdit, 'Cascade')}`;
  } else if (sourceKey === 'procedures') {
    editLink = `Edit: ${link(SHAREPOINT_PROCEDURES_URL, 'SharePoint Procedures Folder')}`;
  }
  const parts = [checkLink, editLink].filter(Boolean);
  return parts.length ? `<div class="caption">${parts.join(' &nbsp;\u2192&nbsp; ')}</div>` : '';
}

// Compact abbreviated link row — Ex(ternal) | Af (Award Finder) | Cv (Canvas)
// | Pr(ocedures) | Cw (Cascade edit) | Ep (Edit Procedures/SharePoint) —
// shown next to every award so checking a source doesn't require scrolling
// to the reference table at the bottom. Only linked when the URL exists;
// otherwise shown as plain greyed-out text so it's visually obvious what's
// and isn't available for this award.
function buildLinkRow(sourceUrls) {
  const u = sourceUrls || {};
  const items = [
    ['Ex', u.external],
    ['Af', u.awardFinder],
    ['Cv', u.canvas],
    ['Pr', u.procedures],
    ['Cw', u.cascadeEdit],
    ['Ep', SHAREPOINT_PROCEDURES_URL],
  ];
  const parts = items.map(([abbr, url]) => url ? `<a href="${url}" target="_blank">${abbr}</a>` : `<span class="linkoff">${abbr}</span>`);
  return `<div class="linkrow">${parts.join(' ')}</div>`;
}

// Small status tag shown under an award's name — its current overall
// lifecycle status (Application Open, Check for Deadline Immediately, etc.)
function statusTag(status) {
  if (!status) return '';
  const cls = 'status-tag-' + status.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `<div class="status-tag ${cls}">${status}</div>`;
}

function buildSummaryRows(reports) {
  const rows = [];
  for (const r of reports) {
    const L = (key) => link(r.sourceUrls && r.sourceUrls[key], SOURCE_LABELS[key]);
    for (const d of r.discrepancies) {
      if (d.type === 'deadline_mismatch') {
        const parts = Object.entries(d.values).map(([src, dates]) => `${L(src)}: ${dates.map(fmt).join(' / ')}`);
        const caption = Object.keys(d.values).map((src) => buildCaption(src, r.sourceUrls)).join('');
        rows.push({
          award: r.awardName, report: r, kind: 'Date mismatch',
          detail: `${parts.join(' &nbsp;vs&nbsp; ')} (${d.daysApart}d apart) <span class="tag-note">[${d.category}]</span>`,
          caption,
        });
      } else if (d.type === 'stale') {
        const minLabel = d.minSource ? `${SOURCE_LABELS[d.minSource] || d.minSource} saw "${d.minRaw}"` : '';
        const maxLabel = d.maxSource ? `${SOURCE_LABELS[d.maxSource] || d.maxSource} saw "${d.maxRaw}"` : '';
        const attribution = [minLabel && `Earliest date (${fmt(d.min)}): ${minLabel}`, maxLabel && `Latest date (${fmt(d.max)}): ${maxLabel}`].filter(Boolean).join('<br>');
        // Caption only the sources that actually contributed the dates driving
        // this status — not a fixed guess at which sources "usually" matter.
        const relevantSources = [...new Set([d.minSource, d.maxSource].filter(Boolean))];
        const caption = relevantSources.map((k) => buildCaption(k, r.sourceUrls)).join('');
        rows.push({
          award: r.awardName, report: r, kind: 'Stale',
          detail: `Status: "${d.status}"<br>${attribution}`,
          caption,
        });
      }
    }
    for (const a of r.actionItems) {
      if (a.type === 'broken_link') rows.push({ award: r.awardName, report: r, kind: 'Broken link', detail: `${L(a.source)} did not load (${a.detail || 'unknown error'})`, caption: buildCaption(a.source, r.sourceUrls) });
      if (a.type === 'no_dates_found') rows.push({ award: r.awardName, report: r, kind: 'No dates found', detail: `${L(a.source)} — check if this is still the right URL to track<div class="hint">${a.detail || ''}</div>`, caption: buildCaption(a.source, r.sourceUrls) });
      if (a.type === 'stale_recipients') rows.push({ award: r.awardName, report: r, kind: 'Recipients outdated', detail: a.reason, caption: buildCaption('awardFinder', r.sourceUrls) });
      if (a.type === 'stale_url_year') rows.push({ award: r.awardName, report: r, kind: 'Stale URL year', detail: `${L(a.source)} URL contains ${a.urlYear} — try: <a href="${a.suggested}" target="_blank">${a.suggested}</a> or <a href="${a.suggestedAlt}" target="_blank">…${a.urlYear + 2}</a>`, caption: buildCaption(a.source, r.sourceUrls) });
      if (a.type === 'scrape_error') rows.push({ award: r.awardName, report: r, kind: 'Scrape error', detail: a.detail, caption: '' });
    }
  }
  return rows;
}

// Display order for status groups — most actionable first, "healthy" states last.
const STATUS_ORDER = [
  'Urgent: Update Needed Now',
  'Check for Deadline Immediately',
  'Lookout for Open Date',
  'Scrape Error',
  'No Dates Found',
  'Input Needed',
  'App Opening Soon',
  'App Open Soon if Not Now',
  'Application Likely Open',
  'Application Open',
  'Application Likely Closing Soon',
  'Application Closing Soon',
  'Dormant (Waiting for App to Open)',
  'Results Pending',
  'New Cycle Dates Pending',
  'Dormant (Cycle Closed)',
  'Application Closed',
];

function groupByStatus(reports) {
  const groups = new Map();
  for (const r of reports) {
    const key = r.overallStatus || 'No Dates Found';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    const ia = STATUS_ORDER.indexOf(a); const ib = STATUS_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return orderedKeys.map((key) => ({ status: key, awards: groups.get(key) }));
}

function buildRawDumpSection(reports) {
  const groups = groupByStatus(reports);
  return groups.map(({ status, awards }) => {
    const awardBlocks = awards.map((r) => {
      const sourceBlocks = Object.entries(SOURCE_LABELS).map(([key, label]) => {
        const srcStatus = r.sourceStatus[key];
        const labelLink = link(r.sourceUrls && r.sourceUrls[key], label);
        if (srcStatus === 'not_tracked') return '';
        if (srcStatus === 'broken_link') return `<div class="src"><strong>${labelLink}:</strong> <span class="flag">broken link (${(r.sourceDetail && r.sourceDetail[key]) || 'unknown'})</span></div>`;
        if (srcStatus === 'no_dates_found') return `<div class="src"><strong>${labelLink}:</strong> <span class="flag">no dates found</span> <span class="hint">${(r.sourceDetail && r.sourceDetail[key]) || ''}</span></div>`;
        const dates = (r.rawDates[key] || []).map((d) => {
          // Nearby text the tagger used, shown compactly so any tag —
          // confident or not — can be spot-checked against its source.
          const hintPart = d.hint ? ` <span class="hint">(saw: "${d.hint}")</span>` : '';
          return `${d.raw} <em>(${d.context})</em>${hintPart}`;
        }).join('; ') || '—';
        return `<div class="src"><strong>${labelLink}:</strong> ${dates}</div>`;
      }).join('');
      return `<div class="award-block"><h3>${r.awardName}${statusTag(r.overallStatus)}${buildLinkRow(r.sourceUrls)}</h3>${sourceBlocks}</div>`;
    }).join('');
    return `<div class="status-group"><h2 class="status-heading">${status} <span class="count">(${awards.length})</span></h2>${awardBlocks}</div>`;
  }).join('');
}

function buildLinksTable(reports) {
  const sorted = [...reports].sort((a, b) => a.awardName.localeCompare(b.awardName));
  const rows = sorted.map((r) => {
    const u = r.sourceUrls || {};
    const cell = (url) => url ? `<a href="${url}" target="_blank">link</a>` : '<span class="none">—</span>';
    return `<tr><td>${r.awardName}</td><td>${cell(u.external)}</td><td>${cell(u.awardFinder)}</td><td>${cell(u.canvas)}</td><td>${cell(u.procedures)}</td><td>${cell(u.cascadeEdit)}</td><td>${cell(SHAREPOINT_PROCEDURES_URL)}</td></tr>`;
  }).join('');
  return `<table class="summary"><tr><th>Award</th><th>External</th><th>Award Finder</th><th>Canvas</th><th>Procedures PDF</th><th>Edit (Cascade)</th><th>Edit Procedures (SharePoint)</th></tr>${rows}</table>`;
}

function buildEmailHTML(reports) {
  const summaryRows = buildSummaryRows(reports);
  const summaryHTML = summaryRows.length
    ? `<table class="summary"><tr><th>Award</th><th>Issue</th><th>Detail</th></tr>${summaryRows.map((row) =>
        `<tr><td>${row.award}${statusTag(row.report && row.report.overallStatus)}${buildLinkRow(row.report && row.report.sourceUrls)}</td><td class="kind kind-${row.kind.replace(/\s+/g, '-').toLowerCase()}">${row.kind}</td><td>${row.detail}${row.caption || ''}</td></tr>`
      ).join('')}</table>`
    : `<p>No discrepancies or action items this week. ✅</p>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; color: #222; }
    h1 { font-size: 18px; } h2 { font-size: 15px; margin-top: 28px; } h3 { font-size: 13px; margin: 14px 0 4px; }
    table.summary { border-collapse: collapse; width: 100%; margin-top: 8px; }
    table.summary th, table.summary td { border: 1px solid #ddd; padding: 6px 8px; font-size: 13px; text-align: left; }
    table.summary th { background: #f4f4f4; }
    .kind-date-mismatch { color: #b30000; font-weight: bold; }
    .kind-broken-link { color: #b30000; font-weight: bold; }
    .kind-no-dates-found { color: #a15c00; font-weight: bold; }
    .kind-recipients-outdated { color: #1a5fb4; font-weight: bold; }
    .kind-stale { color: #a15c00; font-weight: bold; }
    .kind-scrape-error { color: #b30000; font-weight: bold; background: #fff0f0; }
    .kind-stale-url-year { color: #a15c00; font-weight: bold; }
    .award-block { border-top: 1px solid #eee; padding-top: 6px; }
    .src { font-size: 12px; margin: 2px 0; }
    .flag { color: #b30000; font-weight: bold; }
    .hint { color: #888; font-style: italic; }
    .tag-note { color: #888; font-weight: normal; font-size: 11px; }
    .caption { font-size: 11px; color: #666; margin-top: 3px; }
    .caption a { color: #1a5fb4; }
    .status-group { margin-top: 22px; }
    .status-heading { background: #f0f4f8; padding: 6px 10px; border-left: 4px solid #1a5fb4; margin: 0 0 4px; }
    .status-heading .count { font-weight: normal; color: #666; font-size: 12px; }
    .none { color: #ccc; }
    .linkrow { font-size: 10px; margin-top: 3px; }
    .linkrow a { color: #1a5fb4; margin-right: 4px; text-decoration: none; }
    .linkoff { color: #ccc; margin-right: 4px; }
    .status-tag { display: inline-block; font-size: 10px; font-weight: normal; padding: 1px 6px; border-radius: 3px; margin: 3px 0; background: #eee; color: #555; }
    .status-tag-urgent-update-needed-now, .status-tag-check-for-deadline-immediately { background: #ffe0e0; color: #a30000; }
    .status-tag-application-open { background: #e0f5e0; color: #1a6b1a; }
    .status-tag-no-dates-found, .status-tag-scrape-error { background: #fff0f0; color: #a30000; }
  </style></head><body>
    <h1>Weekly Award Date Discrepancy Report</h1>
    <h2>Summary — needs review</h2>
    ${summaryHTML}
    <h2>Full date dump (all sources)</h2>
    ${buildRawDumpSection(reports)}
    <h2>All award links</h2>
    ${buildLinksTable(reports)}
  </body></html>`;
}

module.exports = { buildEmailHTML };
