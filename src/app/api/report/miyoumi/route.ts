import { NextResponse } from "next/server";
import { fetchMiyoumiReport, TrueStatsError } from "@/lib/truestats";

// Сбор отчёта может занять несколько секунд (пагинация TrueStats).
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET /api/report/miyoumi[?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD]
 *
 * Собирает отчёт по баркодам кабинета Miyoumi из TrueStats и возвращает его
 * в структуре, готовой к фильтрации по баркодам (как загруженный WB-отчёт).
 *
 * Токен берётся из серверной переменной окружения TRUESTATS_TOKEN.
 */
export async function GET(request: Request) {
  const token = process.env.TRUESTATS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "На сервере не задан TRUESTATS_TOKEN. Обратитесь к администратору." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? undefined;
  const dateTo = searchParams.get("dateTo") ?? undefined;

  try {
    const report = await fetchMiyoumiReport(token, dateFrom, dateTo);
    return NextResponse.json(report);
  } catch (e) {
    const message =
      e instanceof TrueStatsError
        ? e.message
        : "Не удалось собрать отчёт из TrueStats. Попробуйте позже.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
