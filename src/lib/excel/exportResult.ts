import * as XLSX from "xlsx";
import {
  EXCEL_ROW_LIMIT,
  NMID_HEADER,
  ProcessingResult,
  ResultRow,
} from "@/lib/types";

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
    ["Уникальных артикулов в отчетах", s.uniqueArticlesInReports],
    ["Артикулов указано пользователем", s.userArticlesCount],
    ["Найдено совпадений (строк)", s.matchedRowsCount],
    ["Артикулов не найдено", s.notFoundArticlesCount],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [{ wch: 36 }, { wch: 16 }];
  return sheet;
}

/** Лист «Не найдено» — артикулы из списка пользователя, которых нет в отчетах. */
function buildNotFoundSheet(notFound: string[]): XLSX.WorkSheet {
  const data: string[][] = [[NMID_HEADER], ...notFound.map((a) => [a])];
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
export function exportResultToExcel(
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
