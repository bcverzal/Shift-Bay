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
      const pdfModule = process.env.SHIFT_BAY_PDFJS || "pdfjs-dist/legacy/build/pdf.mjs";
      const pdfjs = await import(pdfModule.includes(":\\") ? pathToFileURL(pdfModule).href : pdfModule);
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
    return { firstName: firstName.replace(new RegExp(`\\s+${lastName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`, "i"), "").trim(), lastName };
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
  // CTUIT places the request date near x=206 and the request details near x=241.
  // Keep the boundary between those columns narrow enough for compact reports.
  if (x < 230) return "date";
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

// A few CTUIT layouts place the submitted timestamp and the employee name on
// adjacent visual lines. Recover those rows from the actual requested-date
// column without changing the primary parser's ordering.
function parseRequestedDateRows(items, fileName) {
  const textItems = items
    .map((item) => ({
      text: cleanCell(item.str),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0
    }))
    .filter((item) => item.text);
  const anchors = textItems
    .filter((item) => item.x >= 190 && item.x < 230 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(item.text))
    .sort((a, b) => b.y - a.y);
  return anchors.map((anchor, index) => {
    const previousY = anchors[index - 1]?.y;
    const nextY = anchors[index + 1]?.y;
    const upper = previousY ? Math.min(anchor.y + 18, ((previousY + anchor.y) / 2) + 6) : anchor.y + 18;
    const lower = nextY ? Math.max(anchor.y - 30, ((anchor.y + nextY) / 2) - 6) : anchor.y - 30;
    return rowToRequest(textItems.filter((item) => item.y <= upper && item.y >= lower), fileName);
  }).filter((request) => request && request.daypart && request.firstName && request.lastName);
}

function pageItemsToText(items) {
  return items
    .map((item) => ({
      text: cleanCell(item.str),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0
    }))
    .filter((item) => item.text)
    .sort((a, b) => (b.y - a.y) || (a.x - b.x))
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCtuitChrome(text) {
  return cleanCell(text)
    .replace(/https:\/\/radar\.ctuit\.com\/\S+/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2},\s+\d{1,2}:\d{2}\s+[AP]M\s+Time Off Requests\b/gi, " ")
    .replace(/\bRadar\b|\bLabor Scheduling\b|\bHeart of America\b/gi, " ")
    .replace(/\bView Schedules\b|\bBuilder\b|\bTemplates\b|\bQuick Notes\b|\bSchedules\b|\bReports\b|\bCharts\b/gi, " ")
    .replace(/\bDate Submitted\b|\bRecurring\b|\bEmployee\b|\bDOB\b|\bInformation\b|\bNote\b|\bApproved By\b/gi, " ")
    .replace(/\bBlocked Dates\b|\bNo blocked dates found\b/gi, " ")
    .replace(/\bTime Off Requests\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRequestChunk(chunk, fileName) {
  let text = stripCtuitChrome(chunk);
  const submitted = text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s+[AP]M)\s+(.+)$/i);
  if (!submitted) return null;
  text = submitted[3].trim();
  let recurring = "";
  if (/^Weekly\b/i.test(text)) {
    recurring = "Weekly";
    text = text.replace(/^Weekly\b/i, "").trim();
  }
  const requestDateMatch = text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  if (!requestDateMatch) return null;
  const employeeText = cleanCell(text.slice(0, requestDateMatch.index));
  const date = normalizeImportDate(requestDateMatch[0]);
  const rest = cleanCell(text.slice(requestDateMatch.index + requestDateMatch[0].length));
  if (!employeeText || !date || /^Date\b/i.test(employeeText)) return null;
  const daypartMatch = rest.match(/\b(All\s+Day|\d{1,2}(?::?\d{2})?\s*(?:A|P)M?\s*(?:to|-|until|through|thru)\s*\d{1,2}(?::?\d{2})?\s*(?:A|P)M?)\b/i);
  if (!daypartMatch) return null;
  const daypart = requestDaypart(daypartMatch[0]);
  let note = cleanCell(rest.slice(daypartMatch.index + daypartMatch[0].length));
  let status = "";
  if (/\bApprove\s+Disallow\b/i.test(note)) status = "Pending";
  const statusMatch = note.match(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/i);
  if (statusMatch) status = statusMatch[1][0].toUpperCase() + statusMatch[1].slice(1).toLowerCase();
  note = note
    .replace(/\bGrace\s+Cole\b/gi, " ")
    .replace(/\bApprove\s+Disallow\b/gi, " ")
    .replace(/\bManager Note:\b/gi, " ")
    .replace(/\b(Active|Pending|Denied|Canceled|Cancelled)\b/gi, " ")
    .replace(/\b\d+\s+\d+\b/g, " ")
    .trim();
  const { firstName, lastName } = splitReportName(employeeText);
  if (!firstName && !lastName) return null;
  return {
    firstName,
    lastName,
    date,
    daypart,
    note,
    status,
    approvedBy: /Grace\s+Cole/i.test(rest) ? "Grace Cole" : "",
    recurring,
    source: `Ctuit RO PDF: ${fileName}`
  };
}

function parseTimeOffText(text, fileName) {
  const cleaned = stripCtuitChrome(text);
  const starts = [...cleaned.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M\b/g)].map((match) => match.index);
  const requests = [];
  starts.forEach((start, index) => {
    const end = starts[index + 1] ?? cleaned.length;
    const request = parseRequestChunk(cleaned.slice(start, end), fileName);
    if (request) requests.push(request);
  });
  return requests;
}

function requestKey(request) {
  return [request.firstName, request.lastName, request.date, request.daypart]
    .map((value) => cleanCell(value).toLowerCase())
    .join("|");
}

function plausibleReportName(request) {
  const name = `${request.firstName} ${request.lastName}`.trim();
  return Boolean(name)
    && !/[0-9]/.test(name)
    && !/\b(?:Approve|Disallow|Manager|All\s+Day|AM|PM|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(name);
}

function mergeRequests(primary, fallback) {
  const merged = [];
  const seen = new Set();
  const primaryByDate = new Map();
  primary.forEach((request) => {
    const key = `${request.date}|${cleanCell(request.daypart).toLowerCase()}`;
    const names = new Set(`${request.firstName} ${request.lastName}`.toLowerCase().split(/\s+/).filter(Boolean));
    if (!primaryByDate.has(key)) primaryByDate.set(key, []);
    primaryByDate.get(key).push(names);
  });
  [...primary, ...fallback].forEach((request) => {
    if (!request.firstName || !request.lastName || !plausibleReportName(request)) return;
    const key = requestKey(request);
    if (seen.has(key)) return;
    if (fallback.includes(request)) {
      const dateKey = `${request.date}|${cleanCell(request.daypart).toLowerCase()}`;
      const candidateNames = new Set(`${request.firstName} ${request.lastName}`.toLowerCase().split(/\s+/).filter(Boolean));
      const overlapsPrimary = (primaryByDate.get(dateKey) || []).some((names) => [...candidateNames].some((name) => names.has(name)));
      if (overlapsPrimary) return;
    }
    seen.add(key);
    merged.push(request);
  });
  return merged;
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
        const items = content.items || [];
        requests.push(...mergeRequests(
          mergeRequests(parsePageItems(items, fileName), parseRequestedDateRows(items, fileName)),
          parseTimeOffText(pageItemsToText(items), fileName)
        ));
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
      const key = requestKey(request);
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

// Exported for the local parser corpus tests. Netlify still uses handler above.
exports.parseTimeOffPdfPayload = parseTimeOffPdfPayload;
