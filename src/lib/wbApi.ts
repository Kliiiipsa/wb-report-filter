/**
 * Клиент нового финансового API WB (детальный отчёт о реализации).
 *
 * 22 сентября 2026 WB отключил прежний метод
 * statistics-api → GET /api/v5/supplier/reportDetailByPeriod: он отвечает
 * 404 «This method is deprecated» на любой период, включая старые.
 * Замена — два метода на finance-api:
 *   POST /api/finance/v1/sales-reports/list            {dateFrom, dateTo}
 *   POST /api/finance/v1/sales-reports/detailed/{id}   {rrdId, limit}
 * Оба требуют токен с категорией «Финансы» и держат лимит ~1 запрос в минуту
 * (при превышении — 429 и заголовок X-RateLimit-Retry с числом секунд).
 *
 * Важное отличие: у недели может быть НЕСКОЛЬКО отчётов (reportType 1, 2 …),
 * и их строки нужно выгружать по очереди.
 *
 * Поля в новом ответе названы иначе (camelCase). Чтобы не переделывать
 * раскладку шаблона и не терять уже скачанные недели в кэше, каждая строка
 * приводится к прежним именам полей — см. NEW_TO_OLD.
 */

export const WB_FINANCE_HOST = "https://finance-api.wildberries.ru";
/** Сколько строк просим за один запрос. */
export const WB_PAGE_LIMIT = 20000;

export class WbReportError extends Error {
  status?: number;
  /** Сколько секунд WB просит подождать. */
  retryAfterSec?: number;
  constructor(message: string, status?: number, retryAfterSec?: number) {
    super(message);
    this.name = "WbReportError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Новое имя поля → прежнее (на нём построена раскладка шаблона). */
const NEW_TO_OLD: Record<string, string> = {
  rrdId: "rrd_id",
  giId: "gi_id",
  dlvPrc: "dlv_prc",
  fixTariffDateFrom: "fix_tariff_date_from",
  fixTariffDateTo: "fix_tariff_date_to",
  subjectName: "subject_name",
  nmId: "nm_id",
  brandName: "brand_name",
  vendorCode: "sa_name",
  title: "title",
  techSize: "ts_name",
  sku: "barcode",
  docTypeName: "doc_type_name",
  sellerOperName: "supplier_oper_name",
  orderDt: "order_dt",
  saleDt: "sale_dt",
  rrDate: "rr_dt",
  shkId: "shk_id",
  retailPrice: "retail_price",
  retailAmount: "retail_amount",
  salePercent: "sale_percent",
  commissionPercent: "commission_percent",
  officeName: "office_name",
  retailPriceWithDisc: "retail_price_withdisc_rub",
  deliveryAmount: "delivery_amount",
  returnAmount: "return_amount",
  deliveryService: "delivery_rub",
  giBoxTypeName: "gi_box_type_name",
  productDiscountForReport: "product_discount_for_report",
  sellerPromo: "supplier_promo",
  spp: "ppvz_spp_prc",
  kvwBase: "ppvz_kvw_prc_base",
  kvw: "ppvz_kvw_prc",
  supRatingUp: "sup_rating_prc_up",
  isKgvpV2: "is_kgvp_v2",
  ppvzSalesCommission: "ppvz_sales_commission",
  forPay: "ppvz_for_pay",
  ppvzReward: "ppvz_reward",
  acquiringFee: "acquiring_fee",
  acquiringPercent: "acquiring_percent",
  paymentProcessing: "payment_processing",
  acquiringBank: "acquiring_bank",
  vw: "ppvz_vw",
  vwNds: "ppvz_vw_nds",
  ppvzOfficeName: "ppvz_office_name",
  ppvzOfficeId: "ppvz_office_id",
  ppvzSupplierName: "ppvz_supplier_name",
  ppvzSupplierInn: "ppvz_inn",
  declarationNumber: "declaration_number",
  stickerId: "sticker_id",
  country: "site_country",
  srvDbs: "srv_dbs",
  penalty: "penalty",
  additionalPayment: "additional_payment",
  bonusTypeName: "bonus_type_name",
  rebillLogisticCost: "rebill_logistic_cost",
  rebillLogisticOrg: "rebill_logistic_org",
  paidStorage: "storage_fee",
  deduction: "deduction",
  paidAcceptance: "acceptance",
  // Номер сборочного задания: в прежнем ответе assembly_id, теперь orderId.
  orderId: "assembly_id",
  // Признак продажи юрлицу: было is_legal_entity, стало isB2b.
  isB2b: "is_legal_entity",
  trbxId: "trbx_id",
  installmentCofinancingAmount: "installment_cofinancing_amount",
  wibesDiscountPercent: "wibes_wb_discount_percent",
  cashbackAmount: "cashback_amount",
  cashbackDiscount: "cashback_discount",
  cashbackCommissionChange: "cashback_commission_change",
  paymentSchedule: "payment_schedule",
  deliveryMethod: "delivery_method",
  sellerPromoId: "seller_promo_id",
  sellerPromoDiscount: "seller_promo_discount",
  loyaltyId: "loyalty_id",
  loyaltyDiscount: "loyalty_discount",
  uuidPromocode: "uuid_promocode",
  salePricePromocodeDiscountPrc: "sale_price_promocode_discount_prc",
  articleSubstitution: "article_substitution",
  salePriceAffiliatedDiscountPrc: "sale_price_affiliated_discount_prc",
  salePriceWholesaleDiscountPrc: "sale_price_wholesale_discount_prc",
  srid: "srid",
  orderUid: "order_uid",
  reportType: "report_type",
  reportId: "realizationreport_id",
  currency: "currency_name",
  createDate: "create_dt",
  dateFrom: "date_from",
  dateTo: "date_to",
};

/** Приводит строку нового ответа к прежним именам полей. */
export function toOldRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[NEW_TO_OLD[k] ?? k] = v;
  return out;
}

function retryAfterOf(res: Response): number | undefined {
  const raw = res.headers.get("x-ratelimit-retry") ?? res.headers.get("retry-after");
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

async function post(token: string, path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${WB_FINANCE_HOST}${path}`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new WbReportError("Не удалось подключиться к WB API.");
  }

  if (res.status === 429) {
    const retryAfter = retryAfterOf(res);
    throw new WbReportError(
      retryAfter !== undefined
        ? `WB ограничивает запросы: просит подождать ${retryAfter} сек.`
        : "WB ограничивает запросы (лимит на частоту).",
      429,
      retryAfter
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new WbReportError(
      `WB отклонил токен (${res.status}). Нужен токен с категорией «Финансы»; ` +
        "если он только что создан — подождите пару минут.",
      res.status
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new WbReportError(`WB API вернул статус ${res.status}.${text ? ` ${text}` : ""}`, res.status);
  }
  return res.json().catch(() => null);
}

export interface WbReportMeta {
  reportId: number;
  reportType: number;
  dateFrom: string;
  dateTo: string;
}

/** Список отчётов недели (их может быть несколько: разные reportType). */
export async function listReports(
  token: string,
  dateFrom: string,
  dateTo: string
): Promise<WbReportMeta[]> {
  const data = await post(token, "/api/finance/v1/sales-reports/list", { dateFrom, dateTo });
  if (!Array.isArray(data)) return [];
  return data
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r.reportId === "number")
    .map((r) => ({
      reportId: r.reportId as number,
      reportType: Number(r.reportType ?? 0),
      dateFrom: String(r.dateFrom ?? dateFrom),
      dateTo: String(r.dateTo ?? dateTo),
    }))
    .sort((a, b) => a.reportType - b.reportType || a.reportId - b.reportId);
}

/** Одна страница строк отчёта (строки уже с прежними именами полей). */
export async function fetchDetailed(
  token: string,
  reportId: number,
  rrdId: number,
  limit = WB_PAGE_LIMIT
): Promise<Record<string, unknown>[]> {
  const data = await post(token, `/api/finance/v1/sales-reports/detailed/${reportId}`, {
    rrdId,
    limit,
  });
  if (!Array.isArray(data)) return [];
  return data.map((r) => toOldRow(r as Record<string, unknown>));
}
