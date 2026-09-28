import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET /api/diag/wb?path=/ping[&host=statistics-api.wildberries.ru]
 *
 * Временный диагностический маршрут: локальная машина к WB не достучится,
 * поэтому проверяем доступность методов WB с сервера. Отдаёт только статус
 * и начало ответа; токен наружу не уходит.
 *
 * Защита: тот же Bearer CRON_SECRET, что и у подтяжки недели.
 * Разрешены только хосты *.wildberries.ru.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.WB_STATS_TOKEN;
  if (!token) return NextResponse.json({ error: "нет WB_STATS_TOKEN" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const host = searchParams.get("host") ?? "statistics-api.wildberries.ru";
  const path = searchParams.get("path") ?? "/ping";
  if (!/^[a-z0-9.-]+\.wildberries\.ru$/i.test(host)) {
    return NextResponse.json({ error: "хост не разрешён" }, { status: 400 });
  }

  const url = `https://${host}${path.startsWith("/") ? path : "/" + path}`;
  const max = Math.min(Number(searchParams.get("max") ?? 500) || 500, 400_000);
  // К документации (dev.wildberries.ru) ходим без токена — он там не нужен.
  const isDocs = /^dev\.wildberries\.ru$/i.test(host);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: isDocs ? {} : { Authorization: token },
      cache: "no-store",
    });
    const body = (await res.text()).slice(0, max);
    return NextResponse.json({
      url,
      status: res.status,
      ms: Date.now() - started,
      contentType: res.headers.get("content-type"),
      retryAfter: res.headers.get("retry-after"),
      body,
    });
  } catch (e) {
    return NextResponse.json(
      { url, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started },
      { status: 502 }
    );
  }
}
