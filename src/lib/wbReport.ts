import { ReportRow } from "@/lib/types";
import { getCachedPage, putCachedPage } from "@/lib/wbCache";
import { COLS, DATE_KEYS, BARCODE_IDX, cell, indicesFor } from "@/lib/wbColumns";

/**
 * Серверная интеграция с WB Statistics API (детальный отчёт о реализации).
 *
 * Метод reportDetailByPeriod отдаёт настоящий построчный WB-отчёт со всеми
 * колонками (Тип документа, Обоснование для оплаты, даты, регион и т.д.).
 * Ограничения WB: максимум 100 000 строк на запрос (~205 МБ, ~86 сек) и
 * жёсткий троттлинг повторных запросов. Поэтому:
 *  - выгрузка идёт постранично по курсору rrdid (пагинацию ведёт клиент,
 *    выдерживая паузу между страницами);
 *  - каждая скачанная страница сохраняется в кэш (Vercel Blob) и в следующий
 *    раз отдаётся оттуда мгновенно — закрытая неделя WB не меняется.
 *
 * Токен читается из серверной переменной окружения WB_STATS_TOKEN.
 * ВНИМАНИЕ: модуль серверный (zlib/blob) — в клиентские компоненты не импортировать,
 * для них есть wbColumns.ts.
 */

export const WB_STATS_BASE = "https://statistics-api.wildberries.ru";
export const WB_REPORT_ENDPOINT = "/api/v5/supplier/reportDetailByPeriod";
export const WB_PAGE_LIMIT = 100000;

export class WbReportError extends Error {
  status?: number;
  /** Сколько секунд WB просит подождать (из заголовка Retry-After), если сообщил. */
  retryAfterSec?: number;
  constructor(message: string, status?: number, retryAfterSec?: number) {
    super(message);
    this.name = "WbReportError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Разбирает Retry-After (секунды или HTTP-дата) в секунды; undefined если нет/непонятно. */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return Math.max(0, Math.ceil((t - Date.now()) / 1000));
  return undefined;
}

/** Преобразует строку API в строку с русскими заголовками (как в WB-отчёте). */
export function mapWbRow(apiRow: Record<string, unknown>): ReportRow {
  const row: ReportRow = {};
  for (const [ru, key] of COLS) {
    row[ru] = cell(apiRow[key], DATE_KEYS.has(key));
  }
  return row;
}

/** Строка API -> массив всех колонок в порядке COLS (формат хранения в кэше). */
function fullRowArray(apiRow: Record<string, unknown>): unknown[] {
  return COLS.map(([, key]) => cell(apiRow[key], DATE_KEYS.has(key)));
}

/** Страница отчёта до фильтрации: все строки, все колонки. */
export interface LoadedPage {
  rows: unknown[][];
  pageRowCount: number;
  lastRrdId: number;
  done: boolean;
  /** Страница взята из кэша (WB не вызывался, пауза не нужна). */
  fromCache: boolean;
}

async function fetchFromWb(
  token: string,
  dateFrom: string,
  dateTo: string,
  rrdid: number
): Promise<Record<string, unknown>[]> {
  const url =
    `${WB_STATS_BASE}${WB_REPORT_ENDPOINT}` +
    `?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}` +
    `&limit=${WB_PAGE_LIMIT}&rrdid=${rrdid}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: token }, cache: "no-store" });
  } catch {
    throw new WbReportError("Не удалось подключиться к WB API.");
  }

  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res);
    // WB часто не шлёт Retry-After, но в теле ответа обычно называет окно
    // лимита — сохраняем его в сообщении, чтобы не гадать по логам.
    const bodyText = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
    const hint = bodyText ? ` WB: «${bodyText}»` : "";
    throw new WbReportError(
      (retryAfter !== undefined
        ? `WB ограничивает запросы: просит подождать ${retryAfter} сек.`
        : "WB ограничивает запросы (лимит на частоту).") + hint,
      429,
      retryAfter
    );
  }
  if (res.status === 401) {
    throw new WbReportError(
      "WB отклонил токен (401). Если токен только что создан — подождите пару минут (идёт активация).",
      401
    );
  }
  if (!res.ok) {
    throw new WbReportError(`WB API вернул статус ${res.status}.`, res.status);
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown>[] | null;
  return Array.isArray(data) ? data : [];
}

/**
 * Загружает ОДНУ страницу отчёта: сначала из кэша, иначе из WB (и кладёт в кэш).
 * Используется и пользовательским route, и фоновой подтяжкой недели.
 */
export async function loadPage(
  token: string,
  dateFrom: string,
  dateTo: string,
  rrdid: number
): Promise<LoadedPage> {
  const cached = await getCachedPage(dateFrom, dateTo, rrdid);
  if (cached) return { ...cached, fromCache: true };

  const arr = await fetchFromWb(token, dateFrom, dateTo, rrdid);
  let lastRrdId = rrdid;
  const rows = arr.map((r) => {
    const id = Number(r.rrd_id);
    if (!Number.isNaN(id)) lastRrdId = id;
    return fullRowArray(r);
  });
  const page = {
    rows,
    pageRowCount: arr.length,
    lastRrdId,
    done: arr.length < WB_PAGE_LIMIT,
  };
  try {
    await putCachedPage(dateFrom, dateTo, rrdid, page);
  } catch {
    // Кэш — best effort: не срываем выдачу, если не удалось сохранить.
  }
  return { ...page, fromCache: false };
}

export interface WbPage {
  /** Заголовки колонок, в порядке которых собраны массивы `matched`. */
  columns: string[];
  /** Совпавшие строки этой страницы в компактном виде (массивы по порядку columns). */
  matched: unknown[][];
  /** Всего строк в странице (до фильтра). */
  pageRowCount: number;
  /** Уникальные баркоды, встреченные в этой странице (для статистики). */
  pageBarcodes: string[];
  /** Курсор для следующей страницы. */
  lastRrdId: number;
  /** Больше страниц нет. */
  done: boolean;
  /** Страница пришла из кэша — клиенту не нужно ждать лимит WB. */
  fromCache: boolean;
}

/**
 * Тянет ОДНУ страницу отчёта (кэш или WB) и фильтрует её по набору баркодов,
 * оставляя колонки выбранного режима. Пагинацию ведёт вызывающий код.
 */
export async function fetchWbReportPage(
  token: string,
  dateFrom: string,
  dateTo: string,
  rrdid: number,
  barcodes: Set<string>,
  compact = true
): Promise<WbPage> {
  const page = await loadPage(token, dateFrom, dateTo, rrdid);
  const idx = indicesFor(compact);

  const matched: unknown[][] = [];
  const seen = new Set<string>();
  for (const row of page.rows) {
    const bc = String(row[BARCODE_IDX] ?? "").trim();
    if (bc) seen.add(bc);
    if (bc && barcodes.has(bc)) matched.push(idx.map((i) => row[i]));
  }

  return {
    columns: idx.map((i) => COLS[i][0]),
    matched,
    pageRowCount: page.pageRowCount,
    pageBarcodes: [...seen],
    lastRrdId: page.lastRrdId,
    done: page.done,
    fromCache: page.fromCache,
  };
}
