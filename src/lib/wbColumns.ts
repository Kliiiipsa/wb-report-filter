import { ReportRow } from "@/lib/types";

/**
 * Раскладка итогового отчёта по API — СТРОГО по шаблону коллег (файл 11.xlsx):
 * каждая колонка стоит на своей позиции (A…CE), потому что их формулы читают
 * данные по буквам колонок. Необязательные колонки, для которых у WB API нет
 * поля, остаются пустыми, но позицию держат.
 *
 * Этот модуль НЕ импортирует ничего серверного, его можно использовать в
 * клиентских компонентах. Серверная логика — в wbReport.ts.
 */

export interface TemplateColumn {
  /** Буква колонки в Excel (для справки/отладки). */
  col: string;
  /** Заголовок ровно как в шаблоне. */
  name: string;
  /** Поле WB API (reportDetailByPeriod) или null, если данных нет. */
  key: string | null;
  /** Обязательная по шаблону (отмечена VERDADERO). */
  required?: boolean;
  /** Дата: приводим к YYYY-MM-DD. */
  date?: boolean;
}

export const WB_BARCODE_COLUMN = "Баркод";
export const WB_ROW_NUMBER_COLUMN = "№";

export const TEMPLATE: TemplateColumn[] = [
  { col: "A", name: "№", key: null }, // нумеруется на клиенте по итоговому результату
  { col: "B", name: "Номер поставки", key: "gi_id" },
  { col: "C", name: "Предмет", key: "subject_name" },
  { col: "D", name: "Код номенклатуры", key: "nm_id" },
  { col: "E", name: "Бренд", key: "brand_name" },
  { col: "F", name: "Артикул поставщика", key: "sa_name" },
  { col: "G", name: "Название", key: null },
  { col: "H", name: "Размер", key: "ts_name" },
  { col: "I", name: "Баркод", key: "barcode", required: true },
  { col: "J", name: "Тип документа", key: "doc_type_name", required: true },
  { col: "K", name: "Обоснование для оплаты", key: "supplier_oper_name", required: true },
  { col: "L", name: "Дата заказа покупателем", key: "order_dt", date: true },
  { col: "M", name: "Дата продажи", key: "sale_dt", required: true, date: true },
  { col: "N", name: "Кол-во", key: "quantity", required: true },
  { col: "O", name: "Цена розничная", key: "retail_price", required: true },
  { col: "P", name: "Вайлдберриз реализовал Товар (Пр)", key: "retail_amount", required: true },
  { col: "Q", name: "Согласованный продуктовый дисконт, %", key: "product_discount_for_report" },
  { col: "R", name: "Промокод, %", key: "supplier_promo" },
  { col: "S", name: "Итоговая согласованная скидка, %", key: "sale_percent" },
  { col: "T", name: "Цена розничная с учетом согласованной скидки", key: "retail_price_withdisc_rub" },
  { col: "U", name: "Размер снижения кВВ из-за рейтинга, %", key: "sup_rating_prc_up" },
  { col: "V", name: "Размер изменения кВВ из-за акции, %", key: "is_kgvp_v2" },
  { col: "W", name: "Платформенные скидки, %", key: "ppvz_spp_prc" },
  { col: "X", name: "Размер кВВ, %", key: "commission_percent" },
  { col: "Y", name: "Размер кВВ без НДС, % Базовый", key: "ppvz_kvw_prc_base" },
  { col: "Z", name: "Итоговый кВВ без НДС, %", key: "ppvz_kvw_prc" },
  { col: "AA", name: "Вознаграждение с продаж до вычета услуг поверенного, без НДС", key: "ppvz_sales_commission" },
  { col: "AB", name: "Возмещение за выдачу и возврат товаров на ПВЗ", key: "ppvz_reward", required: true },
  { col: "AC", name: "Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов", key: "acquiring_fee", required: true },
  { col: "AD", name: "Размер компенсации платёжных услуг/Комиссии за интеграцию платёжных сервисов, %", key: "acquiring_percent" },
  { col: "AE", name: "Тип платежа: компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов", key: "payment_processing" },
  { col: "AF", name: "Вознаграждение Вайлдберриз (ВВ), без НДС", key: "ppvz_vw", required: true },
  { col: "AG", name: "НДС с Вознаграждения Вайлдберриз", key: "ppvz_vw_nds", required: true },
  { col: "AH", name: "К перечислению Продавцу за реализованный Товар", key: "ppvz_for_pay", required: true },
  { col: "AI", name: "Количество доставок", key: "delivery_amount" },
  { col: "AJ", name: "Количество возврата", key: "return_amount" },
  { col: "AK", name: "Услуги по доставке товара покупателю", key: "delivery_rub", required: true },
  { col: "AL", name: "Дата начала действия фиксации", key: "fix_tariff_date_from", date: true },
  { col: "AM", name: "Дата конца действия фиксации", key: "fix_tariff_date_to", date: true },
  { col: "AN", name: "Признак услуги платной доставки", key: "srv_dbs" },
  { col: "AO", name: "Общая сумма штрафов", key: "penalty", required: true },
  { col: "AP", name: "Корректировка Вознаграждения Вайлдберриз (ВВ)", key: "additional_payment" },
  { col: "AQ", name: "Виды логистики, штрафов и корректировок ВВ", key: "bonus_type_name" },
  { col: "AR", name: "Стикер МП", key: "sticker_id" },
  { col: "AS", name: "Наименование банка-эквайера", key: "acquiring_bank" },
  { col: "AT", name: "Номер офиса", key: "ppvz_office_id" },
  { col: "AU", name: "Наименование офиса доставки", key: "ppvz_office_name" },
  { col: "AV", name: "ИНН партнера", key: "ppvz_inn" },
  { col: "AW", name: "Партнер", key: "ppvz_supplier_name" },
  { col: "AX", name: "Склад", key: "office_name" },
  { col: "AY", name: "Страна", key: "site_country" },
  { col: "AZ", name: "Тип коробов", key: "gi_box_type_name" },
  { col: "BA", name: "Номер таможенной декларации", key: "declaration_number" },
  { col: "BB", name: "Номер сборочного задания", key: "assembly_id" },
  { col: "BC", name: "Код маркировки", key: "kiz" },
  { col: "BD", name: "ШК", key: "shk_id" },
  { col: "BE", name: "Srid", key: "srid" },
  { col: "BF", name: "Возмещение издержек по перевозке/по складским операциям с товаром", key: "rebill_logistic_cost" },
  { col: "BG", name: "Организатор перевозки", key: "rebill_logistic_org" },
  { col: "BH", name: "Хранение", key: "storage_fee" },
  { col: "BI", name: "Удержания", key: "deduction" },
  { col: "BJ", name: "Операции на приемке", key: "acceptance" },
  { col: "BK", name: "chrtId", key: null },
  { col: "BL", name: "Фиксированный коэффициент склада по поставке", key: "dlv_prc" },
  { col: "BM", name: "Признак продажи юридическому лицу", key: "is_legal_entity" },
  { col: "BN", name: "Номер короба для обработки товара", key: "trbx_id" },
  { col: "BO", name: "Скидка по программе софинансирования", key: "installment_cofinancing_amount" },
  { col: "BP", name: "Скидка Wibes, %", key: "wibes_wb_discount_percent" },
  { col: "BQ", name: "Сумма баллов, удержанных по программе лояльности", key: "cashback_amount" },
  { col: "BR", name: "Компенсация скидки по программе лояльности", key: "cashback_discount", required: true },
  { col: "BS", name: "Стоимость участия в программе лояльности", key: "cashback_commission_change" },
  { col: "BT", name: "Id корзины заказа", key: "order_uid" },
  { col: "BU", name: "Разовое изменение срока перечисления денежных средств", key: "payment_schedule" },
  { col: "BV", name: "Id собственной акции продавца с дополнительной скидкой", key: "seller_promo_id" },
  { col: "BW", name: "Размер дополнительной скидки по собственной акции продавца, %", key: "seller_promo_discount" },
  { col: "BX", name: "Способы продажи и тип товара", key: "delivery_method" },
  { col: "BY", name: "Уникальный идентификатор скидки лояльности от продавца", key: "loyalty_id" },
  { col: "BZ", name: "Размер скидки лояльности от продавца, %", key: "loyalty_discount" },
  { col: "CA", name: "Id промокода", key: "uuid_promocode" },
  { col: "CB", name: "Скидка за промокод, %", key: "sale_price_promocode_discount_prc" },
  { col: "CC", name: "Id подменного артикула", key: "article_substitution" },
  { col: "CD", name: "Скидка по подменному артикулу, %", key: "sale_price_affiliated_discount_prc" },
  { col: "CE", name: "Оптовая скидка для бизнеса, %", key: "sale_price_wholesale_discount_prc" },
];

/** Заголовки итоговой таблицы в порядке шаблона (A…CE). */
export const WB_TEMPLATE_COLUMNS = TEMPLATE.map((c) => c.name);
/** Индекс колонки «Баркод» в раскладке шаблона. */
export const WB_TEMPLATE_BARCODE_IDX = TEMPLATE.findIndex((c) => c.name === WB_BARCODE_COLUMN);
/** Индекс колонки «№». */
export const WB_TEMPLATE_ROWNUM_IDX = TEMPLATE.findIndex((c) => c.name === WB_ROW_NUMBER_COLUMN);
/** Сколько обязательных колонок в шаблоне (для UI). */
export const WB_TEMPLATE_REQUIRED_COUNT = TEMPLATE.filter((c) => c.required).length;

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
