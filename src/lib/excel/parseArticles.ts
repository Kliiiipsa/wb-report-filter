import * as XLSX from "xlsx";
import { normalizeArticle, ReportParseError } from "@/lib/excel/parseReports";

/**
 * Демо-список артикулов (заглушка вместо Google Sheets).
 * Подберите значения под ваши тестовые отчеты при необходимости.
 */
export const DEMO_ARTICLES: string[] = [
  "123456789",
  "987654321",
  "111222333",
  "444555666",
  "777888999",
];

/**
 * Нормализует и очищает список артикулов:
 * убирает пробелы, пустые строки и дубли (сохраняя порядок появления).
 */
export function cleanArticleList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const norm = normalizeArticle(v);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
  }
  return result;
}

/** Разбирает текст из textarea: по одному артикулу в строке (и через запятую/;). */
export function parseArticlesFromText(text: string): string[] {
  const parts = text.split(/[\r\n,;]+/);
  return cleanArticleList(parts);
}

/**
 * Разбирает файл со списком артикулов: поддержка .txt, .csv, .xlsx.
 * Для табличных форматов берем первый столбец каждой строки.
 */
export async function parseArticlesFromFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".csv")) {
    const text = await file.text();
    if (name.endsWith(".csv")) {
      // CSV: берем первый столбец каждой строки.
      const firstCol = text
        .split(/\r?\n/)
        .map((line) => line.split(/[,;]/)[0] ?? "");
      return cleanArticleList(firstCol);
    }
    return parseArticlesFromText(text);
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "array" });
    } catch {
      throw new ReportParseError("Не удалось прочитать файл со списком артикулов.");
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new ReportParseError("В файле со списком артикулов нет листов.");
    }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, raw: true, defval: null, blankrows: false }
    );
    // Берем первый столбец. Заголовок (если он есть) отфильтруется как мусор,
    // но чаще список — просто колонка чисел, поэтому берем все значения.
    const firstCol = matrix.map((row) =>
      row && row.length ? normalizeArticle(row[0]) : ""
    );
    return cleanArticleList(firstCol);
  }

  throw new ReportParseError(
    `Формат файла «${file.name}» не поддерживается. Используйте .xlsx, .csv или .txt.`
  );
}

/** Ответ серверного route загрузки артикулов из Google Sheets. */
export interface GoogleSheetArticlesResult {
  articles: string[];
  count: number;
  usedFallback: boolean;
  source: string;
  sheetName: string;
  columnName: string;
}

/* ------------------------------------------------------------------ *
 * Загрузка артикулов из Google Sheets.
 *
 * Реальный запрос делает серверный route /api/articles/google-sheet
 * (CSV-экспорт листа «Асортимент для Миюми» по gid, колонка «Артикул WB»).
 * Серверная сторона нужна, чтобы обойти CORS Google и спрятать парсинг CSV.
 * ------------------------------------------------------------------ */
export async function fetchArticlesFromGoogleSheets(): Promise<GoogleSheetArticlesResult> {
  let res: Response;
  try {
    res = await fetch("/api/articles/google-sheet", { cache: "no-store" });
  } catch {
    throw new ReportParseError("Не удалось обратиться к серверу загрузки Google Sheets.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ReportParseError(
      data?.error ?? "Ошибка загрузки артикулов из Google Sheets."
    );
  }
  return data as GoogleSheetArticlesResult;
}
