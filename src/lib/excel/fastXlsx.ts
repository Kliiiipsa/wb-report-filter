import { unzipSync, strFromU8 } from "fflate";

/**
 * Быстрый потоковый парсер .xlsx на базе fflate.
 *
 * Зачем: отчёты Wildberries бывают огромными (один лист на 100k+ строк,
 * сотни МБ XML) и/или с некорректным атрибутом <dimension ref="A1"/>.
 * Встроенный в SheetJS разбор на таких файлах зависает на минуты, а fflate
 * распаковывает их за доли секунды. Здесь мы сами разбираем worksheet XML —
 * это быстро и не зависит от заявленного диапазона листа.
 *
 * Поддержано: inline-значения (t="str"), числа (без t), общие строки
 * (t="s" -> sharedStrings), inlineStr, булевы (t="b"). Даты в отчётах WB
 * хранятся как обычные строки, поэтому конвертация серийных дат не нужна.
 */

export interface FastSheet {
  matrix: unknown[][];
  sheetName: string;
}

function xmlUnescape(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** "AB" из "AB12" -> 0-based индекс столбца. */
function colLettersToIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Парсит xl/sharedStrings.xml в массив строк. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    // Внутри <si> может быть несколько <t> (rich text) — склеиваем.
    const parts = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g);
    if (parts) {
      out.push(
        parts
          .map((p) => xmlUnescape(p.replace(/<t[^>]*>/, "").replace(/<\/t>/, "")))
          .join("")
      );
    } else {
      out.push("");
    }
  }
  return out;
}

/** Разбирает один worksheet XML в матрицу строк значений. */
function parseWorksheet(xml: string, shared: string[]): unknown[][] {
  const matrix: unknown[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  const cellRe = /<c\b([^>]*?)>([\s\S]*?)<\/c>|<c\b([^>]*?)\/>/g;
  const refRe = /\br="([A-Z]+)\d+"/;
  const tRe = /\bt="([^"]*)"/;
  const vRe = /<v>([\s\S]*?)<\/v>/;
  const isRe = /<t[^>]*>([\s\S]*?)<\/t>/;

  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const inner = rm[1];
    const cells: unknown[] = [];
    if (inner) {
      cellRe.lastIndex = 0;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(inner))) {
        const attrs = cm[1] ?? cm[3] ?? "";
        const body = cm[2];
        const refM = refRe.exec(attrs);
        const ci = refM ? colLettersToIndex(refM[1]) : cells.length;

        let val: unknown = null;
        if (body) {
          const t = tRe.exec(attrs)?.[1] ?? "";
          if (t === "inlineStr") {
            const isM = isRe.exec(body);
            val = isM ? xmlUnescape(isM[1]) : "";
          } else {
            const vM = vRe.exec(body);
            if (vM) {
              const raw = vM[1];
              if (t === "s") {
                val = shared[parseInt(raw, 10)] ?? "";
              } else if (t === "str" || t === "e") {
                val = xmlUnescape(raw);
              } else if (t === "b") {
                val = raw === "1";
              } else {
                const num = Number(raw);
                val = Number.isNaN(num) ? xmlUnescape(raw) : num;
              }
            }
          }
        }
        cells[ci] = val;
      }
    }
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === undefined) cells[i] = null;
    }
    matrix.push(cells);
  }
  return matrix;
}

/** Достаёт имя первого листа из xl/workbook.xml (для отображения). */
function readFirstSheetName(workbookXml: string | undefined): string {
  if (!workbookXml) return "Sheet1";
  const m = /<sheet\b[^>]*\bname="([^"]*)"/.exec(workbookXml);
  return m ? xmlUnescape(m[1]) : "Sheet1";
}

/**
 * Достаёт книгу .xlsx из обычного zip-архива (кабинет WB отдаёт крупные
 * отчёты именно так). Возвращает содержимое самого большого .xlsx внутри.
 */
export function extractXlsxFromZip(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }
  // Это уже книга, а не архив с книгой.
  if (entries["xl/workbook.xml"]) return bytes;
  let best: Uint8Array | null = null;
  for (const [name, data] of Object.entries(entries)) {
    if (!/\.xlsx$/i.test(name)) continue;
    if (!best || data.length > best.length) best = data;
  }
  return best;
}

/** Ищет байтовую последовательность начиная с позиции from. */
function indexOfSeq(hay: Uint8Array, needle: Uint8Array, from: number): number {
  const last = hay.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const ROW_END = new TextEncoder().encode("</row>");
/** Размер куска, который за раз превращаем в строку (байты дешевле строк). */
const CHUNK = 4 * 1024 * 1024;

/**
 * Разбирает лист построчно, не собирая весь XML в одну строку.
 *
 * Зачем: отчёт из кабинета WB на 50+ МБ разворачивается в сотни МБ XML, а одна
 * JS-строка такого размера занимает вдвое больше и роняет вкладку. Здесь лист
 * режется по границам строк `</row>`, и каждый кусок обрабатывается отдельно.
 *
 * @param onRow вызывается на каждую строку листа; вернёт false — разбор прекращается
 */
function streamWorksheet(
  bytes: Uint8Array,
  shared: string[],
  onRow: (cells: unknown[], index: number) => boolean | void
): void {
  const dec = new TextDecoder("utf-8");
  let start = 0;
  let index = 0;
  while (start < bytes.length) {
    let end = Math.min(start + CHUNK, bytes.length);
    if (end < bytes.length) {
      const cut = indexOfSeq(bytes, ROW_END, end);
      end = cut === -1 ? bytes.length : cut + ROW_END.length;
    }
    const rows = parseWorksheet(dec.decode(bytes.subarray(start, end)), shared);
    for (const cells of rows) {
      if (onRow(cells, index++) === false) return;
    }
    start = end;
  }
}

export interface FastStreamResult {
  sheetName: string;
  /** Сколько строк листа просмотрено. */
  rowsSeen: number;
}

/**
 * Потоковый разбор .xlsx: строки отдаются по одной, в памяти не остаются.
 * @returns null, если файл не распаковывается как ZIP
 */
export function parseXlsxStream(
  bytes: Uint8Array,
  onRow: (cells: unknown[], index: number) => boolean | void
): FastStreamResult | null {
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }
  let wsKey = "";
  let wsSize = -1;
  for (const k of Object.keys(entries)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(k) && entries[k].length > wsSize) {
      wsKey = k;
      wsSize = entries[k].length;
    }
  }
  if (!wsKey) return null;

  const sharedBytes = entries["xl/sharedStrings.xml"];
  const shared: string[] = [];
  if (sharedBytes) {
    // Общие строки тоже читаем кусками — их бывает очень много.
    const dec = new TextDecoder("utf-8");
    const SI_END = new TextEncoder().encode("</si>");
    let s = 0;
    while (s < sharedBytes.length) {
      let e = Math.min(s + CHUNK, sharedBytes.length);
      if (e < sharedBytes.length) {
        const cut = indexOfSeq(sharedBytes, SI_END, e);
        e = cut === -1 ? sharedBytes.length : cut + SI_END.length;
      }
      for (const v of parseSharedStrings(dec.decode(sharedBytes.subarray(s, e)))) shared.push(v);
      s = e;
    }
  }

  const sheetName = readFirstSheetName(
    entries["xl/workbook.xml"] ? strFromU8(entries["xl/workbook.xml"]) : undefined
  );

  let rowsSeen = 0;
  streamWorksheet(entries[wsKey], shared, (cells, i) => {
    rowsSeen = i + 1;
    return onRow(cells, i);
  });
  // Освобождаем распакованные данные как можно раньше.
  for (const k of Object.keys(entries)) delete entries[k];
  return { sheetName, rowsSeen };
}

/**
 * Пытается разобрать .xlsx через fflate.
 * @returns матрицу и имя листа, либо null если файл не распаковывается как ZIP
 *          (тогда вызывающий код может попробовать другой парсер).
 */
export function parseXlsxFast(bytes: Uint8Array): FastSheet | null {
  // .xlsx начинается с сигнатуры ZIP "PK".
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }

  // Выбираем worksheet с наибольшим объёмом (это лист с данными).
  let wsKey = "";
  let wsSize = -1;
  for (const k of Object.keys(entries)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(k) && entries[k].length > wsSize) {
      wsKey = k;
      wsSize = entries[k].length;
    }
  }
  if (!wsKey) return null;

  const shared = entries["xl/sharedStrings.xml"]
    ? parseSharedStrings(strFromU8(entries["xl/sharedStrings.xml"]))
    : [];

  const sheetName = readFirstSheetName(
    entries["xl/workbook.xml"] ? strFromU8(entries["xl/workbook.xml"]) : undefined
  );

  const matrix = parseWorksheet(strFromU8(entries[wsKey]), shared);
  return { matrix, sheetName };
}
