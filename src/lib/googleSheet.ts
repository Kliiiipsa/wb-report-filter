/**
 * Конфигурация источника кодов товара в Google Sheets.
 *
 * ВАЖНО: CSV-экспорт строится по `gid` листа, а не по названию,
 * потому что название на кириллице («Асортимент для Миюми») может меняться.
 *
 * Кодов теперь может быть несколько на товар: прежний баркод WB и GTIN
 * производителя, который WB начал присылать в отчёте с конца августа 2026.
 * Поэтому берём значения ИЗ ВСЕХ колонок, чей заголовок похож на код товара.
 */
export const GOOGLE_SHEET = {
  spreadsheetId: "13PIyPQd0FzbmCjvHi4jK7IOJjBTOYmN5eukAiOjnj2I",
  /** GID листа — основной идентификатор, по нему строится CSV-ссылка. */
  gid: "1503420526",
  /** Название листа — только для отображения в интерфейсе. */
  sheetName: "Асортимент для Миюми",
  /** Заголовок основной колонки (для подписей в интерфейсе). */
  columnName: "Баркод",
  /** Любой заголовок, подходящий под это правило, считается колонкой с кодом. */
  codeHeaderPattern: /баркод|штрих\s*-?\s*код|штрихкод|ean|gtin/i,
  /** Запасной индекс колонки, если заголовки не распознаны: E (индекс 4). */
  fallbackColIndex: 4,
} as const;

/** Прямая ссылка на CSV-экспорт нужного листа (по gid). */
export function googleSheetCsvUrl(): string {
  const { spreadsheetId, gid } = GOOGLE_SHEET;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

/** Ссылка на саму таблицу для открытия человеком (нужный лист по gid). */
export function googleSheetViewUrl(): string {
  const { spreadsheetId, gid } = GOOGLE_SHEET;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`;
}

/** Подпись источника для интерфейса. */
export const GOOGLE_SHEET_SOURCE_LABEL = `Источник: Google Sheets → ${GOOGLE_SHEET.sheetName} → колонки с кодами (баркод, EAN, GTIN)`;
