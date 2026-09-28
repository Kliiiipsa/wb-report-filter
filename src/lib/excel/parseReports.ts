import * as XLSX from "xlsx";
import {
  BARCODE_HEADER,
  BARCODE_REPORT_COL_INDEX,
  MAX_FILE_SIZE,
  ParsedReport,
  ReportRow,
} from "@/lib/types";
import { extractXlsxFromZip, parseXlsxFast, parseXlsxStream } from "@/lib/excel/fastXlsx";
import { normalizeCode } from "@/lib/codes";

/** Понятная ошибка обработки отчета. */
export class ReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportParseError";
  }
}

/** Нормализует значение артикула: приводим к строке и убираем пробелы. */
export function normalizeArticle(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Числа из Excel сравниваем как строки, чтобы не терять точность и формат.
  return String(value).trim();
}

/**
 * Пересчитывает диапазон листа `!ref` по фактическим адресам ячеек.
 * Нужно для отчётов, где генератор не указал или указал неверный диапазон,
 * из-за чего SheetJS не видит данные. Безопасно: не меняет содержимое.
 */
function rebuildSheetRef(sheet: XLSX.WorkSheet): void {
  const addrs = Object.keys(sheet).filter((k) => k[0] !== "!");
  if (addrs.length === 0) return;
  let minR = Infinity,
    minC = Infinity,
    maxR = -1,
    maxC = -1;
  for (const a of addrs) {
    const c = XLSX.utils.decode_cell(a);
    if (c.r < minR) minR = c.r;
    if (c.c < minC) minC = c.c;
    if (c.r > maxR) maxR = c.r;
    if (c.c > maxC) maxC = c.c;
  }
  sheet["!ref"] = XLSX.utils.encode_range({
    s: { r: minR, c: minC },
    e: { r: maxR, c: maxC },
  });
}

/** Превращает лист в матрицу строк (с восстановлением диапазона при пустом результате). */
function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  const opts = {
    header: 1 as const,
    raw: true,
    defval: null,
    blankrows: false,
  };
  let matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, opts);
  if (matrix.length < 2) {
    rebuildSheetRef(sheet);
    matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, opts);
  }
  return matrix;
}

/**
 * Выбирает из книги лист с наибольшим количеством данных.
 * Приоритет при равенстве — лист с именем "Sheet1", иначе первый.
 * Не привязываемся жёстко к первому листу: данные отчёта могут лежать на другом.
 */
function extractBestSheet(
  workbook: XLSX.WorkBook
): { matrix: unknown[][]; sheetName: string } | null {
  let best: { matrix: unknown[][]; sheetName: string } | null = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = sheetToMatrix(sheet);
    if (!best || matrix.length > best.matrix.length) {
      best = { matrix, sheetName: name };
    }
  }
  return best;
}

/**
 * Определяет столбец "Баркод" в отчёте WB.
 * 1) В приоритете — поиск по названию заголовка.
 * 2) Если не найдено — пробуем колонку I (9-й столбец, индекс 8).
 */
function detectBarcodeColumn(headers: string[]): string {
  const target = BARCODE_HEADER.trim().toLowerCase();

  // 1. Точное совпадение по заголовку.
  const exact = headers.find((h) => h.trim().toLowerCase() === target);
  if (exact) return exact;

  // 1b. Частичное совпадение (на случай лишних символов в заголовке).
  const partial = headers.find((h) =>
    h.trim().toLowerCase().includes(target)
  );
  if (partial) return partial;

  // 2. Колонка I — девятый столбец (индекс 8).
  if (headers.length > BARCODE_REPORT_COL_INDEX && headers[BARCODE_REPORT_COL_INDEX]) {
    return headers[BARCODE_REPORT_COL_INDEX];
  }

  throw new ReportParseError(
    `Не найден столбец «${BARCODE_HEADER}» и отсутствует колонка I для подстановки.`
  );
}

/** Читает байты как книгу Excel (Uint8Array). Возвращает null при ошибке. */
function tryReadWorkbook(bytes: Uint8Array): XLSX.WorkBook | null {
  try {
    return XLSX.read(bytes, { type: "array" });
  } catch {
    return null;
  }
}

/**
 * Разбирает один загруженный файл отчета Wildberries.
 * Выполняется на клиенте — файл не отправляется на сервер.
 */
export async function parseReportFile(
  file: File,
  /**
   * Нормализованные коды товара. Если переданы — строки отбираются прямо при
   * разборе, и огромный отчёт не оседает в памяти целиком.
   */
  codes?: Set<string>
): Promise<ParsedReport> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".zip")) {
    throw new ReportParseError(
      `Файл «${file.name}» не в формате .xlsx или .zip.`
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new ReportParseError(
      `Файл «${file.name}» слишком большой (> ${Math.round(
        MAX_FILE_SIZE / 1024 / 1024
      )} МБ).`
    );
  }

  let bytes = new Uint8Array(await file.arrayBuffer());
  // Кабинет WB отдаёт крупный отчёт архивом — достаём из него книгу.
  if (lower.endsWith(".zip")) {
    const inner = extractXlsxFromZip(bytes);
    if (!inner) {
      throw new ReportParseError(
        `В архиве «${file.name}» не найден файл .xlsx.`
      );
    }
    bytes = new Uint8Array(inner);
  }

  let matrix: unknown[][] = [];
  let sheetName = "";

  // 1) Основной путь: свой потоковый парсер на fflate. Не зависит от
  //    заявленного диапазона листа и не собирает весь XML в одну строку,
  //    поэтому тянет отчёты из кабинета в сотни МБ.
  //    Если передан набор кодов — строки фильтруются прямо при разборе, и в
  //    памяти остаются только нужные.
  let headerCells: unknown[] | null = null;
  let codeCol = -1;
  const stream = parseXlsxStream(bytes, (cells, i) => {
    if (i === 0) {
      headerCells = cells;
      matrix.push(cells);
      if (codes) {
        const hdrs = cells.map((h, c) =>
          h === null || h === undefined || String(h).trim() === "" ? `Столбец ${c + 1}` : String(h).trim()
        );
        codeCol = hdrs.indexOf(detectBarcodeColumn(hdrs));
      }
      return;
    }
    if (cells.every((c) => c === null || c === undefined || c === "")) return;
    if (codes && codeCol >= 0 && !codes.has(normalizeCode(cells[codeCol]))) return;
    matrix.push(cells);
  });
  if (stream) {
    sheetName = stream.sheetName;
    if (headerCells === null) matrix = [];
  } else {
    // 2) Фолбэк только для файлов, которые не распаковались как ZIP
    //    (иной/повреждённый контейнер). SheetJS здесь безопасен по объёму.
    const wb = tryReadWorkbook(bytes);
    if (wb) {
      const best = extractBestSheet(wb);
      if (best) ({ matrix, sheetName } = best);
    }
  }

  if (matrix.length < 2) {
    throw new ReportParseError(
      `В файле «${file.name}» не найдена таблица с данными. ` +
        `Файл прочитан, но строки не распознаны — пришлите файл, если ошибка повторяется.`
    );
  }

  const headerRow = matrix[0] ?? [];
  const headers = headerRow.map((h, i) =>
    h === null || h === undefined || String(h).trim() === ""
      ? `Столбец ${i + 1}`
      : String(h).trim()
  );

  const barcodeColumn = detectBarcodeColumn(headers);

  const rows: ReportRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const raw = matrix[r] ?? [];
    // Пропускаем полностью пустые строки.
    if (raw.every((c) => c === null || c === undefined || c === "")) continue;
    const row: ReportRow = {};
    headers.forEach((h, c) => {
      row[h] = raw[c] ?? null;
    });
    rows.push(row);
  }

  return { fileName: file.name, sheetName, rows, headers, barcodeColumn };
}
