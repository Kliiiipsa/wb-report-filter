import {
  EXCEL_ROW_LIMIT,
  ParsedReport,
  ProcessingResult,
  ResultRow,
  SOURCE_COLUMN,
} from "@/lib/types";
import { normalizeArticle } from "@/lib/excel/parseReports";
import { normalizeCode } from "@/lib/codes";

/**
 * Фильтрует строки отчетов по списку артикулов пользователя и собирает
 * объединенный результат + статистику.
 *
 * @param reports  разобранные отчеты (один или несколько)
 * @param articles очищенный список артикулов пользователя (string[])
 */
export function processReports(
  reports: ParsedReport[],
  articles: string[],
  /**
   * Дополнительные коды: «код в отчёте → код из списка пользователя». Нужны,
   * когда WB прислал товар под новым кодом (GTIN), которого в справочнике ещё
   * нет; связь восстановлена по данным самой недели, см. lib/wbAliases.ts.
   */
  aliases?: Iterable<[string, string]>
): ProcessingResult {
  // Сопоставление идёт по нормализованному коду (баркод или GTIN), см. lib/codes.ts.
  const articleByCode = new Map<string, string>();
  for (const a of articles) {
    const c = normalizeCode(a);
    if (c && !articleByCode.has(c)) articleByCode.set(c, a);
  }
  for (const [code, article] of aliases ?? []) {
    const c = normalizeCode(code);
    if (c && !articleByCode.has(c)) articleByCode.set(c, article);
  }

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
      const raw = normalizeArticle(row[report.barcodeColumn]);
      if (raw) uniqueArticlesInReports.add(raw);

      const code = normalizeCode(raw);
      const article = code ? articleByCode.get(code) : undefined;
      if (article !== undefined) {
        foundArticles.add(article);
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
