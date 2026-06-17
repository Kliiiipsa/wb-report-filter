import {
  FileSpreadsheet,
  Rows3,
  Fingerprint,
  ListChecks,
  CheckCircle2,
  SearchX,
} from "lucide-react";
import { ProcessingStats } from "@/lib/types";

interface StatsCardsProps {
  stats: ProcessingStats;
}

/** Карточки со статистикой обработки. */
export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      label: "Загружено отчетов",
      value: stats.reportsCount,
      icon: <FileSpreadsheet className="h-5 w-5" />,
      accent: "text-brand-600 bg-brand-50",
    },
    {
      label: "Строк в отчетах",
      value: stats.totalRowsInReports,
      icon: <Rows3 className="h-5 w-5" />,
      accent: "text-slate-600 bg-slate-100",
    },
    {
      label: "Уникальных артикулов в отчетах",
      value: stats.uniqueArticlesInReports,
      icon: <Fingerprint className="h-5 w-5" />,
      accent: "text-indigo-600 bg-indigo-50",
    },
    {
      label: "Артикулов указано",
      value: stats.userArticlesCount,
      icon: <ListChecks className="h-5 w-5" />,
      accent: "text-sky-600 bg-sky-50",
    },
    {
      label: "Найдено совпадений (строк)",
      value: stats.matchedRowsCount,
      icon: <CheckCircle2 className="h-5 w-5" />,
      accent: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Артикулов не найдено",
      value: stats.notFoundArticlesCount,
      icon: <SearchX className="h-5 w-5" />,
      accent: "text-red-600 bg-red-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-soft"
        >
          <div className={`rounded-lg p-2 ${c.accent}`}>{c.icon}</div>
          <div className="min-w-0">
            <p className="text-2xl font-semibold text-slate-900">
              {c.value.toLocaleString("ru-RU")}
            </p>
            <p className="truncate text-xs text-slate-500">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
