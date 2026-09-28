import {
  getCachedPage,
  getCachedPageV1,
  putCachedPage,
  getCachedReports,
  putCachedReports,
} from "@/lib/wbCache";
import { TEMPLATE, WB_TEMPLATE_COLUMNS, cell } from "@/lib/wbColumns";
import { codeSet, normalizeCode } from "@/lib/codes";
import { cardCodeAliases, expandWanted, mergeAliases, weekCodeAliases } from "@/lib/wbAliases";
import {
  fetchDetailed,
  listReports,
  WB_PAGE_LIMIT,
  WbReportError,
  type WbReportMeta,
} from "@/lib/wbApi";

/**
 * Выгрузка детального WB-отчёта за неделю: кэш + новый финансовый API.
 *
 * Как устроено:
 *  - у недели может быть несколько отчётов (reportType 1, 2 …), поэтому курсор
 *    страницы — строка «индекс отчёта:rrdId», а не одно число;
 *  - страницы, скачанные прежним методом (числовой курсор), продолжают
 *    отдаваться из кэша как есть — формат кэша не менялся;
 *  - каждая свежая страница сохраняется в кэш СЫРОЙ (все поля WB), раскладка
 *    по шаблону применяется при выдаче, см. wbColumns.ts.
 *
 * Токен — в переменной окружения WB_STATS_TOKEN, нужна категория «Финансы».
 * ВНИМАНИЕ: модуль серверный (zlib/blob), в клиентские компоненты не импортировать.
 */

export { WbReportError, WB_PAGE_LIMIT };

/** Курсор страницы: число (старый кэш) или «индекс отчёта:rrdId». */
export type PageCursor = number | string;

/** Начальный курсор недели. */
export const FIRST_CURSOR: PageCursor = 0;

function parseCursor(cursor: PageCursor): { idx: number; rrdId: number } {
  const s = String(cursor ?? 0);
  if (s.includes(":")) {
    const [a, b] = s.split(":");
    return { idx: Number(a) || 0, rrdId: Number(b) || 0 };
  }
  return { idx: 0, rrdId: Number(s) || 0 };
}

function isFirstPage(cursor: PageCursor): boolean {
  const { idx, rrdId } = parseCursor(cursor);
  return idx === 0 && rrdId === 0;
}

/** Страница отчёта до фильтрации: сырые поля WB. */
export interface LoadedPage {
  fields: string[];
  rows: unknown[][];
  pageRowCount: number;
  lastRrdId: PageCursor;
  done: boolean;
  /** Страница взята из кэша (WB не вызывался, пауза не нужна). */
  fromCache: boolean;
}

/** Список отчётов недели: из кэша, иначе из WB (и в кэш). */
async function reportsOfWeek(
  token: string,
  dateFrom: string,
  dateTo: string
): Promise<WbReportMeta[]> {
  const cached = await getCachedReports(dateFrom, dateTo);
  if (cached) return cached as WbReportMeta[];
  const list = await listReports(token, dateFrom, dateTo);
  if (list.length) {
    try {
      await putCachedReports(dateFrom, dateTo, list);
    } catch {
      /* кэш — best effort */
    }
  }
  return list;
}

/**
 * Загружает ОДНУ страницу отчёта: сначала из кэша, иначе из WB (и кладёт в кэш).
 * Используется и пользовательским route, и фоновой подтяжкой недели.
 */
export async function loadPage(
  token: string,
  dateFrom: string,
  dateTo: string,
  cursor: PageCursor = FIRST_CURSOR,
  /** Разрешить старый формат кэша как запасной источник (для выдачи — да, для подтяжки — нет). */
  allowLegacy = true
): Promise<LoadedPage> {
  // Старый формат идёт первым: такие недели лежат в кэше целиком.
  if (allowLegacy) {
    const legacy = await getCachedPageV1(dateFrom, dateTo, cursor);
    if (legacy) return { ...legacy, fromCache: true };
  }

  const cached = await getCachedPage(dateFrom, dateTo, cursor);
  if (cached) return { ...cached, fromCache: true };

  const { idx, rrdId } = parseCursor(cursor);
  const reports = await reportsOfWeek(token, dateFrom, dateTo);

  // Отчётов за неделю ещё нет — WB формирует их в понедельник в течение дня.
  if (reports.length === 0) {
    return {
      fields: [],
      rows: [],
      pageRowCount: 0,
      lastRrdId: cursor,
      done: true,
      fromCache: false,
    };
  }
  // Все отчёты недели пройдены.
  if (idx >= reports.length) {
    return { fields: [], rows: [], pageRowCount: 0, lastRrdId: cursor, done: true, fromCache: false };
  }

  const arr = await fetchDetailed(token, reports[idx].reportId, rrdId);

  // Список полей — объединение ключей всех строк (WB может опускать поля).
  const fieldSet = new Set<string>();
  for (const r of arr) for (const k of Object.keys(r)) fieldSet.add(k);
  const fields = [...fieldSet];

  let maxRrd = rrdId;
  const rows = arr.map((r) => {
    const id = Number(r.rrd_id);
    if (!Number.isNaN(id) && id > maxRrd) maxRrd = id;
    return fields.map((f) => (r[f] === undefined ? null : r[f]));
  });

  // Этот отчёт закончился, если строк пришло меньше, чем просили.
  const reportDone = arr.length < WB_PAGE_LIMIT;
  const lastCursor: PageCursor = reportDone ? `${idx + 1}:0` : `${idx}:${maxRrd}`;
  const done = reportDone && idx + 1 >= reports.length;

  const page = { fields, rows, pageRowCount: arr.length, lastRrdId: lastCursor, done };

  // Пустую ПЕРВУЮ страницу не кэшируем: обычно это «отчёт ещё не сформирован».
  if (!(isFirstPage(cursor) && arr.length === 0)) {
    try {
      await putCachedPage(dateFrom, dateTo, cursor, page);
    } catch {
      /* кэш — best effort: не срываем выдачу, если не удалось сохранить */
    }
  }
  return { ...page, fromCache: false };
}

export interface WbPage {
  /** Заголовки колонок (раскладка шаблона A…CE), в порядке массивов `matched`. */
  columns: string[];
  /** Совпавшие строки этой страницы в компактном виде (массивы по порядку columns). */
  matched: unknown[][];
  /** Всего строк в странице (до фильтра). */
  pageRowCount: number;
  /** Уникальные коды товара, встреченные в этой странице (для статистики). */
  pageBarcodes: string[];
  /** Курсор для следующей страницы. */
  lastRrdId: PageCursor;
  /** Больше страниц нет. */
  done: boolean;
  /** Страница пришла из кэша — клиенту не нужно ждать лимит WB. */
  fromCache: boolean;
  /**
   * Пары «код в строке WB → код из справочника»: строки, попавшие в отчёт по
   * новому коду товара, которого в справочнике ещё нет.
   */
  aliases: [string, string][];
}

/**
 * Тянет ОДНУ страницу отчёта (кэш или WB), фильтрует по набору кодов товара и
 * раскладывает строки по позициям шаблона. Пагинацию ведёт вызывающий код.
 */
export async function fetchWbReportPage(
  token: string,
  dateFrom: string,
  dateTo: string,
  cursor: PageCursor,
  barcodes: Set<string>
): Promise<WbPage> {
  const page = await loadPage(token, dateFrom, dateTo, cursor);

  // Индексы сырых полей: для каждой колонки шаблона — откуда брать значение.
  const fieldIdx = new Map<string, number>();
  page.fields.forEach((f, i) => fieldIdx.set(f, i));
  const srcIdx = TEMPLATE.map((c) => (c.key ? fieldIdx.get(c.key) ?? -1 : -1));
  const isDate = TEMPLATE.map((c) => !!c.date);
  const barcodeSrc = fieldIdx.get("barcode") ?? -1;

  // Сравнение по нормализованному коду: WB для части товаров присылает GTIN
  // (14 знаков с ведущим нулём) вместо прежнего баркода, а Google Sheets
  // ведущий ноль теряет. См. lib/codes.ts.
  const wanted = new Map<string, string>();
  for (const b of barcodes) {
    const c = normalizeCode(b);
    if (c && !wanted.has(c)) wanted.set(c, String(b));
  }
  // Плюс подтягиваем «двойников» кода из самой недели: если справочник ещё не
  // дополнили новым кодом, строки с ним всё равно попадут в отчёт. См. wbAliases.ts.
  const [weekMap, cardMap] = await Promise.all([
    weekCodeAliases(dateFrom, dateTo),
    cardCodeAliases(),
  ]);
  const { want, added } = expandWanted(wanted, mergeAliases(weekMap, cardMap));
  const aliasOf = new Map(added);

  const matched: unknown[][] = [];
  const seen = new Set<string>();
  const usedAliases = new Map<string, string>();
  for (const raw of page.rows) {
    const bc = barcodeSrc >= 0 ? String(raw[barcodeSrc] ?? "").trim() : "";
    if (bc) seen.add(bc);
    if (!bc) continue;
    const code = normalizeCode(bc);
    if (!want.has(code)) continue;
    matched.push(srcIdx.map((i, k) => (i >= 0 ? cell(raw[i], isDate[k]) : null)));
    const origin = aliasOf.get(code);
    if (origin !== undefined) usedAliases.set(bc, origin);
  }

  return {
    columns: WB_TEMPLATE_COLUMNS,
    matched,
    pageRowCount: page.pageRowCount,
    pageBarcodes: [...seen],
    lastRrdId: page.lastRrdId,
    done: page.done,
    fromCache: page.fromCache,
    aliases: [...usedAliases],
  };
}
