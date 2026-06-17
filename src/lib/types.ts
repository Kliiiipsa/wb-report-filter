/**
 * Общие типы данных для прототипа фильтра отчетов Wildberries.
 */

/** Имя главного столбца для фильтрации (заголовок в отчете WB). */
export const NMID_HEADER = "Код номенклатуры";

/** Имя дополнительного столбца, который добавляется в результат. */
export const SOURCE_COLUMN = "Источник файла";

/** Лимит строк на один лист Excel (1 048 576 минус строка заголовка, с запасом). */
export const EXCEL_ROW_LIMIT = 1_000_000;

/** Максимально допустимый размер одного файла отчета (в байтах). */
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ

/** Одна строка отчета: ключ — заголовок столбца, значение — содержимое ячейки. */
export type ReportRow = Record<string, unknown>;

/** Результат разбора одного загруженного отчета. */
export interface ParsedReport {
  /** Имя исходного файла. */
  fileName: string;
  /** Имя листа, который был прочитан. */
  sheetName: string;
  /** Все строки отчета (в виде объектов по заголовкам). */
  rows: ReportRow[];
  /** Упорядоченный список заголовков столбцов исходного отчета. */
  headers: string[];
  /** Фактическое имя столбца с кодом номенклатуры в этом отчете. */
  nmIdColumn: string;
}

/** Строка результата фильтрации (исходная строка + источник). */
export type ResultRow = ReportRow & { [SOURCE_COLUMN]: string };

/** Статистика обработки, показывается в карточках и листе «Сводка». */
export interface ProcessingStats {
  reportsCount: number;
  totalRowsInReports: number;
  uniqueArticlesInReports: number;
  userArticlesCount: number;
  matchedRowsCount: number;
  notFoundArticlesCount: number;
}

/** Полный результат обработки, готовый к предпросмотру и экспорту. */
export interface ProcessingResult {
  /** Объединенный набор найденных строк из всех отчетов. */
  rows: ResultRow[];
  /** Объединенный список заголовков (включая «Источник файла»). */
  headers: string[];
  /** Артикулы пользователя, которых нет ни в одном отчете. */
  notFoundArticles: string[];
  /** Статистика. */
  stats: ProcessingStats;
  /** Превышен ли лимит строк Excel (нужно разбиение). */
  exceedsExcelLimit: boolean;
}

/** Режим ввода списка артикулов. */
export type ArticleSource = "manual" | "file" | "demo" | "google";

/** Статусы для UI. */
export type StatusKind = "idle" | "loading" | "ready" | "error";
