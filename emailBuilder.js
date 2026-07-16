const SOURCE_LABELS = { procedures: 'Procedures PDF', awardFinder: 'Award Finder Page', external: 'External Site' };

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function link(url, label) {
  return url ? `<a href="${url}" target="_blank">${label}</a>` : label;
}

function buildSummaryRows(reports) {
  const rows = [];
  for (const r of reports) {
    const L = (key) => link(r.sourceUrls && r.sourceUrls[key], SOURCE_LABELS[key]);
    for (const d of r.discrepancies) {
      if (d.type === 'deadline_mismatch') {
        const [srcA, srcB] = Object.keys(d).filter((k) => k in SOURCE_LABELS);
        rows.push({
          award: r.awardName, kind: 'Date mismatch',
          detail: `${L(srcA)}: ${fmt(d[srcA])} &nbsp;vs&nbsp; ${L(srcB)}: ${fmt(d[srcB])} (${d.daysApart}d apart)`,
        });
      } else if (d.type === 'stale') {
        rows.push({
          award: r.awardName, kind: 'Stale',
          detail: `${L(d.source)}: status "${d.status}" (dates span ${fmt(d.min)}–${fmt(d.max)})`,
        });
      }
    }
    for (const a of r.actionItems) {
      if (a.type === 'broken_link') rows.push({ award: r.awardName, kind: 'Broken link', detail: `${L(a.source)} did not load — <a href="${r.sourceUrls[a.source]}" target="_blank">${r.sourceUrls[a.source]}</a>` });
      if (a.type === 'no_dates_found') rows.push({ award: r.awardName, kind: 'No dates found', detail: `${L(a.source)} — check if this is still the right URL to track` });
      if (a.type === 'stale_recipients') rows.push({ award: r.awardName, kind: 'Recipients outdated', detail: `${a.reason} — ${link(r.sourceUrls.awardFinder, 'view recipients page')}` });
    }
  }
  return rows;
}

function buildRawDumpSection(reports) {
  return reports.map((r) => {
    const sourceBlocks = Object.entries(SOURCE_LABELS).map(([key, label]) => {
      const status = r.sourceStatus[key];
      const labelLink = link(r.sourceUrls && r.sourceUrls[key], label);
      if (status === 'not_tracked') return '';
      if (status === 'broken_link') return `<div class="src"><strong>${labelLink}:</strong> <span class="flag">broken link</span></div>`;
      if (status === 'no_dates_found') return `<div class="src"><strong>${labelLink}:</strong> <span class="flag">no dates found</span></div>`;
      const dates = (r.rawDates[key] || []).map((d) => `${d.raw} <em>(${d.context})</em>`).join('; ') || '—';
      return `<div class="src"><strong>${labelLink}:</strong> ${dates}</div>`;
    }).join('');
    return `<div class="award-block"><h3>${r.awardName}</h3>${sourceBlocks}</div>`;
  }).join('');
}

function buildEmailHTML(reports) {
  const summaryRows = buildSummaryRows(reports);
  const summaryHTML = summaryRows.length
    ? `<table class="summary"><tr><th>Award</th><th>Issue</th><th>Detail</th></tr>${summaryRows.map((row) =>
        `<tr><td>${row.award}</td><td class="kind kind-${row.kind.replace(/\s+/g, '-').toLowerCase()}">${row.kind}</td><td>${row.detail}</td></tr>`
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
    .award-block { border-top: 1px solid #eee; padding-top: 6px; }
    .src { font-size: 12px; margin: 2px 0; }
    .flag { color: #b30000; font-weight: bold; }
  </style></head><body>
    <h1>Weekly Award Date Discrepancy Report</h1>
    <h2>Summary — needs review</h2>
    ${summaryHTML}
    <h2>Full date dump (all sources)</h2>
    ${buildRawDumpSection(reports)}
  </body></html>`;
}

module.exports = { buildEmailHTML };
