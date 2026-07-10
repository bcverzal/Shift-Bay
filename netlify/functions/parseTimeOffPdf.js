const path = require("path");
const { pathToFileURL } = require("url");

let pdfjsPromise = null;

function ensurePdfPolyfills() {
  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      translateSelf() { return this; }
      scaleSelf() { return this; }
      rotateSelf() { return this; }
      invertSelf() { return this; }
      transformPoint(point) { return point; }
    };
  }
  if (!globalThis.ImageData) globalThis.ImageData = class ImageData {};
  if (!globalThis.Path2D) globalThis.Path2D = class Path2D {};
}

async function loadPdfJs() {
  ensurePdfPolyfills();
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.resolve().then(async () => {
      const workerUrl = pathToFileURL(path.join(process.cwd(), "assets", "vendor", "pdf.worker.mjs")).href;
      globalThis.pdfjsWorker = await import(workerUrl);
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function cleanCell(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeImportDate(value) {
  const match = cleanCell(value).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !day || !year) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function splitReportName(value) {
  const text = cleanCell(value).replace(/^,+|,+$/g, "");
  if (!text) return { firstName: "", lastName: "" };
  if (text.includes(",")) {
    const [lastName, firstName] = text.split(",", 2).map(cleanCell);
    return { firstName, lastName };
  }
  const parts = text.split(/\s+/);
  return { firstName: parts.shift() || "", lastName: parts.join(" ") };
}

function normalizeRequestTimeLabel(value) {
  const match = cleanCell(value).match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)$/i);
  if (!match) return cleanCell(value).toUpperCase();
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const period = match[3].toLowerCase().startsWith("p") ? "PM" : "AM";
  if (hour > 12) hour -= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute.padStart(2, "0")} ${period}`;
}

function requestDaypart(info) {
  const text = cleanCell(info);
  if (/\bAll\s+Day\b/i.test(text)) return "All day";
  const range = text.match(/\b(\d{1,2}(?::?\d{2})?\s*(?:a|am|p|pm))\s*(?:to|-|until|through|thru)\s*(\d{1,2}(?::?\d{2})?\s*(?:a|am|p|pm))\b/i);
  return range ? `${normalizeRequestTimeLabel(range[1])} to ${normalizeRequestTimeLabel(range[2])}` : "";
}

function columnForX(x) {
  if (x < 122) return "submitted";
  if (x < 150) return "recurring";
  if (x < 205) return "employee";
  if (x < 245) return "date";
  if (x < 295) return "info";
  if (x < 340) return "note";
  if (x < 452) return "approvedBy";
  return "";
}

function joinColumnItems(items) {
  return items
    .sort((a, b) => (b.y - a.y) || (a.x - b.x))
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowToRequest(row, fileName) {
  const byColumn = {};
  row.forEach((item) => {
    const column = columnForX(item.x);
    if (!column) return;
    if (!byColumn[column]) byColumn[column] = [];
    byColumn[column].push(item);
  });
  const cells = Object.fromEntries(Object.entries(byColumn).map(([key, items]) => [key, joinColumnItems(items)]));
  cells.employee = cleanCell(cells.employee).replace(/\bEmployee\b/gi, "").trim();
  cells.date = cleanCell(cells.date).replace(/\bDOB\b/gi, "").trim();
  cells.info = cleanCell(cells.info).replace(/\bInformation\b/gi, "").trim();
  cells.note = cleanCell(cells.note).replace(/\bNote\b/gi, "").trim();
  cells.approvedBy = cleanCell(cells.approvedBy).replace(/\bApproved\b|\bBy\b/gi, "").trim();
  if (!cells.employee || !cells.date || !cells.info) return null;
  if (/^Employee$/i.test(cells.employee)) return null;
  const date = normalizeImportDate(cells.date) || normalizeImportDate(cells.info);
  if (!date) return null;
  const { firstName, lastName } = splitReportName(cells.employee);
  if (!firstName && !lastName) return null;
  const statusMatch = cleanCell(`${cells.info} ${cells.note} ${cells.approvedBy}`).match(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/i);
  const note = cleanCell(cells.note).replace(/\b(Active|Pending|Denied|Canceled|Cancelled)\b$/i, "").trim();
  return {
    firstName,
    lastName,
    date,
    daypart: requestDaypart(cells.info),
    note,
    status: statusMatch ? statusMatch[1][0].toUpperCase() + statusMatch[1].slice(1).toLowerCase() : "",
    approvedBy: cleanCell(cells.approvedBy).replace(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/i, "").trim(),
    recurring: cells.recurring || "",
    source: `Ctuit RO PDF: ${fileName}`
  };
}

function parsePageItems(items, fileName) {
  const textItems = items
    .map((item) => ({
      text: cleanCell(item.str),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0
    }))
    .filter((item) => item.text);
  const anchors = textItems
    .filter((item) => item.x >= 65 && item.x < 120 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(item.text))
    .sort((a, b) => b.y - a.y);
  const requests = [];
  anchors.forEach((anchor, index) => {
    const nextY = anchors[index + 1]?.y ?? 80;
    const previousY = anchors[index - 1]?.y;
    const rowTop = previousY ? Math.min(anchor.y + 24, anchor.y + ((previousY - anchor.y) * 0.5)) : anchor.y + 34;
    const previousGap = previousY ? previousY - anchor.y : 999;
    const noteTop = previousY
      ? (previousGap < 70 ? anchor.y + 12 : Math.min(previousY - 14, anchor.y + 140))
      : anchor.y + 140;
    const rowItems = textItems.filter((item) => {
      const column = columnForX(item.x);
      if (column === "note") return item.y <= noteTop && item.y > nextY + 4;
      return item.y <= rowTop && item.y > nextY + 4;
    });
    const request = rowToRequest(rowItems, fileName);
    if (request) requests.push(request);
  });
  return requests;
}

async function parseTimeOffPdfPayload(payload) {
  const pdfjs = await loadPdfJs();
  const results = [];
  const errors = [];
  for (const [index, item] of (payload.files || []).entries()) {
    const fileName = cleanCell(item.name) || `request-off-${index + 1}.pdf`;
    try {
      const data = Uint8Array.from(Buffer.from(item.dataBase64 || "", "base64"));
      const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
      const requests = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        requests.push(...parsePageItems(content.items || [], fileName));
      }
      results.push({ fileName, pages: document.numPages, requests });
    } catch (error) {
      errors.push({ fileName, error: error.message || "Could not parse PDF." });
    }
  }
  const requests = [];
  const seen = new Set();
  let duplicates = 0;
  results.forEach((result) => {
    result.requests.forEach((request) => {
      const key = [request.firstName, request.lastName, request.date, request.daypart, request.note]
        .map((value) => cleanCell(value).toLowerCase())
        .join("|");
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      requests.push(request);
    });
  });
  return { requests, source: "Ctuit RO PDF", diagnostics: { files: results, errors, duplicates } };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const payload = JSON.parse(event.body || "{}");
    return json(200, await parseTimeOffPdfPayload(payload));
  } catch (error) {
    return json(400, { error: error.message || "Could not parse request-off PDF." });
  }
};
