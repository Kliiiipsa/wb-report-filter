import { put, list, del } from "@vercel/blob";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

/**
 * Кэш страниц детального WB-отчёта в Vercel Blob.
 *
 * Зачем: WB отдаёт страницу в 100k строк ~86 сек и жёстко троттлит повторные
 * запросы, а закрытая неделя никогда не меняется. Поэтому каждую страницу
 * недели скачиваем один раз, сохраняем и дальше отдаём из кэша за секунды.
 *
 * Формат v2: храним СЫРЫЕ поля WB API (список полей + строки-массивы в их
 * порядке), а не готовую раскладку. Тогда любая правка раскладки отчёта — это
 * изменение кода, а не перекачка недель из WB.
 *
 * Ключ страницы — sha256(секрет + версия + период + rrdid): путь неугадываемый,
 * а сам хост хранилища нигде не публикуется. Без BLOB_READ_WRITE_TOKEN функции
 * просто ничего не делают.
 */

/** Курсор страницы: число (старый формат) или «индекс отчёта:rrdId». */
export type PageCursor = number | string;

export interface CachedPage {
  /** Имена полей WB API в порядке значений в `rows`. */
  fields: string[];
  /** Все строки страницы: массивы значений в порядке `fields`. */
  rows: unknown[][];
  pageRowCount: number;
  lastRrdId: PageCursor;
  done: boolean;
}

interface Stored extends CachedPage {
  v: 2;
  dateFrom: string;
  dateTo: string;
  rrdid: PageCursor;
  savedAt: string;
}

const PREFIX = "wb-weeks/";
const VERSION = "v2";

function enabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function keyFor(dateFrom: string, dateTo: string, rrdid: PageCursor): string {
  const salt = process.env.CRON_SECRET ?? process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const h = createHash("sha256")
    .update(`${salt}|${VERSION}|${dateFrom}|${dateTo}|${rrdid}`)
    .digest("hex")
    .slice(0, 40);
  return `${PREFIX}${h}.json.gz`;
}

/** Возвращает страницу из кэша или null, если её там нет / кэш недоступен. */
export async function getCachedPage(
  dateFrom: string,
  dateTo: string,
  rrdid: PageCursor
): Promise<CachedPage | null> {
  if (!enabled()) return null;
  try {
    const key = keyFor(dateFrom, dateTo, rrdid);
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key);
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    const gz = Buffer.from(await res.arrayBuffer());
    const stored = JSON.parse(gunzipSync(gz).toString("utf8")) as Stored;
    if (stored.v !== 2 || !Array.isArray(stored.rows) || !Array.isArray(stored.fields)) return null;
    // Пустая первая страница = отчёт на момент скачивания ещё не был сформирован.
    // Считаем, что в кэше её нет, чтобы неделю запросили у WB заново.
    if ((rrdid === 0 || rrdid === "0" || rrdid === "0:0") && stored.rows.length === 0) return null;
    return {
      fields: stored.fields,
      rows: stored.rows,
      pageRowCount: stored.pageRowCount,
      lastRrdId: stored.lastRrdId,
      done: stored.done,
    };
  } catch {
    // Кэш — best effort: любая ошибка = «в кэше нет», идём в WB.
    return null;
  }
}

/**
 * Порядок колонок старого формата кэша (v1): там хранились не сырые поля WB,
 * а 58 уже отобранных колонок. Чтобы недели, скачанные до перехода на v2,
 * можно было отдавать без повторной выгрузки из WB, восстанавливаем их как
 * «сырые» поля по этому списку. Полей, которых в v1 не было (например,
 * cashback_discount), в такой странице не будет — колонка останется пустой.
 */
const V1_FIELDS = [
  "realizationreport_id", "date_from", "date_to", "create_dt", "currency_name", "gi_id",
  "subject_name", "nm_id", "brand_name", "sa_name", "ts_name", "barcode", "doc_type_name",
  "supplier_oper_name", "order_dt", "sale_dt", "rr_dt", "quantity", "retail_price",
  "retail_amount", "sale_percent", "supplier_promo", "retail_price_withdisc_rub", "ppvz_spp_prc",
  "commission_percent", "ppvz_kvw_prc_base", "ppvz_kvw_prc", "ppvz_sales_commission", "ppvz_reward",
  "acquiring_fee", "acquiring_bank", "ppvz_vw", "ppvz_vw_nds", "ppvz_for_pay", "delivery_amount",
  "return_amount", "delivery_rub", "penalty", "additional_payment", "bonus_type_name", "sticker_id",
  "office_name", "ppvz_office_id", "ppvz_office_name", "ppvz_supplier_id", "ppvz_supplier_name",
  "ppvz_inn", "declaration_number", "site_country", "gi_box_type_name", "rebill_logistic_cost",
  "rebill_logistic_org", "storage_fee", "deduction", "acceptance", "srid", "rrd_id", "report_type",
];

function keyForV1(dateFrom: string, dateTo: string, rrdid: PageCursor): string {
  const salt = process.env.CRON_SECRET ?? process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const h = createHash("sha256")
    .update(`${salt}|${dateFrom}|${dateTo}|${rrdid}`)
    .digest("hex")
    .slice(0, 40);
  return `${PREFIX}${h}.json.gz`;
}

/** Запасной источник: страница в старом формате v1 (если неделя качалась до v2). */
export async function getCachedPageV1(
  dateFrom: string,
  dateTo: string,
  rrdid: PageCursor
): Promise<CachedPage | null> {
  if (!enabled()) return null;
  try {
    const key = keyForV1(dateFrom, dateTo, rrdid);
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key);
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    const gz = Buffer.from(await res.arrayBuffer());
    const stored = JSON.parse(gunzipSync(gz).toString("utf8")) as {
      v: number;
      rows: unknown[][];
      pageRowCount: number;
      lastRrdId: number;
      done: boolean;
    };
    if (stored.v !== 1 || !Array.isArray(stored.rows)) return null;
    return {
      fields: V1_FIELDS,
      rows: stored.rows,
      pageRowCount: stored.pageRowCount,
      lastRrdId: stored.lastRrdId,
      done: stored.done,
    };
  } catch {
    return null;
  }
}

/**
 * Удаляет цепочку v1-страниц недели (вызывается, когда неделя полностью
 * перекачана в v2 — чтобы выдача переключилась на новый формат).
 * @returns сколько страниц удалено
 */
export async function deleteLegacyWeek(dateFrom: string, dateTo: string): Promise<number> {
  if (!enabled()) return 0;
  let removed = 0;
  let rrdid: PageCursor = 0;
  for (let guard = 0; guard < 50; guard++) {
    const key = keyForV1(dateFrom, dateTo, rrdid);
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key);
    if (!blob) break;
    // Узнаём курсор следующей страницы до удаления.
    let next: PageCursor | null = null;
    let done = true;
    try {
      const res = await fetch(blob.url, { cache: "no-store" });
      const stored = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as {
        lastRrdId: PageCursor;
        done: boolean;
      };
      next = stored.lastRrdId;
      done = stored.done;
    } catch {
      /* удалим то, что нашли, и остановимся */
    }
    await del(blob.url);
    removed++;
    if (done || next === null || next === rrdid) break;
    rrdid = next;
  }
  return removed;
}

/**
 * Список отчётов недели (метод sales-reports/list). У закрытой недели он не
 * меняется, а лимит запросов к WB общий — поэтому держим его в кэше, чтобы не
 * тратить окно на повторный вызов перед каждой страницей.
 */
function keyForReports(dateFrom: string, dateTo: string): string {
  const salt = process.env.CRON_SECRET ?? process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const h = createHash("sha256")
    .update(`${salt}|reports|${dateFrom}|${dateTo}`)
    .digest("hex")
    .slice(0, 40);
  return `${PREFIX}${h}.json.gz`;
}

export async function getCachedReports(
  dateFrom: string,
  dateTo: string
): Promise<unknown[] | null> {
  if (!enabled()) return null;
  try {
    const key = keyForReports(dateFrom, dateTo);
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key);
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    const stored = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    return Array.isArray(stored?.reports) && stored.reports.length ? stored.reports : null;
  } catch {
    return null;
  }
}

export async function putCachedReports(
  dateFrom: string,
  dateTo: string,
  reports: unknown[]
): Promise<void> {
  if (!enabled()) return;
  const gz = gzipSync(
    Buffer.from(JSON.stringify({ dateFrom, dateTo, savedAt: new Date().toISOString(), reports }), "utf8")
  );
  await put(keyForReports(dateFrom, dateTo), gz, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/gzip",
    cacheControlMaxAge: 0,
  });
}

/**
 * Карта «код ↔ код того же товара» для недели (см. wbAliases.ts).
 * Подпись — число страниц, по которым она собрана: докачали страницу — карта
 * пересобирается.
 */
function keyForAliases(dateFrom: string, dateTo: string, pages: number): string {
  const salt = process.env.CRON_SECRET ?? process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const h = createHash("sha256")
    .update(`${salt}|aliases|${dateFrom}|${dateTo}|${pages}`)
    .digest("hex")
    .slice(0, 40);
  return `${PREFIX}${h}.json.gz`;
}

export async function getCachedAliases(
  dateFrom: string,
  dateTo: string,
  pages: number
): Promise<Record<string, string[]> | null> {
  if (!enabled()) return null;
  try {
    const key = keyForAliases(dateFrom, dateTo, pages);
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key);
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    const stored = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    return stored?.aliases ?? null;
  } catch {
    return null;
  }
}

export async function putCachedAliases(
  dateFrom: string,
  dateTo: string,
  pages: number,
  aliases: Record<string, string[]>
): Promise<void> {
  if (!enabled()) return;
  const gz = gzipSync(Buffer.from(JSON.stringify({ dateFrom, dateTo, pages, aliases }), "utf8"));
  await put(keyForAliases(dateFrom, dateTo, pages), gz, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/gzip",
    cacheControlMaxAge: 0,
  });
}

/**
 * Коды товара из карточек WB: группы «все коды одного размера».
 * Обновляются отдельной задачей, живут до следующего обновления.
 */
function keyForCardCodes(): string {
  const salt = process.env.CRON_SECRET ?? process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const h = createHash("sha256").update(`${salt}|card-codes|v1`).digest("hex").slice(0, 40);
  return `${PREFIX}${h}.json.gz`;
}

export async function getCardCodeGroups(): Promise<string[][] | null> {
  if (!enabled()) return null;
  try {
    const key = keyForCardCodes();
    const { blobs } = await list({ prefix: key, limit: 1 });
    const blob = blobs.find((b) => b.pathname === key);
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    const stored = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    return Array.isArray(stored?.groups) ? stored.groups : null;
  } catch {
    return null;
  }
}

export async function putCardCodeGroups(groups: string[][]): Promise<void> {
  if (!enabled()) return;
  const gz = gzipSync(Buffer.from(JSON.stringify({ savedAt: new Date().toISOString(), groups }), "utf8"));
  await put(keyForCardCodes(), gz, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/gzip",
    cacheControlMaxAge: 0,
  });
}

/** Сохраняет страницу в кэш (перезаписывает, если уже есть). */
export async function putCachedPage(
  dateFrom: string,
  dateTo: string,
  rrdid: PageCursor,
  page: CachedPage
): Promise<void> {
  if (!enabled()) return;
  const stored: Stored = {
    v: 2,
    dateFrom,
    dateTo,
    rrdid,
    savedAt: new Date().toISOString(),
    ...page,
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(stored), "utf8"));
  await put(keyFor(dateFrom, dateTo, rrdid), gz, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/gzip",
    cacheControlMaxAge: 0,
  });
}
