// Parses awards.csv into awardList.json for the scraper to consume.
// awards.csv is the editable source of truth — GitHub renders .csv files
// with an inline spreadsheet editor in the web UI, so this can be edited
// directly in the browser without needing Excel or any local tooling.
const fs = require('fs');
const { parse } = require('csv-parse/sync');

function na(v) { return v && v.trim() ? v.trim() : null; }

const csvText = fs.readFileSync(__dirname + '/awards.csv', 'utf8');
const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

const awards = records.map((row) => ({
  name: row['Award Name'],
  external: na(row['External']),
  awardFinder: na(row['Award Finder']),
  canvas: na(row['Canvas']),
  procedures: na(row['Procedures']),
  cascadeEdit: na(row['Cascade Edit']),
})).filter((a) => a.name && a.awardFinder); // only track awards with at least a name and our own page

fs.writeFileSync(__dirname + '/awardList.json', JSON.stringify(awards, null, 2));
console.log(`Parsed ${awards.length} awards from awards.csv`);
