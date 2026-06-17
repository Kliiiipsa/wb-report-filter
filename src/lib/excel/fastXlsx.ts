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
