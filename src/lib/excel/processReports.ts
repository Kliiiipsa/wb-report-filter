import {
  EXCEL_ROW_LIMIT,
  ParsedReport,
  ProcessingResult,
  ResultRow,
  SOURCE_COLUMN,
} from "@/lib/types";
import { normalizeArticle } from "@/lib/excel/parseReports";

/**
 * Фильтрует строки отчетов по списку артикулов пользователя и собирает
 * объединенный результат + статистику.
 *
 * @param reports  разобранные отчеты (один или несколько)
 * @param articles очищенный список артикулов пользователя (string[])
 */
export function processReports(
  reports: ParsedReport[],
  articles: string[]
): ProcessingResult {
  const articleSet = new Set(articles.map(normalizeArticle));

  // Объединенный список заголовков: сохраняем порядок появления,
  // в конце добавляем колонку «Источник файла».
  const headerOrder: string[] = [];
  const headerSeen = new Set<string>();
  for (const report of reports) {
    for (const h of report.headers) {
      if (!headerSeen.has(h)) {
        headerSeen.add(h);
        headerOrder.push(h);
      }
    }
  }
  const headers = [...headerOrder, SOURCE_COLUMN];

  const rows: ResultRow[] = [];
  const uniqueArticlesInReports = new Set<string>();
  const foundArticles = new Set<string>();
  let totalRowsInReports = 0;

  for (const report of reports) {
    for (const row of report.rows) {
      totalRowsInReports++;
      const nm = normalizeArticle(row[report.nmIdColumn]);
      if (nm) uniqueArticlesInReports.add(nm);

      if (nm && articleSet.has(nm)) {
        foundArticles.add(nm);
        rows.push({ ...row, [SOURCE_COLUMN]: report.fileName });
      }
    }
  }

  const notFoundArticles = articles.filter((a) => !foundArticles.has(a));

  return {
    rows,
    headers,
    notFoundArticles,
    exceedsExcelLimit: rows.length > EXCEL_ROW_LIMIT,
    stats: {
      reportsCount: reports.length,
      totalRowsInReports,
      uniqueArticlesInReports: uniqueArticlesInReports.size,
      userArticlesCount: articles.length,
      matchedRowsCount: rows.length,
      notFoundArticlesCount: notFoundArticles.length,
    },
  };
}
