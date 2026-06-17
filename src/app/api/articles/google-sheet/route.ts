import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { cleanArticleList } from "@/lib/excel/parseArticles";
import { normalizeArticle } from "@/lib/excel/parseReports";
import {
  GOOGLE_SHEET,
  GOOGLE_SHEET_SOURCE_LABEL,
  googleSheetCsvUrl,
} from "@/lib/googleSheet";

// Всегда тянем свежие данные из таблицы, без кэша.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/articles/google-sheet
 *
 * Загружает CSV-экспорт листа Google Sheets (по gid), находит колонку
 * «Артикул WB» по заголовку (fallback — колонка D), очищает значения и
 * возвращает уникальный список артикулов.
 */
export async function GET() {
  const url = googleSheetCsvUrl();

  // 1. Скачиваем CSV.
  let csvText: string;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            `Google Sheets вернул статус ${res.status}. ` +
            "Проверьте, что таблица открыта по ссылке («Доступ всем, у кого есть ссылка»).",
        },
        { status: 502 }
      );
    }
    csvText = await res.text();
  } catch {
    return NextResponse.json(
      { error: "Не удалось подключиться к Google Sheets." },
      { status: 502 }
    );
  }

  // Если вместо CSV вернулся HTML — значит нет публичного доступа.
  if (/^\s*<(?:!doctype|html)/i.test(csvText)) {
    return NextResponse.json(
      {
        error:
          "Таблица недоступна публично. Откройте доступ «Всем, у кого есть ссылка» " +
          "или опубликуйте лист, затем повторите.",
      },
      { status: 403 }
    );
  }

  // 2. Парсим CSV (xlsx корректно обрабатывает кавычки и запятые в ячейках).
  let matrix: unknown[][];
  try {
    const wb = XLSX.read(csvText, { type: "string", raw: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось разобрать CSV из Google Sheets." },
      { status: 500 }
    );
  }

  if (matrix.length === 0) {
    return NextResponse.json(
      { error: "Лист Google Sheets пуст." },
      { status: 422 }
    );
  }

  // 3. Определяем индекс колонки.
  const headerRow = (matrix[0] ?? []).map((h) => normalizeArticle(h));
  const target = GOOGLE_SHEET.columnName.trim().toLowerCase();

  let colIndex = headerRow.findIndex((h) => h.toLowerCase() === target);
  let usedFallback = false;

  if (colIndex === -1) {
    // 4. Fallback — колонка D (индекс 3).
    colIndex = 3;
    usedFallback = true;
  }

  // 5. Забираем значения колонки (пропускаем строку заголовка).
  const rawValues: unknown[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    rawValues.push(row[colIndex] ?? null);
  }

  // 6. Очистка: trim, привести к строкам, убрать пустые и дубли.
  const articles = cleanArticleList(rawValues.map((v) => normalizeArticle(v)));

  if (articles.length === 0) {
    return NextResponse.json(
      {
        error:
          "В колонке артикулов нет данных. Проверьте лист и колонку «Артикул WB».",
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    articles,
    count: articles.length,
    usedFallback,
    source: GOOGLE_SHEET_SOURCE_LABEL,
    sheetName: GOOGLE_SHEET.sheetName,
    columnName: GOOGLE_SHEET.columnName,
  });
}
