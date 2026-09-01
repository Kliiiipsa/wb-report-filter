import { ReportRow } from "@/lib/types";

/**
 * Серверная интеграция с TrueStats API для кабинета Miyoumi.
 *
 * TrueStats не отдаёт сырой WB-отчёт, поэтому мы собираем таблицу по баркодам
 * из его аналитики и приводим к «виду как на ВБ» (колонка «Баркод» + метрики),
 * чтобы дальше работала та же фильтрация по баркодам.
 *
 * Токен НЕ хранится в коде — читается из переменной окружения TRUESTATS_TOKEN
 * (серверная, в браузер не попадает).
 */

const BASE = "https://api.truestats.ru";

/** Кабинет Miyoumi в TrueStats (accountId). */
export const MIYOUMI_ACCOUNT_ID = 24935;
export const MIYOUMI_SHEET_NAME = "Miyoumi · TrueStats";

/** Период по умолчанию — «весь период». */
const DEFAULT_DATE_FROM = "2019-01-01";

/** Колонки итоговой таблицы (в стиле WB-отчёта). Первая — ключ фильтрации. */
export const MIYOUMI_COLUMNS = [
  "Баркод",
  "Артикул WB",
  "Артикул продавца",
  "Бренд",
  "Категория",
  "Название",
  "Размер",
  "Кабинет",
  "Выручка",
  "Продажи",
  "К перечислению",
  "Возвраты",
  "Кол-во продаж",
  "Кол-во возвратов",
  "Себестоимость",
  "Логистика",
  "Комиссия",
  "Штрафы",
  "Реклама",
  "Налог",
  "Прибыль",
] as const;

export class TrueStatsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrueStatsError";
  }
}

interface ProductRow {
  article: number;
  accountId: number;
  vendorCode?: string;
  brand?: string;
  category?: string;
  name?: string;
  accountName?: string;
  hasMultipleSizes?: boolean;
  [metric: string]: unknown;
}
interface SizeRow {
  barcode?: string | number;
  size?: string;
  [metric: string]: unknown;
}

function headers(token: string) {
  return { "X-Api-Token": token, "Content-Type": "application/json" };
}

async function apiPost(token: string, path: string, body: unknown) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new TrueStatsError("TrueStats отклонил токен (нет доступа). Проверьте токен.");
    }
    throw new TrueStatsError(`TrueStats ${path}: статус ${res.status}.`);
  }
  return res.json();
}

async function apiGet(token: string, path: string) {
  const res = await fetch(BASE + path, { headers: headers(token), cache: "no-store" });
  if (!res.ok) throw new TrueStatsError(`TrueStats ${path}: статус ${res.status}.`);
  return res.json();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Строит строку итоговой таблицы из продукта (p) и объекта метрик (m). */
function buildRow(
  barcode: string,
  nmId: number,
  size: string,
  p: ProductRow,
  m: Record<string, unknown>
): ReportRow {
  return {
    "Баркод": barcode,
    "Артикул WB": nmId,
    "Артикул продавца": p.vendorCode ?? "",
    "Бренд": p.brand ?? "",
    "Категория": p.category ?? "",
    "Название": p.name ?? "",
    "Размер": size ?? "",
    "Кабинет": p.accountName ?? "Miyoumi",
    "Выручка": num(m.realisation),
    "Продажи": num(m.sales),
    "К перечислению": num(m.toTransfer),
    "Возвраты": num(m.returns),
    "Кол-во продаж": num(m.salesCount),
    "Кол-во возвратов": num(m.returnsCount),
    "Себестоимость": num(m.costOfSales),
    "Логистика": num(m.logistics),
    "Комиссия": num(m.commission),
    "Штрафы": num(m.fines),
    "Реклама": num(m.advertisingExpenseSum),
    "Налог": num(m.tax),
    "Прибыль": num(m.profit),
  };
}

const isBarcode = (v: unknown) => /^\d{6,}$/.test(String(v ?? "").trim());

/** Параллельный маппинг с ограничением одновременных запросов. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

export interface MiyoumiReport {
  rows: ReportRow[];
  headers: string[];
  sheetName: string;
  count: number;
  dateFrom: string;
  dateTo: string;
}

/**
 * Собирает отчёт по баркодам для кабинета Miyoumi за период.
 * @param token TrueStats API токен
 * @param dateFrom начало периода (по умолчанию — весь период)
 * @param dateTo конец периода (по умолчанию — сегодня)
 */
export async function fetchMiyoumiReport(
  token: string,
  dateFrom = DEFAULT_DATE_FROM,
  dateTo = new Date().toISOString().slice(0, 10)
): Promise<MiyoumiReport> {
  const acc = MIYOUMI_ACCOUNT_ID;

  // 1) Метрики по nmId (только Miyoumi). Фильтр аккаунта в API не работает —
  //    отбираем по accountId в ответе.
  const prod = new Map<number, ProductRow>();
  let page = 1;
  let total = Infinity;
  while ((page - 1) * 500 < total) {
    const d = await apiPost(token, "/reporting/main/products", {
      dateFrom,
      dateTo,
      groupBy: "nm_id",
      page,
      limit: 500,
    });
    total = d.total ?? 0;
    for (const r of (d.byProduct ?? []) as ProductRow[]) {
      if (r.accountId === acc) prod.set(r.article, r);
    }
    page++;
  }

  // 2) Разбивка по размерам (баркодам) для многоразмерных товаров.
  const multi = [...prod.values()].filter((r) => r.hasMultipleSizes).map((r) => r.article);
  const sizeByNm = new Map<number, Map<string, SizeRow>>();
  for (let i = 0; i < multi.length; i += 500) {
    const d = await apiPost(token, "/reporting/main/products/sizes", {
      dateFrom,
      dateTo,
      nmIds: multi.slice(i, i + 500),
    });
    for (const it of (d.items ?? []) as { nmId: number; accountId: number; sizes: SizeRow[] }[]) {
      if (it.accountId !== acc) continue;
      const m = new Map<string, SizeRow>();
      for (const s of it.sizes ?? []) {
        const bc = String(s.barcode ?? "").trim();
        if (isBarcode(bc)) m.set(bc, s);
      }
      if (m.size) sizeByNm.set(it.nmId, m);
    }
  }

  // 3) Маппинг nmId -> баркоды (покрывает и одноразмерные товары).
  const first = await apiGet(
    token,
    `/warehouse/article-mapping?accounts%5B%5D=${acc}&page=1&limit=100`
  );
  const totalPages: number = first.totalPages ?? 1;
  const nmBarcodes = new Map<number, Map<string, string>>();
  const collectMapping = (data: unknown[]) => {
    for (const it of data as { marketplaceItems?: { nmId?: number; barcode?: unknown; size?: string }[] }[]) {
      for (const mi of it.marketplaceItems ?? []) {
        if (!mi.nmId || !isBarcode(mi.barcode)) continue;
        const bc = String(mi.barcode).trim();
        if (!nmBarcodes.has(mi.nmId)) nmBarcodes.set(mi.nmId, new Map());
        nmBarcodes.get(mi.nmId)!.set(bc, mi.size ?? "");
      }
    }
  };
  collectMapping(first.data ?? []);
  const restPages = [];
  for (let p = 2; p <= totalPages; p++) restPages.push(p);
  const pages = await mapLimit(restPages, 5, (p) =>
    apiGet(token, `/warehouse/article-mapping?accounts%5B%5D=${acc}&page=${p}&limit=100`)
  );
  for (const pg of pages) collectMapping(pg.data ?? []);

  // 4) Собираем строки: sizes (точные) там где есть, иначе mapping (покрытие).
  const rows: ReportRow[] = [];
  for (const [nmId, p] of prod) {
    const sizes = sizeByNm.get(nmId);
    if (sizes && sizes.size) {
      for (const [bc, m] of sizes) {
        rows.push(buildRow(bc, nmId, String(m.size ?? ""), p, m as Record<string, unknown>));
      }
    } else {
      const bmap = nmBarcodes.get(nmId);
      if (bmap) {
        for (const [bc, size] of bmap) {
          rows.push(buildRow(bc, nmId, size, p, p as Record<string, unknown>));
        }
      }
    }
  }

  return {
    rows,
    headers: [...MIYOUMI_COLUMNS],
    sheetName: MIYOUMI_SHEET_NAME,
    count: rows.length,
    dateFrom,
    dateTo,
  };
}
