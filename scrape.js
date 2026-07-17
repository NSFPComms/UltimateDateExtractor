const fs = require('fs');
const path = require('path');
const awards = require('./awardList.json');
const { fetchProceduresPDF, fetchAwardFinderPage, fetchExternalPage } = require('./fetchers');
const { buildAwardReport } = require('./reportBuilder');
const { buildEmailHTML } = require('./emailBuilder');

const CURRENT_YEAR = new Date().getFullYear();

async function run() {
  const reports = [];

  for (const award of awards) {
    console.log(`Scraping: ${award.name}`);

    try {
      const [proceduresResult, awardFinder, external] = await Promise.all([
        fetchProceduresPDF(award.procedures),
        fetchAwardFinderPage(award.awardFinder),
        fetchExternalPage(award.external),
      ]);

      const report = buildAwardReport(
        award.name,
        {
          procedures: proceduresResult,
          awardFinder: awardFinder.result,
          external,
        },
        awardFinder.recipientsText,
        CURRENT_YEAR,
        { procedures: award.procedures, awardFinder: award.awardFinder, external: award.external }
      );
      reports.push(report);
    } catch (e) {
      console.error(`FAILED on award "${award.name}":`, e.stack || e.message);
      // Don't let one award's bug take down the whole run — record it as its
      // own action item so it's visible in the email instead of silently
      // missing from the report.
      reports.push({
        awardName: award.name,
        sourceStatus: {},
        sourceDetail: {},
        sourceUrls: { procedures: award.procedures, awardFinder: award.awardFinder, external: award.external },
        discrepancies: [],
        overallStatus: 'Scrape Error',
        overallMin: null,
        overallMax: null,
        actionItems: [{ type: 'scrape_error', detail: e.message }],
        recipientCheck: null,
        rawDates: {},
      });
    }

    // Be polite to external sites — small delay between awards
    await new Promise((r) => setTimeout(r, 500));
  }

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'discrepancies.json'), JSON.stringify(reports, null, 2));
  fs.writeFileSync(path.join(outDir, 'email-body.html'), buildEmailHTML(reports));

  const totalIssues = reports.reduce((n, r) => n + r.discrepancies.length + r.actionItems.length, 0);
  console.log(`Done. ${reports.length} awards scraped, ${totalIssues} total issues flagged.`);
  process.exit(0); // avoid hanging on any lingering keep-alive sockets from node-fetch
}

run().catch((e) => {
  console.error('Scrape failed:', e);
  process.exit(1);
});
