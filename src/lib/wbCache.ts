import { put, list } from "@vercel/blob";
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

export interface CachedPage {
  /** Имена полей WB API в порядке значений в `rows`. */
  fields: string[];
  /** Все строки страницы: массивы значений в порядке `fields`. */
  rows: unknown[][];
  pageRowCount: number;
  lastRrdId: number;
  done: boolean;
}

interface Stored extends CachedPage {
  v: 2;
  dateFrom: string;
  dateTo: string;
  rrdid: number;
  savedAt: string;
}

const PREFIX = "wb-weeks/";
const VERSION = "v2";

function enabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function keyFor(dateFrom: string, dateTo: string, rrdid: number): string {
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
  rrdid: number
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

/** Сохраняет страницу в кэш (перезаписывает, если уже есть). */
export async function putCachedPage(
  dateFrom: string,
  dateTo: string,
  rrdid: number,
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
