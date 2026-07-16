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

    // Be polite to external sites — small delay between awards
    await new Promise((r) => setTimeout(r, 500));
  }

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'discrepancies.json'), JSON.stringify(reports, null, 2));
  fs.writeFileSync(path.join(outDir, 'email-body.html'), buildEmailHTML(reports));

  const totalIssues = reports.reduce((n, r) => n + r.discrepancies.length + r.actionItems.length, 0);
  console.log(`Done. ${reports.length} awards scraped, ${totalIssues} total issues flagged.`);
}

run().catch((e) => {
  console.error('Scrape failed:', e);
  process.exit(1);
});
