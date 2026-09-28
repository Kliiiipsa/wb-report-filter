import { NextResponse } from "next/server";
import { fetchAllCardSizes, WbContentError } from "@/lib/wbContent";
import { putCardCodeGroups } from "@/lib/wbCache";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

/**
 * GET /api/cron/refresh-codes
 *
 * Перечитывает коды товара из карточек WB и складывает их рядом с кэшем недель.
 * Дальше выдача отчёта сопоставляет строки по любому коду одного товара —
 * и по прежнему баркоду WB, и по GTIN производителя.
 *
 * Защита: Bearer CRON_SECRET. Токен — WB_CONTENT_TOKEN (категория «Контент»),
 * если он не задан, берём обычный WB_STATS_TOKEN.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.WB_CONTENT_TOKEN || process.env.WB_STATS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "не задан WB_CONTENT_TOKEN" }, { status: 500 });
  }

  try {
    const sizes = await fetchAllCardSizes(token);
    const groups = sizes.map((s) => s.skus).filter((s) => s.length > 1);
    const withNewCode = sizes.filter((s) =>
      s.skus.some((c) => c.length === 14 && c.startsWith("0"))
    ).length;
    await putCardCodeGroups(sizes.map((s) => s.skus));
    return NextResponse.json({
      ok: true,
      sizes: sizes.length,
      codes: sizes.reduce((a, s) => a + s.skus.length, 0),
      multiCodeSizes: groups.length,
      sizesWithGtin: withNewCode,
    });
  } catch (e) {
    if (e instanceof WbContentError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 502 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось прочитать карточки WB." },
      { status: 502 }
    );
  }
}
