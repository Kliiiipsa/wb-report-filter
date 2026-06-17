import * as XLSX from "xlsx";
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
 * Выбирает рабочий лист: приоритет — лист с именем "Sheet1",
 * иначе берем первый лист книги.
 */
function pickSheet(workbook: XLSX.WorkBook): {
  sheet: XLSX.WorkSheet;
  name: string;
} {
  if (workbook.SheetNames.length === 0) {
    throw new ReportParseError("В файле не найдено ни одного листа.");
  }
  const preferred = workbook.SheetNames.find(
    (n) => n.trim().toLowerCase() === "sheet1"
  );
  const name = preferred ?? workbook.SheetNames[0];
  return { sheet: workbook.Sheets[name], name };
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

/** Читает ArrayBuffer как книгу Excel. */
function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  try {
    return XLSX.read(buffer, { type: "array" });
  } catch {
    throw new ReportParseError(
      "Не удалось прочитать файл Excel. Возможно, файл поврежден."
    );
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

  const buffer = await file.arrayBuffer();
  const workbook = readWorkbook(buffer);
  const { sheet, name: sheetName } = pickSheet(workbook);

  // Читаем как массив строк, чтобы аккуратно достать заголовки.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  if (matrix.length < 2) {
    throw new ReportParseError(
      `В файле «${file.name}» не найдена таблица с данными.`
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
