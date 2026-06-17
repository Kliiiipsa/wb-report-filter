import { ResultRow } from "@/lib/types";

interface PreviewTableProps {
  rows: ResultRow[];
  headers: string[];
  limit?: number;
}

/** Таблица предпросмотра первых N найденных строк. */
export function PreviewTable({ rows, headers, limit = 50 }: PreviewTableProps) {
  const preview = rows.slice(0, limit);

  if (preview.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Нет строк для предпросмотра.
      </p>
    );
  }

  function renderCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Показаны первые {preview.length} из{" "}
        {rows.length.toLocaleString("ru-RU")} найденных строк.
      </p>
      <div className="scroll-thin max-h-[480px] overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-brand-50">
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b border-brand-200 px-3 py-2 font-semibold text-brand-800"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr
                key={i}
                className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
              >
                {headers.map((h) => (
                  <td
                    key={h}
                    className="max-w-[280px] truncate whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-slate-700"
                    title={renderCell(row[h])}
                  >
                    {renderCell(row[h])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
