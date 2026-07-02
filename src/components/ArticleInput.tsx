"use client";

import { useRef, ChangeEvent } from "react";
import {
  Keyboard,
  FileUp,
  Sparkles,
  Sheet,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { ArticleSource, StatusKind } from "@/lib/types";
import {
  GOOGLE_SHEET_SOURCE_LABEL,
  googleSheetViewUrl,
} from "@/lib/googleSheet";

interface ArticleInputProps {
  source: ArticleSource;
  onSourceChange: (s: ArticleSource) => void;
  manualText: string;
  onManualTextChange: (t: string) => void;
  fileName: string | null;
  onFileSelected: (file: File) => void;
  demoCount: number;
  resolvedCount: number;
  // Google Sheets
  onLoadGoogle: () => void;
  googleStatus: StatusKind;
  googleError: string | null;
  googleCount: number;
  googleUsedFallback: boolean;
}

const TABS: { id: ArticleSource; label: string; icon: React.ReactNode }[] = [
  { id: "manual", label: "Вручную", icon: <Keyboard className="h-4 w-4" /> },
  { id: "file", label: "Из файла", icon: <FileUp className="h-4 w-4" /> },
  { id: "google", label: "Google Sheets", icon: <Sheet className="h-4 w-4" /> },
  { id: "demo", label: "Демо-список", icon: <Sparkles className="h-4 w-4" /> },
];

/** Ввод списка артикулов: вручную / из файла / демо (заглушка Google Sheets). */
export function ArticleInput({
  source,
  onSourceChange,
  manualText,
  onManualTextChange,
  fileName,
  onFileSelected,
  demoCount,
  resolvedCount,
  onLoadGoogle,
  googleStatus,
  googleError,
  googleCount,
  googleUsedFallback,
}: ArticleInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg bg-slate-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSourceChange(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              source === tab.id
                ? "bg-white text-brand-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {source === "manual" && (
        <div>
          <textarea
            value={manualText}
            onChange={(e) => onManualTextChange(e.target.value)}
            rows={6}
            placeholder={"Введите артикулы, по одному в строке:\n123456789\n987654321"}
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          />
          <p className="mt-1 text-xs text-slate-500">
            По одному артикулу в строке. Пробелы и дубли убираются автоматически.
          </p>
        </div>
      )}

      {source === "file" && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            <FileUp className="h-4 w-4" />
            Выбрать файл со списком
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,.txt"
            hidden
            onChange={handleFile}
          />
          <p className="mt-2 text-xs text-slate-500">
            Поддерживаются .xlsx, .csv, .txt. Берется первый столбец / строки файла.
          </p>
          {fileName && (
            <p className="mt-2 text-sm text-slate-700">
              Файл: <span className="font-medium">{fileName}</span>
            </p>
          )}
        </div>
      )}

      {source === "google" && (
        <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
          <p className="text-sm font-medium text-brand-800">
            {GOOGLE_SHEET_SOURCE_LABEL}
          </p>

          <a
            href={googleSheetViewUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 underline underline-offset-2 transition hover:text-brand-700"
          >
            <ExternalLink className="h-4 w-4" />
            Открыть таблицу Google Sheets
          </a>

          <button
            type="button"
            onClick={onLoadGoogle}
            disabled={googleStatus === "loading"}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${googleStatus === "loading" ? "animate-spin" : ""}`}
            />
            {googleStatus === "loading"
              ? "Загрузка…"
              : googleStatus === "ready"
                ? "Обновить из Google Sheets"
                : "Загрузить из Google Sheets"}
          </button>

          {googleStatus === "ready" && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Артикулы загружены из Google Sheets.
                <br />
                Получено:{" "}
                <span className="font-semibold">
                  {googleCount.toLocaleString("ru-RU")}
                </span>{" "}
                уникальных артикулов.
                {googleUsedFallback && (
                  <span className="mt-1 block text-xs text-emerald-600/80">
                    Заголовок «Артикул WB» не найден — использована колонка D.
                  </span>
                )}
              </span>
            </div>
          )}

          {googleStatus === "error" && googleError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{googleError}</span>
            </div>
          )}
        </div>
      )}

      {source === "demo" && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-4 text-sm text-brand-800">
          <p className="font-medium">Используется демо-список ({demoCount} шт.)</p>
          <p className="mt-1 text-brand-700/80">
            Заглушка вместо Google Sheets. Позже здесь будет загрузка артикулов
            из листа «Worksheet», колонка D.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Распознано артикулов:{" "}
        <span className="font-semibold text-slate-700">{resolvedCount}</span>
      </p>
    </div>
  );
}
