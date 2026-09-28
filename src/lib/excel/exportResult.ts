import * as XLSX from "xlsx";
import {
  BARCODE_HEADER,
  EXCEL_ROW_LIMIT,
  ProcessingResult,
  ResultRow,
} from "@/lib/types";
import {
  downloadXlsx,
  sheetFromMatrix,
  sheetFromObjects,
  type SheetData,
} from "@/lib/excel/writeXlsx";

/** Превращает строки-объекты в матрицу значений по фиксированному порядку заголовков. */
function rowsToMatrix(rows: ResultRow[], headers: string[]): unknown[][] {
  const matrix: unknown[][] = [headers];
  for (const row of rows) {
    matrix.push(headers.map((h) => (row[h] ?? null)));
  }
  return matrix;
}

/**
 * Разбивает строки на части по лимиту Excel.
 * Для прототипа лимит велик и срабатывает редко, но функция заложена заранее.
 */
function chunkRows(rows: ResultRow[], limit: number): ResultRow[][] {
  if (rows.length <= limit) return [rows];
  const chunks: ResultRow[][] = [];
  for (let i = 0; i < rows.length; i += limit) {
    chunks.push(rows.slice(i, i + limit));
  }
  return chunks;
}

/** Лист «Сводка» со статистикой обработки. */
function buildSummarySheet(result: ProcessingResult): XLSX.WorkSheet {
  const s = result.stats;
  const data: (string | number)[][] = [
    ["Показатель", "Значение"],
    ["Загружено отчетов", s.reportsCount],
    ["Всего строк в отчетах", s.totalRowsInReports],
    ["Уникальных баркодов в отчетах", s.uniqueArticlesInReports],
    ["Баркодов указано пользователем", s.userArticlesCount],
    ["Найдено совпадений (строк)", s.matchedRowsCount],
    ["Баркодов не найдено", s.notFoundArticlesCount],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [{ wch: 36 }, { wch: 16 }];
  return sheet;
}

/** Лист «Не найдено» — баркоды из списка пользователя, которых нет в отчетах. */
function buildNotFoundSheet(notFound: string[]): XLSX.WorkSheet {
  const data: string[][] = [[BARCODE_HEADER], ...notFound.map((a) => [a])];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [{ wch: 24 }];
  return sheet;
}

/**
 * Формирует итоговую книгу Excel и инициирует скачивание в браузере.
 * Листы:
 *  - «Найденные строки» (при превышении лимита — несколько листов с суффиксом);
 *  - «Сводка»;
 *  - «Не найдено».
 */
export async function exportResultToExcel(
  result: ProcessingResult,
  fileName = "Отфильтрованный_отчет_WB.xlsx",
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  // Книга пишется по частям: на сотне тысяч строк сборка целиком в памяти
  // кладёт вкладку и кнопка «Скачать» внешне не срабатывает.
  const chunks = chunkRows(result.rows, EXCEL_ROW_LIMIT);
  const sheets: SheetData[] = chunks.map((chunk, i) =>
    sheetFromObjects(
      chunks.length === 1 ? "Найденные строки" : `Найденные строки ${i + 1}`,
      result.headers,
      chunk
    )
  );
  const s = result.stats;
  sheets.push(
    sheetFromMatrix("Сводка", [
      ["Показатель", "Значение"],
      ["Загружено отчетов", s.reportsCount],
      ["Всего строк в отчетах", s.totalRowsInReports],
      ["Уникальных баркодов в отчетах", s.uniqueArticlesInReports],
      ["Баркодов указано пользователем", s.userArticlesCount],
      ["Найдено совпадений (строк)", s.matchedRowsCount],
      ["Баркодов не найдено", s.notFoundArticlesCount],
    ])
  );
  sheets.push(
    sheetFromMatrix("Не найдено", [[BARCODE_HEADER], ...result.notFoundArticles.map((a) => [a])])
  );
  await downloadXlsx(fileName, sheets, onProgress);
}

/** Прежний путь через SheetJS — оставлен для небольших книг и тестов. */
export function exportResultToExcelViaSheetJs(
  result: ProcessingResult,
  fileName = "Отфильтрованный_отчет_WB.xlsx"
): void {
  const workbook = XLSX.utils.book_new();

  // 1. Найденные строки (с разбиением при превышении лимита Excel).
  const chunks = chunkRows(result.rows, EXCEL_ROW_LIMIT);
  chunks.forEach((chunk, i) => {
    const sheet = XLSX.utils.aoa_to_sheet(
      rowsToMatrix(chunk, result.headers)
    );
    const name =
      chunks.length === 1
        ? "Найденные строки"
        : `Найденные строки ${i + 1}`;
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  });

  // 2. Сводка.
  XLSX.utils.book_append_sheet(workbook, buildSummarySheet(result), "Сводка");

  // 3. Не найдено.
  XLSX.utils.book_append_sheet(
    workbook,
    buildNotFoundSheet(result.notFoundArticles),
    "Не найдено"
  );

  XLSX.writeFile(workbook, fileName, { compression: true });
}
