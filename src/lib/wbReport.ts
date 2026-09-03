import { ReportRow } from "@/lib/types";

/**
 * Серверная интеграция с WB Statistics API (детальный отчёт о реализации).
 *
 * Метод reportDetailByPeriod отдаёт настоящий построчный WB-отчёт со всеми
 * колонками (Тип документа, Обоснование для оплаты, даты, регион и т.д.).
 * Ограничения WB: максимум 100 000 строк на запрос и не чаще 1 запроса в минуту,
 * поэтому выгрузка идёт постранично по курсору rrdid (пагинацию ведёт клиент,
 * выдерживая паузу между страницами).
 *
 * Токен читается из серверной переменной окружения WB_STATS_TOKEN.
 */

export const WB_STATS_BASE = "https://statistics-api.wildberries.ru";
export const WB_REPORT_ENDPOINT = "/api/v5/supplier/reportDetailByPeriod";
export const WB_PAGE_LIMIT = 100000;
export const WB_BARCODE_COLUMN = "Баркод";

export class WbReportError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WbReportError";
    this.status = status;
  }
}

/** Колонки итогового отчёта: [русский заголовок, поле API, дата?]. Порядок как в WB. */
const COLS: [string, string, boolean?][] = [
  ["Номер отчёта", "realizationreport_id"],
  ["Дата начала отчётного периода", "date_from", true],
  ["Дата конца отчётного периода", "date_to", true],
  ["Дата формирования отчёта", "create_dt", true],
  ["Валюта отчёта", "currency_name"],
  ["Номер поставки", "gi_id"],
  ["Предмет", "subject_name"],
  ["Код номенклатуры", "nm_id"],
  ["Бренд", "brand_name"],
  ["Артикул поставщика", "sa_name"],
  ["Размер", "ts_name"],
  ["Баркод", "barcode"],
  ["Тип документа", "doc_type_name"],
  ["Обоснование для оплаты", "supplier_oper_name"],
  ["Дата заказа покупателем", "order_dt", true],
  ["Дата продажи", "sale_dt", true],
  ["Дата операции", "rr_dt", true],
  ["Кол-во", "quantity"],
  ["Цена розничная", "retail_price"],
  ["Вайлдберриз реализовал Товар (Пр)", "retail_amount"],
  ["Согласованная скидка, %", "sale_percent"],
  ["Промокод, %", "supplier_promo"],
  ["Цена розничная с учётом согласованной скидки", "retail_price_withdisc_rub"],
  ["Скидка постоянного покупателя (СПП), %", "ppvz_spp_prc"],
  ["Размер кВВ, %", "commission_percent"],
  ["Размер кВВ без НДС, % базовый", "ppvz_kvw_prc_base"],
  ["Итоговый кВВ без НДС, %", "ppvz_kvw_prc"],
  ["Вознаграждение с продаж до вычета услуг поверенного, без НДС", "ppvz_sales_commission"],
  ["Возмещение за выдачу и возврат товаров на ПВЗ", "ppvz_reward"],
  ["Возмещение расходов по эквайрингу", "acquiring_fee"],
  ["Наименование банка-эквайера", "acquiring_bank"],
  ["Вознаграждение Вайлдберриз (ВВ), без НДС", "ppvz_vw"],
  ["НДС с Вознаграждения Вайлдберриз", "ppvz_vw_nds"],
  ["К перечислению Продавцу за реализованный Товар", "ppvz_for_pay"],
  ["Количество доставок", "delivery_amount"],
  ["Количество возвратов", "return_amount"],
  ["Услуги по доставке товара покупателю", "delivery_rub"],
  ["Общая сумма штрафов", "penalty"],
  ["Доплаты", "additional_payment"],
  ["Виды логистики, штрафов и доплат", "bonus_type_name"],
  ["Стикер МГ", "sticker_id"],
  ["Склад", "office_name"],
  ["Номер офиса", "ppvz_office_id"],
  ["Наименование офиса доставки", "ppvz_office_name"],
  ["Номер партнёра", "ppvz_supplier_id"],
  ["Партнёр", "ppvz_supplier_name"],
  ["ИНН партнёра", "ppvz_inn"],
  ["Номер таможенной декларации", "declaration_number"],
  ["Код страны", "site_country"],
  ["Тип коробов", "gi_box_type_name"],
  ["Возмещение издержек по перевозке/по складским операциям", "rebill_logistic_cost"],
  ["Организатор перевозки", "rebill_logistic_org"],
  ["Хранение", "storage_fee"],
  ["Прочие удержания", "deduction"],
  ["Платная приёмка", "acceptance"],
  ["Уникальный идентификатор (srid)", "srid"],
  ["Номер строки", "rrd_id"],
  ["Тип записи", "report_type"],
];

/** Заголовки итоговой таблицы (в порядке WB-отчёта). */
export const WB_COLUMNS = COLS.map((c) => c[0]);

const DATE_KEYS = new Set(COLS.filter((c) => c[2]).map((c) => c[1]));

function cell(value: unknown, isDate: boolean): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (isDate && typeof value === "string") return value.slice(0, 10); // YYYY-MM-DD
  return value;
}

/** Преобразует строку API в строку с русскими заголовками (как в WB-отчёте). */
export function mapWbRow(apiRow: Record<string, unknown>): ReportRow {
  const row: ReportRow = {};
  for (const [ru, key] of COLS) {
    row[ru] = cell(apiRow[key], DATE_KEYS.has(key));
  }
  return row;
}

/**
 * Компактное представление строки: массив значений в порядке WB_COLUMNS.
 * Без повторяющихся ключей ответ в 3–4 раза меньше — важно для недели
 * с десятками тысяч совпавших строк.
 */
export function mapWbRowArray(apiRow: Record<string, unknown>): unknown[] {
  return COLS.map(([, key]) => cell(apiRow[key], DATE_KEYS.has(key)));
}

/** Восстанавливает объект-строку из компактного массива (для клиента). */
export function wbArrayToRow(values: unknown[]): ReportRow {
  const row: ReportRow = {};
  for (let i = 0; i < WB_COLUMNS.length; i++) row[WB_COLUMNS[i]] = values[i] ?? null;
  return row;
}

export interface WbPage {
  /** Совпавшие строки этой страницы в компактном виде (массивы по порядку WB_COLUMNS). */
  matched: unknown[][];
  /** Всего строк в странице (до фильтра). */
  pageRowCount: number;
  /** Уникальные баркоды, встреченные в этой странице (для статистики). */
  pageBarcodes: string[];
  /** Курсор для следующей страницы. */
  lastRrdId: number;
  /** Больше страниц нет. */
  done: boolean;
}

/**
 * Тянет ОДНУ страницу отчёта и фильтрует её по набору баркодов.
 * Пагинацию (следующий rrdid, паузы между запросами) ведёт вызывающий код.
 */
export async function fetchWbReportPage(
  token: string,
  dateFrom: string,
  dateTo: string,
  rrdid: number,
  barcodes: Set<string>
): Promise<WbPage> {
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
    throw new WbReportError(
      "WB ограничивает запросы (не чаще 1 в минуту). Подождите минуту.",
      429
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
  const arr = Array.isArray(data) ? data : [];

  const matched: unknown[][] = [];
  const seen = new Set<string>();
  let lastRrdId = rrdid;
  for (const r of arr) {
    const bc = String(r.barcode ?? "").trim();
    if (bc) seen.add(bc);
    if (bc && barcodes.has(bc)) matched.push(mapWbRowArray(r));
    const id = Number(r.rrd_id);
    if (!Number.isNaN(id)) lastRrdId = id;
  }

  return {
    matched,
    pageRowCount: arr.length,
    pageBarcodes: [...seen],
    lastRrdId,
    done: arr.length < WB_PAGE_LIMIT,
  };
}
