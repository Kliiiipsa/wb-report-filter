/**
 * Коды товара: баркод WB (13 знаков, обычно «2…») и GTIN производителя
 * (14 знаков, «0…» — это EAN-13 с ведущим нулём).
 *
 * С конца августа 2026 WB в детальном отчёте по части товаров присылает GTIN
 * вместо прежнего баркода, поэтому сопоставление идёт по ОБОИМ кодам, а
 * в таблице-справочнике может быть несколько колонок с кодами.
 *
 * Ведущие нули отбрасываем: Google Sheets хранит «04603725364103» как число и
 * при выгрузке отдаёт «4603725364103». Без нормализации такой код не совпал бы
 * сам с собой.
 */

/** Приводит код к виду, в котором его можно сравнивать. Пустая строка — нет кода. */
export function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value).trim();
  if (!s) return "";
  // Апостроф-префикс из Excel/Sheets и любые пробелы внутри.
  s = s.replace(/^'/, "").replace(/\s+/g, "");
  // Экспоненциальная запись («2,04987E+12») — восстановить нельзя, отбрасываем.
  if (/e\+?\d+$/i.test(s)) return "";
  if (/^\d+$/.test(s)) {
    const trimmed = s.replace(/^0+/, "");
    return trimmed === "" ? "0" : trimmed;
  }
  return s.toLowerCase();
}

/** Набор кодов для быстрого сравнения (нормализованные значения). */
export function codeSet(values: Iterable<unknown>): Set<string> {
  const set = new Set<string>();
  for (const v of values) {
    const c = normalizeCode(v);
    if (c) set.add(c);
  }
  return set;
}
