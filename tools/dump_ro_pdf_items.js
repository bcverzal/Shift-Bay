const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node tools/dump_ro_pdf_items.js <pdf>");
const pdfModule = process.env.SHIFT_BAY_PDFJS;
if (!pdfModule) throw new Error("SHIFT_BAY_PDFJS is required");

async function main() {
  const pdfjs = await import(pathToFileURL(pdfModule).href);
  const data = new Uint8Array(fs.readFileSync(filePath));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    console.log(`--- page ${pageNumber} ---`);
    content.items
      .map((item) => ({ text: String(item.str || "").replace(/\s+/g, " ").trim(), x: Number(item.transform?.[4]) || 0, y: Number(item.transform?.[5]) || 0 }))
      .filter((item) => item.text)
      .sort((a, b) => (b.y - a.y) || (a.x - b.x))
      .forEach((item) => console.log(`${item.y.toFixed(2)}\t${item.x.toFixed(2)}\t${item.text}`));
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
