import {
  getCachedPage,
  getCachedAliases,
  putCachedAliases,
  getCardCodeGroups,
  type PageCursor,
} from "@/lib/wbCache";
import { normalizeCode } from "@/lib/codes";

/**
 * Связка «прежний баркод ↔ новый код WB» внутри одной недели.
 *
 * С конца августа 2026 WB по части товаров присылает GTIN производителя
 * (14 знаков, ведущий ноль) вместо баркода WB. В справочнике продавца новый код
 * появляется не сразу, и такие строки выпадали из отчёта — к концу сентября это
 * уже около 40% строк.
 *
 * Чтобы отчёт не зависел от ручной правки справочника, связь восстанавливаем по
 * самим данным WB: у одного товара (артикул + размер) в неделе встречаются
 * строки и со старым кодом, и с новым. Карта строится один раз на неделю по
 * страницам, которые уже лежат в кэше, и сохраняется рядом с ними.
 */

interface Pair {
  old: Set<string>;
  neu: Set<string>;
}

const isNewCode = (code: string) => code.length === 14 && code.startsWith("0");

/**
 * Карта: нормализованный код → все коды того же товара (включая его самого).
 * Возвращает пустую карту, если неделя ещё не скачана.
 */
export async function weekCodeAliases(
  dateFrom: string,
  dateTo: string
): Promise<Map<string, string[]>> {
  // Сколько страниц недели сейчас в кэше — это и подпись карты: докачали
  // страницу, значит карту надо собрать заново.
  const pages: { fields: string[]; rows: unknown[][] }[] = [];
  let cursor: PageCursor = 0;
  for (let guard = 0; guard < 60; guard++) {
    const page = await getCachedPage(dateFrom, dateTo, cursor);
    if (!page) break;
    pages.push({ fields: page.fields, rows: page.rows });
    if (page.done) break;
    if (page.lastRrdId === cursor) break;
    cursor = page.lastRrdId;
  }
  if (pages.length === 0) return new Map();

  const cached = await getCachedAliases(dateFrom, dateTo, pages.length);
  if (cached) return new Map(Object.entries(cached).map(([k, v]) => [k, v as string[]]));

  const byProduct = new Map<string, Pair>();
  for (const page of pages) {
    const iCode = page.fields.indexOf("barcode");
    const iNm = page.fields.indexOf("nm_id");
    const iSize = page.fields.indexOf("ts_name");
    if (iCode < 0 || iNm < 0) continue;
    for (const row of page.rows) {
      const raw = String(row[iCode] ?? "").trim();
      if (!raw) continue;
      const key = `${row[iNm] ?? ""}|${String(row[iSize] ?? "").trim()}`;
      let p = byProduct.get(key);
      if (!p) {
        p = { old: new Set(), neu: new Set() };
        byProduct.set(key, p);
      }
      (isNewCode(raw) ? p.neu : p.old).add(normalizeCode(raw));
    }
  }

  const aliases = new Map<string, string[]>();
  for (const { old, neu } of byProduct.values()) {
    if (!neu.size || !old.size) continue;
    const all = [...old, ...neu];
    for (const c of all) {
      const known = aliases.get(c);
      if (known) aliases.set(c, [...new Set([...known, ...all])]);
      else aliases.set(c, all);
    }
  }

  try {
    await putCachedAliases(dateFrom, dateTo, pages.length, Object.fromEntries(aliases));
  } catch {
    /* кэш — best effort */
  }
  return aliases;
}

/**
 * Коды из карточек WB: у размера перечислены сразу все его коды.
 * Источник полнее недельного (охватывает и товары без продаж), но требует
 * токена с категорией «Контент» и обновляется отдельной задачей.
 */
export async function cardCodeAliases(): Promise<Map<string, string[]>> {
  const groups = await getCardCodeGroups();
  const aliases = new Map<string, string[]>();
  if (!groups) return aliases;
  for (const group of groups) {
    const codes = [...new Set(group.map((c) => normalizeCode(c)).filter(Boolean))];
    if (codes.length < 2) continue;
    for (const c of codes) {
      const known = aliases.get(c);
      aliases.set(c, known ? [...new Set([...known, ...codes])] : codes);
    }
  }
  return aliases;
}

/** Объединяет несколько карт соответствий в одну. */
export function mergeAliases(...maps: Map<string, string[]>[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of maps) {
    for (const [k, v] of m) {
      const known = out.get(k);
      out.set(k, known ? [...new Set([...known, ...v])] : v);
    }
  }
  return out;
}

/**
 * Дополняет карту «код → код из справочника» двойниками из этой недели.
 * Возвращает добавленные пары, чтобы клиент знал, какой строке какой код
 * справочника соответствует (иначе он отфильтрует такие строки обратно).
 */
export function expandWanted(
  want: Map<string, string>,
  aliases: Map<string, string[]>
): { want: Map<string, string>; added: [string, string][] } {
  if (aliases.size === 0) return { want, added: [] };
  const added: [string, string][] = [];
  for (const [code, article] of [...want]) {
    const twins = aliases.get(code);
    if (!twins) continue;
    for (const t of twins) {
      if (want.has(t)) continue;
      want.set(t, article);
      added.push([t, article]);
    }
  }
  return { want, added };
}
