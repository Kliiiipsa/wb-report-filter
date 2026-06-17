import { CheckCircle2, AlertCircle, Loader2, FileCheck } from "lucide-react";

type BadgeKind = "ready" | "error" | "loading" | "uploaded";

const MAP: Record<
  BadgeKind,
  { label: string; className: string; icon: React.ReactNode }
> = {
  ready: {
    label: "Готово",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  error: {
    label: "Ошибка",
    className: "bg-red-50 text-red-700 ring-red-200",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  },
  loading: {
    label: "Проверка",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  },
  uploaded: {
    label: "Файл загружен",
    className: "bg-brand-50 text-brand-700 ring-brand-200",
    icon: <FileCheck className="h-3.5 w-3.5" />,
  },
};

export function Badge({ kind, label }: { kind: BadgeKind; label?: string }) {
  const cfg = MAP[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.className}`}
    >
      {cfg.icon}
      {label ?? cfg.label}
    </span>
  );
}
