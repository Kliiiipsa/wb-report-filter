import { NextResponse } from "next/server";
import { fetchWbReportPage, WbReportError } from "@/lib/wbReport";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Страница WB в 100k строк может отдаваться дольше минуты — даём функции запас
// (Hobby + Fluid Compute допускает до 300 сек).
export const maxDuration = 300;

/**
 * POST /api/report/wb
 * body: { dateFrom, dateTo, rrdid?, barcodes: string[] }
 *
 * Тянет ОДНУ страницу детального WB-отчёта за период и фильтрует её по списку
 * баркодов (фильтр на сервере, чтобы не гонять в браузер сотни тысяч строк).
 * Пагинацию ведёт клиент: передаёт lastRrdId следующей страницы и выдерживает
 * паузу ~60 сек между запросами (лимит WB — 1 запрос в минуту).
 *
 * Токен — из серверной переменной окружения WB_STATS_TOKEN.
 */
export async function POST(request: Request) {
  const token = process.env.WB_STATS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "На сервере не задан WB_STATS_TOKEN. Обратитесь к администратору." },
      { status: 500 }
    );
  }

  let body: {
    dateFrom?: string;
    dateTo?: string;
    rrdid?: number;
    barcodes?: string[];
    compact?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  const { dateFrom, dateTo, rrdid = 0, barcodes = [], compact = true } = body;
  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "Не указан период (dateFrom/dateTo)." },
      { status: 400 }
    );
  }
  if (!Array.isArray(barcodes) || barcodes.length === 0) {
    return NextResponse.json(
      { error: "Пустой список баркодов. Сначала укажите баркоды." },
      { status: 400 }
    );
  }

  try {
    const barcodeSet = new Set(barcodes.map((b) => String(b).trim()));
    const page = await fetchWbReportPage(
      token,
      dateFrom,
      dateTo,
      rrdid,
      barcodeSet,
      compact
    );
    return NextResponse.json(page);
  } catch (e) {
    if (e instanceof WbReportError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 502 });
    }
    return NextResponse.json(
      { error: "Не удалось получить отчёт WB. Попробуйте позже." },
      { status: 502 }
    );
  }
}
