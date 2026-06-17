import * as XLSX from "xlsx";
import { unzipSync, zipSync } from "fflate";
import {
  MAX_FILE_SIZE,
  NMID_HEADER,
  ParsedReport,
  ReportRow,
} from "@/lib/types";

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
 * Определяет столбец "Код номенклатуры".
 * 1) В приоритете — поиск по названию заголовка.
 * 2) Если не найдено — пробуем колонку D (4-й столбец).
 */
function detectNmIdColumn(headers: string[]): string {
  const target = NMID_HEADER.trim().toLowerCase();

  // 1. Точное совпадение по заголовку.
  const exact = headers.find((h) => h.trim().toLowerCase() === target);
  if (exact) return exact;

  // 1b. Частичное совпадение (на случай лишних символов в заголовке).
  const partial = headers.find((h) =>
    h.trim().toLowerCase().includes("код номенклатуры")
  );
  if (partial) return partial;

  // 2. Колонка D — четвертый столбец (индекс 3).
  if (headers.length >= 4 && headers[3]) {
    return headers[3];
  }

  throw new ReportParseError(
    `Не найден столбец «${NMID_HEADER}» и отсутствует колонка D для подстановки.`
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
 * Нормализует ZIP-контейнер .xlsx: распаковывает устойчивым распаковщиком
 * (fflate поддерживает варианты ZIP, которые не читает встроенный в SheetJS,
 * например Zip64 / нестандартное сжатие) и запаковывает обратно в чистый
 * стандартный DEFLATE-архив. Это автоматически воспроизводит ручной приём
 * «запаковать в zip и распаковать», лечащий отчёты Wildberries.
 *
 * Всё выполняется в памяти браузера — файл никуда не отправляется.
 */
function normalizeXlsxZip(bytes: Uint8Array): Uint8Array | null {
  // .xlsx всегда начинается с сигнатуры ZIP "PK".
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  try {
    const entries = unzipSync(bytes);
    return zipSync(entries, { level: 6 });
  } catch {
    return null;
  }
}

/**
 * Разбирает один загруженный файл отчета Wildberries.
 * Выполняется на клиенте — файл не отправляется на сервер.
 */
export async function parseReportFile(file: File): Promise<ParsedReport> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new ReportParseError(
      `Файл «${file.name}» не в формате .xlsx.`
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new ReportParseError(
      `Файл «${file.name}» слишком большой (> ${Math.round(
        MAX_FILE_SIZE / 1024 / 1024
      )} МБ).`
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 1) Быстрый путь: читаем файл напрямую и берём лист с наибольшим
  //    количеством данных (с восстановлением диапазона при необходимости).
  let matrix: unknown[][] = [];
  let sheetName = "";
  const direct = tryReadWorkbook(bytes);
  if (direct) {
    const best = extractBestSheet(direct);
    if (best) ({ matrix, sheetName } = best);
  }

  // 2) Фолбэк: если данных всё ещё нет, нормализуем ZIP-контейнер и пробуем
  //    снова. Лечит отчёты WB с нестандартной упаковкой без ручного zip/extract.
  if (matrix.length < 2) {
    const normalized = normalizeXlsxZip(bytes);
    if (normalized) {
      const wb = tryReadWorkbook(normalized);
      if (wb) {
        const best = extractBestSheet(wb);
        if (best && best.matrix.length > matrix.length) {
          ({ matrix, sheetName } = best);
        }
      }
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

  const nmIdColumn = detectNmIdColumn(headers);

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

  return { fileName: file.name, sheetName, rows, headers, nmIdColumn };
}
