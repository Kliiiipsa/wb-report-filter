import { ReportRow } from "@/lib/types";

/**
 * Колонки детального WB-отчёта и чистые функции над ними.
 *
 * Этот модуль НЕ импортирует ничего серверного (zlib, blob, fetch к WB),
 * поэтому его можно безопасно использовать и в клиентских компонентах.
 * Серверная логика (WB API, кэш) живёт в wbReport.ts.
 */

export const WB_BARCODE_COLUMN = "Баркод";

/** Колонки итогового отчёта: [русский заголовок, поле API, дата?]. Порядок как в WB. */
export const COLS: [string, string, boolean?][] = [
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

/**
 * Компактный набор колонок: обязательные (из шаблона) + то, без чего отчёт
 * не читается. Убраны тяжёлые служебные идентификаторы и дубли (srid,
 * Стикер МГ, ИНН/название партнёра, банк-эквайер, номера офиса/декларации,
 * служебные даты периода и т.п.) — итоговый Excel получается заметно легче.
 */
const COMPACT = new Set<string>([
  "Предмет",
  "Код номенклатуры",
  "Бренд",
  "Артикул поставщика",
  "Название",
  "Размер",
  "Баркод",
  "Тип документа",
  "Обоснование для оплаты",
  "Дата заказа покупателем",
  "Дата продажи",
  "Кол-во",
  "Цена розничная",
  "Вайлдберриз реализовал Товар (Пр)",
  "Согласованная скидка, %",
  "Размер кВВ, %",
  "Вознаграждение Вайлдберриз (ВВ), без НДС",
  "НДС с Вознаграждения Вайлдберриз",
  "К перечислению Продавцу за реализованный Товар",
  "Возмещение расходов по эквайрингу",
  "Услуги по доставке товара покупателю",
  "Общая сумма штрафов",
  "Доплаты",
  "Виды логистики, штрафов и доплат",
  "Возмещение издержек по перевозке/по складским операциям",
  "Хранение",
  "Прочие удержания",
  "Платная приёмка",
  "Склад",
]);

/** Индексы (в COLS) колонок выбранного режима. */
export function indicesFor(compact: boolean): number[] {
  if (!compact) return COLS.map((_, i) => i);
  return COLS.map((c, i) => (COMPACT.has(c[0]) ? i : -1)).filter((i) => i >= 0);
}

/** Список заголовков для выбранного режима. */
export function wbColumns(compact: boolean): string[] {
  return indicesFor(compact).map((i) => COLS[i][0]);
}

/** Компактный набор заголовков (для UI). */
export const WB_COMPACT_COLUMNS = wbColumns(true);

export const DATE_KEYS = new Set(COLS.filter((c) => c[2]).map((c) => c[1]));
export const BARCODE_IDX = COLS.findIndex((c) => c[0] === WB_BARCODE_COLUMN);

/** Нормализует значение ячейки; даты приводит к YYYY-MM-DD. */
export function cell(value: unknown, isDate: boolean): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (isDate && typeof value === "string") return value.slice(0, 10);
  return value;
}

/** Восстанавливает объект-строку из компактного массива (для клиента). */
export function wbArrayToRow(values: unknown[], columns: string[]): ReportRow {
  const row: ReportRow = {};
  for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i] ?? null;
  return row;
}
