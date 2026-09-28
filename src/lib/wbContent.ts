/**
 * Выгрузка кодов товара из карточек WB (API «Контент»).
 *
 * Зачем: WB переводит товары со своего баркода на GTIN производителя, и пока
 * новый код не попал в справочник продавца, строки отчёта по нему теряются.
 * В карточке у каждого размера перечислены ВСЕ коды сразу (поле skus), поэтому
 * отсюда связь берётся полностью — включая товары, которые ещё не продавались.
 *
 * Нужен токен с категорией «Контент» (переменная WB_CONTENT_TOKEN).
 */

export const WB_CONTENT_HOST = "https://content-api.wildberries.ru";

export interface CardSize {
  nmId: number;
  vendorCode: string;
  techSize: string;
  /** Все коды этого размера: прежний баркод WB и/или GTIN. */
  skus: string[];
}

export class WbContentError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WbContentError";
    this.status = status;
  }
}

interface Cursor {
  updatedAt?: string;
  nmID?: number;
}

/** Одна страница списка карточек. */
async function cardsPage(
  token: string,
  limit: number,
  cursor: Cursor
): Promise<{ cards: unknown[]; next: Cursor; total: number }> {
  let res: Response;
  try {
    res = await fetch(`${WB_CONTENT_HOST}/content/v2/get/cards/list`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { cursor: { limit, ...cursor }, filter: { withPhoto: -1 } },
      }),
      cache: "no-store",
    });
  } catch {
    throw new WbContentError("Не удалось подключиться к WB (API карточек).");
  }
  if (res.status === 401 || res.status === 403) {
    throw new WbContentError(
      `WB отклонил токен (${res.status}). Для карточек нужен токен с категорией «Контент».`,
      res.status
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new WbContentError(`WB API карточек вернул статус ${res.status}.${text ? ` ${text}` : ""}`, res.status);
  }
  const data = (await res.json().catch(() => null)) as {
    cards?: unknown[];
    cursor?: { updatedAt?: string; nmID?: number; total?: number };
  } | null;
  return {
    cards: data?.cards ?? [],
    next: { updatedAt: data?.cursor?.updatedAt, nmID: data?.cursor?.nmID },
    total: Number(data?.cursor?.total ?? 0),
  };
}

/** Все размеры всех карточек продавца с их кодами. */
export async function fetchAllCardSizes(token: string, limit = 100): Promise<CardSize[]> {
  const out: CardSize[] = [];
  let cursor: Cursor = {};
  for (let guard = 0; guard < 200; guard++) {
    const { cards, next, total } = await cardsPage(token, limit, cursor);
    for (const c of cards) {
      const card = c as {
        nmID?: number;
        vendorCode?: string;
        sizes?: { techSize?: string; skus?: string[] }[];
      };
      for (const s of card.sizes ?? []) {
        const skus = (s.skus ?? []).map((x) => String(x).trim()).filter(Boolean);
        if (!skus.length) continue;
        out.push({
          nmId: Number(card.nmID ?? 0),
          vendorCode: String(card.vendorCode ?? ""),
          techSize: String(s.techSize ?? ""),
          skus,
        });
      }
    }
    if (cards.length === 0 || total < limit) break;
    cursor = next;
  }
  return out;
}
