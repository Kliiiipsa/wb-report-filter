import { Zip, ZipDeflate } from "fflate";

/**
 * Запись .xlsx по частям, без сборки всей книги в памяти.
 *
 * Зачем: SheetJS строит книгу целиком (объект на каждую ячейку) и только потом
 * сжимает. На отчёте в сотню тысяч строк по 83 колонки вкладка упирается в
 * память, и кнопка «Скачать» внешне просто не срабатывает. Здесь XML листа
 * собирается пачками строк, сразу сжимается и копится уже в сжатом виде.
 *
 * Пишем минимально необходимый набор частей книги; оформление не используется,
 * даты в отчёте и так хранятся строками.
 */

export interface SheetData {
  name: string;
  /** Сколько строк на листе, включая шапку. */
  count: number;
  /** Строка по номеру (0 — шапка). Ленивая выдача: копия данных не создаётся. */
  row: (index: number) => unknown[];
}

/** Лист из готовой матрицы (первая строка — шапка). */
export function sheetFromMatrix(name: string, matrix: unknown[][]): SheetData {
  return { name, count: matrix.length, row: (i) => matrix[i] };
}

/** Лист из строк-объектов: значения берутся по заголовкам в момент записи. */
export function sheetFromObjects(
  name: string,
  headers: string[],
  rows: Record<string, unknown>[]
): SheetData {
  return {
    name,
    count: rows.length + 1,
    row: (i) => (i === 0 ? headers : headers.map((h) => rows[i - 1][h] ?? null)),
  };
}

const enc = new TextEncoder();

function esc(s: string): string {
  let out = s;
  if (out.indexOf("&") !== -1) out = out.replace(/&/g, "&amp;");
  if (out.indexOf("<") !== -1) out = out.replace(/</g, "&lt;");
  if (out.indexOf(">") !== -1) out = out.replace(/>/g, "&gt;");
  // Управляющие символы Excel не принимает.
  return out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

const COL_CACHE: string[] = [];
function colName(i: number): string {
  if (COL_CACHE[i]) return COL_CACHE[i];
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  COL_CACHE[i] = s;
  return s;
}

function cellXml(value: unknown, col: number, row: number): string {
  if (value === null || value === undefined || value === "") return "";
  const ref = `${colName(col)}${row}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const s = esc(String(value));
  if (s === "") return "";
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${s}</t></is></c>`;
}

function sheetHeaderXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<sheetData>"
  );
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map((n, i) => `<sheet name="${esc(n).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRelsXml(count: number): string {
  const rels = Array.from({ length: count }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  );
}

function contentTypesXml(count: number): string {
  const sheets = Array.from({ length: count }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets +
    "</Types>"
  );
}

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

/** Сколько строк листа превращаем в XML за один заход. */
const BATCH = 2000;

/**
 * Собирает книгу и отдаёт её как Blob. Между пачками строк отдаём управление
 * браузеру, чтобы вкладка не «замерзала» и можно было показывать прогресс.
 */
export async function buildXlsxBlob(
  sheets: SheetData[],
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let finished: (() => void) | null = null;
  let failed: ((e: Error) => void) | null = null;
  const done = new Promise<void>((res, rej) => {
    finished = res;
    failed = rej;
  });

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failed?.(err);
      return;
    }
    if (chunk && chunk.length) parts.push(chunk);
    if (final) finished?.();
  });

  const addFile = (name: string, data: Uint8Array) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(data, true);
  };

  addFile("[Content_Types].xml", enc.encode(contentTypesXml(sheets.length)));
  addFile("_rels/.rels", enc.encode(ROOT_RELS));
  addFile("xl/workbook.xml", enc.encode(workbookXml(sheets.map((s) => s.name))));
  addFile("xl/_rels/workbook.xml.rels", enc.encode(workbookRelsXml(sheets.length)));

  const totalRows = sheets.reduce((a, s) => a + s.count, 0);
  let processed = 0;

  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si];
    const stream = new ZipDeflate(`xl/worksheets/sheet${si + 1}.xml`, { level: 6 });
    zip.add(stream);
    stream.push(enc.encode(sheetHeaderXml()), false);

    for (let start = 0; start < sheet.count; start += BATCH) {
      const end = Math.min(start + BATCH, sheet.count);
      const chunks: string[] = [];
      for (let r = start; r < end; r++) {
        const cells = sheet.row(r) ?? [];
        let line = `<row r="${r + 1}">`;
        for (let c = 0; c < cells.length; c++) line += cellXml(cells[c], c, r + 1);
        chunks.push(line + "</row>");
      }
      stream.push(enc.encode(chunks.join("")), false);
      processed += end - start;
      onProgress?.(processed, totalRows);
      // Пауза на кадр: браузер успевает перерисовать прогресс.
      await new Promise((r) => setTimeout(r, 0));
    }
    stream.push(enc.encode("</sheetData></worksheet>"), true);
  }

  zip.end();
  await done;

  return new Blob(parts as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Собирает книгу и запускает скачивание. */
export async function downloadXlsx(
  fileName: string,
  sheets: SheetData[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const blob = await buildXlsxBlob(sheets, onProgress);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Ссылку держим недолго: Safari успевает начать скачивание.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
