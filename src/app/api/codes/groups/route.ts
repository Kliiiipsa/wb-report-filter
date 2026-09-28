import { NextResponse } from "next/server";
import { getCardCodeGroups } from "@/lib/wbCache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/codes/groups
 *
 * Группы кодов одного товара из карточек WB: [["2049…", "04603…"], …].
 * Нужны разбору загруженного файла отчёта, чтобы строка находилась и по
 * прежнему баркоду, и по GTIN — так же, как это делает выдача по API.
 * Данные обновляет /api/cron/refresh-codes.
 */
export async function GET() {
  const groups = (await getCardCodeGroups()) ?? [];
  // Отдаём только группы, где кодов действительно несколько.
  const useful = groups.filter((g) => Array.isArray(g) && g.length > 1 && g.length <= 4);
  return NextResponse.json({ groups: useful, count: useful.length });
}
