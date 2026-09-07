import { getCachedPage, getCachedPageV1, putCachedPage } from "@/lib/wbCache";
import { TEMPLATE, WB_TEMPLATE_COLUMNS, cell } from "@/lib/wbColumns";

/**
 * Серверная интеграция с WB Statistics API (детальный отчёт о реализации).
 *
 * Метод reportDetailByPeriod отдаёт настоящий построчный WB-отчёт (≈90 полей).
 * Ограничения WB: максимум 100 000 строк на запрос (~205 МБ, ~86 сек) и
 * жёсткий троттлинг повторных запросов. Поэтому:
 *  - выгрузка идёт постранично по курсору rrdid (пагинацию ведёт клиент);
 *  - каждая скачанная страница сохраняется в кэш (Vercel Blob) СЫРОЙ — все
 *    поля WB — и в следующий раз отдаётся оттуда мгновенно;
 *  - раскладка отчёта (позиции колонок по шаблону коллег) применяется при
 *    выдаче, см. wbColumns.ts.
 *
 * Токен читается из серверной переменной окружения WB_STATS_TOKEN.
 * ВНИМАНИЕ: модуль серверный (zlib/blob) — в клиентские компоненты не импортировать,
 * для них есть wbColumns.ts.
 */

export const WB_STATS_BASE = "https://statistics-api.wildberries.ru";
export const WB_REPORT_ENDPOINT = "/api/v5/supplier/reportDetailByPeriod";
/**
 * Размер страницы. Максимум у WB — 100 000, но такие страницы (≈205 МБ, ~86 с)
 * WB после первой же начинает отбивать 429 на ~10 минут, тогда как страницы
 * по 20 000 (≈41 МБ, ~24 с) проходят стабильно. Больше страниц — но каждая
 * реально приходит, и в сумме неделя собирается быстрее.
 */
export const WB_PAGE_LIMIT = 20000;

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

/** Страница отчёта до фильтрации: сырые поля WB. */
export interface LoadedPage {
  fields: string[];
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
  rrdid: number,
  /** Разрешить старый формат кэша как запасной источник (для выдачи — да, для подтяжки — нет). */
  allowLegacy = true
): Promise<LoadedPage> {
  // Для выдачи старый формат идёт ПЕРВЫМ: в нём недели лежат целиком, а в новом
  // могут быть скачаны лишь частично (страницы разного размера — курсоры не
  // совпадают, смешивать форматы в одной цепочке нельзя). Когда подтяжка
  // докачает неделю в v2, она удалит v1-страницы — и приоритет перейдёт к v2.
  if (allowLegacy) {
    const legacy = await getCachedPageV1(dateFrom, dateTo, rrdid);
    if (legacy) return { ...legacy, fromCache: true };
  }

  const cached = await getCachedPage(dateFrom, dateTo, rrdid);
  if (cached) return { ...cached, fromCache: true };

  const arr = await fetchFromWb(token, dateFrom, dateTo, rrdid);

  // Список полей — объединение ключей всех строк (WB может опускать поля).
  const fieldSet = new Set<string>();
  for (const r of arr) for (const k of Object.keys(r)) fieldSet.add(k);
  const fields = [...fieldSet];

  let lastRrdId = rrdid;
  const rows = arr.map((r) => {
    const id = Number(r.rrd_id);
    if (!Number.isNaN(id)) lastRrdId = id;
    return fields.map((f) => (r[f] === undefined ? null : r[f]));
  });

  const page = {
    fields,
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
  /** Заголовки колонок (раскладка шаблона A…CE), в порядке массивов `matched`. */
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
 * Тянет ОДНУ страницу отчёта (кэш или WB), фильтрует по набору баркодов и
 * раскладывает строки по позициям шаблона. Пагинацию ведёт вызывающий код.
 */
export async function fetchWbReportPage(
  token: string,
  dateFrom: string,
  dateTo: string,
  rrdid: number,
  barcodes: Set<string>
): Promise<WbPage> {
  const page = await loadPage(token, dateFrom, dateTo, rrdid);

  // Индексы сырых полей: для каждой колонки шаблона — откуда брать значение.
  const fieldIdx = new Map<string, number>();
  page.fields.forEach((f, i) => fieldIdx.set(f, i));
  const srcIdx = TEMPLATE.map((c) => (c.key ? fieldIdx.get(c.key) ?? -1 : -1));
  const isDate = TEMPLATE.map((c) => !!c.date);
  const barcodeSrc = fieldIdx.get("barcode") ?? -1;

  const matched: unknown[][] = [];
  const seen = new Set<string>();
  for (const raw of page.rows) {
    const bc = barcodeSrc >= 0 ? String(raw[barcodeSrc] ?? "").trim() : "";
    if (bc) seen.add(bc);
    if (bc && barcodes.has(bc)) {
      matched.push(srcIdx.map((i, k) => (i >= 0 ? cell(raw[i], isDate[k]) : null)));
    }
  }

  return {
    columns: WB_TEMPLATE_COLUMNS,
    matched,
    pageRowCount: page.pageRowCount,
    pageBarcodes: [...seen],
    lastRrdId: page.lastRrdId,
    done: page.done,
    fromCache: page.fromCache,
  };
}
