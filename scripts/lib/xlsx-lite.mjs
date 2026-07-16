import { inflateRawSync } from "node:zlib";

function readUInt32LE(buf, offset) {
  return buf.readUInt32LE(offset);
}

function readUInt16LE(buf, offset) {
  return buf.readUInt16LE(offset);
}

function filesFromZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (readUInt32LE(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("XLSX ZIP end record not found");

  const entries = readUInt16LE(buf, eocd + 10);
  let ptr = readUInt32LE(buf, eocd + 16);
  const files = new Map();

  for (let i = 0; i < entries; i++) {
    if (readUInt32LE(buf, ptr) !== 0x02014b50) throw new Error("Invalid XLSX central directory");
    const method = readUInt16LE(buf, ptr + 10);
    const compressedSize = readUInt32LE(buf, ptr + 20);
    const nameLen = readUInt16LE(buf, ptr + 28);
    const extraLen = readUInt16LE(buf, ptr + 30);
    const commentLen = readUInt16LE(buf, ptr + 32);
    const localOffset = readUInt32LE(buf, ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");

    if (readUInt32LE(buf, localOffset) !== 0x04034b50) throw new Error(`Invalid XLSX local header for ${name}`);
    const localNameLen = readUInt16LE(buf, localOffset + 26);
    const localExtraLen = readUInt16LE(buf, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (data) files.set(name, data.toString("utf8"));

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

// Read ordinary text files from a ZIP archive. This reuses the same small,
// dependency-free ZIP reader used for XLSX workbooks.
export function readZipTextFiles(buffer) {
  return filesFromZip(buffer);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

function xmlText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function colIndex(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/i)?.[0] || "A";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((m) => xmlText(m[0]));
}

function parseCell(cellXml, strings) {
  const open = cellXml.match(/^<c\b[^>]*>/)?.[0] || "";
  const type = attr(open, "t");
  if (type === "inlineStr") return xmlText(cellXml.match(/<is\b[\s\S]*?<\/is>/)?.[0] || "");
  const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "str") return xmlText(raw);
  if (raw === "") return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : xmlText(raw);
}

function parseSheetXml(xml, strings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b[\s\S]*?<\/c>/g)) {
      const open = cellMatch[0].match(/^<c\b[^>]*>/)?.[0] || "";
      row[colIndex(attr(open, "r"))] = parseCell(cellMatch[0], strings);
    }
    rows.push(row.map((v) => v ?? ""));
  }
  return rows;
}

export function readFirstSheetRows(buffer) {
  const files = filesFromZip(buffer);
  const strings = sharedStrings(files.get("xl/sharedStrings.xml"));
  const sheetName = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetName) throw new Error("No worksheet found in XLSX file");
  return parseSheetXml(files.get(sheetName), strings);
}

// List sheet tab names in workbook order (e.g. ["Change", "2025", "2024", ...]).
export function readSheetNames(buffer) {
  const files = filesFromZip(buffer);
  const workbookXml = files.get("xl/workbook.xml");
  if (!workbookXml) throw new Error("No workbook.xml found in XLSX file");
  return [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => attr(m[0], "name"));
}

// Read rows from a specific sheet by tab name (e.g. "2025").
export function readSheetRowsByName(buffer, sheetName) {
  const files = filesFromZip(buffer);
  const workbookXml = files.get("xl/workbook.xml");
  const relsXml = files.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) throw new Error("Missing workbook.xml or rels in XLSX file");
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].find((m) => attr(m[0], "name") === sheetName)?.[0];
  if (!sheetTag) throw new Error(`Sheet "${sheetName}" not found in XLSX file`);
  const rid = attr(sheetTag, "r:id");
  const relTag = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)].find((m) => attr(m[0], "Id") === rid)?.[0];
  if (!relTag) throw new Error(`Relationship "${rid}" not found for sheet "${sheetName}"`);
  const target = `xl/${attr(relTag, "Target").replace(/^\.?\//, "")}`;
  const xml = files.get(target);
  if (!xml) throw new Error(`Worksheet part "${target}" not found for sheet "${sheetName}"`);
  const strings = sharedStrings(files.get("xl/sharedStrings.xml"));
  return parseSheetXml(xml, strings);
}
