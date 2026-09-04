import { NextResponse } from "next/server";
import { loadPage, WbReportError } from "@/lib/wbReport";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

/** Пауза между обращениями к WB (лимит + запас). */
const WB_WAIT_MS = 75_000;
/** Бюджет времени на один запуск; остаток недели доберёт следующий запуск. */
const TIME_BUDGET_MS = 240_000;

/**
 * Последняя ЗАКРЫТАЯ неделя WB (понедельник–воскресенье) на момент вызова (UTC).
 * Берём воскресенье строго раньше сегодняшнего дня и 6 дней назад от него.
 */
function lastClosedWeek(now = new Date()): { from: string; to: string } {
  const day = now.getUTCDay(); // 0 = воскресенье
  const back = day === 0 ? 7 : day;
  const sunday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)
  );
  const monday = new Date(sunday);
  monday.setUTCDate(sunday.getUTCDate() - 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

/**
 * GET /api/cron/prefetch-week
 *
 * Фоновая подтяжка последней закрытой недели в кэш, чтобы к моменту, когда
 * пользователь откроет сайт, отчёт уже лежал в кэше и отдавался за секунды.
 * Идемпотентна и возобновляема: страницы, уже лежащие в кэше, пропускаются,
 * а если не уложились в бюджет времени — доберём в следующий запуск.
 *
 * Защита: Vercel Cron шлёт заголовок Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.WB_STATS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "WB_STATS_TOKEN не задан" }, { status: 500 });
  }

  // Можно принудительно указать неделю: ?from=YYYY-MM-DD&to=YYYY-MM-DD
  const { searchParams } = new URL(request.url);
  const week =
    searchParams.get("from") && searchParams.get("to")
      ? { from: searchParams.get("from")!, to: searchParams.get("to")! }
      : lastClosedWeek();

  const started = Date.now();
  const log: string[] = [];
  let rrdid = 0;
  let pages = 0;
  let complete = false;

  try {
    for (;;) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        log.push("бюджет времени исчерпан — остаток доберёт следующий запуск");
        break;
      }
      const page = await loadPage(token, week.from, week.to, rrdid);
      pages++;
      log.push(
        `rrdid=${rrdid}: ${page.pageRowCount} строк, ` +
          `${page.fromCache ? "из кэша" : "скачано из WB"}, done=${page.done}`
      );
      if (page.done) {
        complete = true;
        break;
      }
      rrdid = page.lastRrdId;
      if (!page.fromCache) await new Promise((r) => setTimeout(r, WB_WAIT_MS));
    }
  } catch (e) {
    log.push(
      "ошибка: " + (e instanceof WbReportError || e instanceof Error ? e.message : String(e))
    );
  }

  return NextResponse.json({
    week,
    pages,
    complete,
    elapsedSec: Math.round((Date.now() - started) / 1000),
    log,
  });
}
