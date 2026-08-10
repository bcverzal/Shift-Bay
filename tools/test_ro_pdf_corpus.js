const fs = require("node:fs");
const path = require("node:path");
const parser = require("../netlify/functions/parseTimeOffPdf");

const root = process.argv[2];
if (!root) throw new Error("Usage: node tools/test_ro_pdf_corpus.js <RO folder>");

const expectedRows = {
  "7-14-26_7-20-26/Time Off Requests 7-14_7-20 - 2.pdf": 20,
  "7-14-26_7-20-26/Time Off Requests 7-14_7-20.pdf": 25,
  "7-21-26_7-28-26/7-21-26_7-27-26.pdf": 0,
  "7-21-26_7-28-26/Time Off Requests 2.pdf": 22,
  "7-21-26_7-28-26/Time Off Requests.pdf": 25,
  "7-28_8-3/Time Off Requests 7-28_8-3-2.pdf": 11,
  "7-28_8-3/Time Off Requests 7-28_8-3.pdf": 25,
  "8-4_8-10/Time Off Requests 8-4_8-10.pdf": 25,
  "8-4_8-10/Time Off Requests 8-4_8-10_2.pdf": 8
};

function filesUnder(folder) {
  if (/\.pdf$/i.test(folder)) return [folder];
  const result = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(fullPath));
    else if (/\.pdf$/i.test(entry.name)) result.push(fullPath);
  }
  return result.sort();
}

async function main() {
  const files = filesUnder(root).map((filePath) => ({
    name: path.relative(root, filePath).replaceAll("\\", "/"),
    dataBase64: fs.readFileSync(filePath).toString("base64")
  }));
  const parsed = await parser.parseTimeOffPdfPayload({ files });
  if (process.env.RO_CORPUS_JSON === "1") {
    console.log(JSON.stringify(parsed));
    return;
  }
  for (const file of parsed.diagnostics.files) {
    console.log(`${file.fileName}: pages=${file.pages} requests=${file.requests.length}`);
    for (const request of file.requests) {
      console.log(`  ${request.firstName} ${request.lastName} | ${request.date} | ${request.daypart || "All day"}`);
    }
    if (process.env.RO_CORPUS_EXPECTED === "1") {
      const relative = path.relative(root, path.join(root, file.fileName)).replaceAll("\\", "/");
      const expected = expectedRows[relative];
      if (expected !== undefined && expected !== file.requests.length) {
        throw new Error(`${relative}: expected ${expected} requests, got ${file.requests.length}`);
      }
      for (const request of file.requests) {
        if (!request.firstName || !request.lastName) throw new Error(`${relative}: malformed name in parsed request`);
      }
    }
  }
  console.log(`TOTAL requests=${parsed.requests.length} parserDuplicates=${parsed.diagnostics.duplicates}`);
  if (parsed.diagnostics.errors.length) console.error(JSON.stringify(parsed.diagnostics.errors, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
