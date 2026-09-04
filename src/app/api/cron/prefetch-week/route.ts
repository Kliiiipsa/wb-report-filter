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
 * Heartbeat: прокси Vercel закрывает соединение, которое ~2 минуты не шлёт
 * байты, а мы подолгу ждём WB. Поэтому ответ потоковый и каждые 15 с уходит
 * пустая строка — соединение живёт, функция дорабатывает до конца.
 */
const HEARTBEAT_MS = 15_000;

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
 * GET /api/cron/prefetch-week[?from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * Фоновая подтяжка последней закрытой недели в кэш, чтобы к моменту, когда
 * пользователь откроет сайт, отчёт уже лежал в кэше и отдавался за секунды.
 * Идемпотентна и возобновляема: страницы, уже лежащие в кэше, пропускаются,
 * а если не уложились в бюджет времени — доберём в следующий запуск.
 *
 * Ответ — NDJSON-поток: строки прогресса {"log":...}, в конце {"done":true,...}.
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

  const { searchParams } = new URL(request.url);
  const week =
    searchParams.get("from") && searchParams.get("to")
      ? { from: searchParams.get("from")!, to: searchParams.get("to")! }
      : lastClosedWeek();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          /* поток уже закрыт */
        }
      }, HEARTBEAT_MS);

      const started = Date.now();
      let rrdid = 0;
      let pages = 0;
      let complete = false;
      let throttled = 0;

      send({ log: `старт: неделя ${week.from}..${week.to}` });
      try {
        for (;;) {
          if (Date.now() - started > TIME_BUDGET_MS) {
            send({ log: "бюджет времени исчерпан — остаток доберёт следующий запуск" });
            break;
          }
          let page;
          try {
            page = await loadPage(token, week.from, week.to, rrdid);
          } catch (e) {
            // WB держит лимит. Слепые повторы каждые 1–2 минуты только продлевают
            // блокировку (проверено), поэтому: повторяем ОДИН раз и только если WB
            // сам сказал, сколько ждать (Retry-After) и это влезает в бюджет;
            // иначе завершаем прогон — остаток доберёт следующий запуск.
            if (e instanceof WbReportError && e.status === 429) {
              const ra = e.retryAfterSec;
              if (
                throttled === 0 &&
                ra !== undefined &&
                Date.now() - started + ra * 1000 + 20_000 <= TIME_BUDGET_MS
              ) {
                throttled++;
                send({ log: `WB 429, просит подождать ${ra} сек — жду и повторяю rrdid=${rrdid}` });
                await new Promise((r) => setTimeout(r, ra * 1000 + 2_000));
                continue;
              }
              send({
                log:
                  `WB 429 (${ra !== undefined ? `Retry-After ${ra} сек` : "без Retry-After"}) — ` +
                  "прекращаю прогон, чтобы не продлевать блокировку; остаток доберёт следующий запуск",
              });
              break;
            }
            throw e;
          }
          throttled = 0;
          pages++;
          send({
            log:
              `rrdid=${rrdid}: ${page.pageRowCount} строк, ` +
              `${page.fromCache ? "из кэша" : "скачано из WB и сохранено"}, done=${page.done}`,
          });
          if (page.done) {
            complete = true;
            break;
          }
          rrdid = page.lastRrdId;
          if (!page.fromCache) {
            send({ log: `пауза ${WB_WAIT_MS / 1000} сек (лимит WB)` });
            await new Promise((r) => setTimeout(r, WB_WAIT_MS));
          }
        }
      } catch (e) {
        send({
          log:
            "ошибка: " +
            (e instanceof WbReportError || e instanceof Error ? e.message : String(e)),
        });
      } finally {
        clearInterval(heartbeat);
        send({
          done: true,
          week,
          pages,
          complete,
          elapsedSec: Math.round((Date.now() - started) / 1000),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
