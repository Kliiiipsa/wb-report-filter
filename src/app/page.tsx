"use client";

import { useMemo, useState } from "react";
import {
  Download,
  PlayCircle,
  AlertTriangle,
  Info,
  Upload,
  Store,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { FileDropzone } from "@/components/FileDropzone";
import { ArticleInput } from "@/components/ArticleInput";
import { StatsCards } from "@/components/StatsCards";
import { PreviewTable } from "@/components/PreviewTable";
import { Badge } from "@/components/Badge";
import {
  ArticleSource,
  ParsedReport,
  ProcessingResult,
  StatusKind,
} from "@/lib/types";
import { parseReportFile, ReportParseError } from "@/lib/excel/parseReports";
import {
  cleanArticleList,
  DEMO_ARTICLES,
  fetchArticlesFromGoogleSheets,
  parseArticlesFromFile,
  parseArticlesFromText,
} from "@/lib/excel/parseArticles";
import { processReports } from "@/lib/excel/processReports";
import { exportResultToExcel } from "@/lib/excel/exportResult";

type ReportSource = "file" | "miyoumi";

export default function Home() {
  // --- Отчеты ---
  const [reportSource, setReportSource] = useState<ReportSource>("file");
  const [files, setFiles] = useState<File[]>([]);

  // --- Кабинет Miyoumi (TrueStats) ---
  const [miyoumiReport, setMiyoumiReport] = useState<ParsedReport | null>(null);
  const [miyoumiStatus, setMiyoumiStatus] = useState<StatusKind>("idle");
  const [miyoumiError, setMiyoumiError] = useState<string | null>(null);

  // --- Артикулы ---
  const [source, setSource] = useState<ArticleSource>("manual");
  const [manualText, setManualText] = useState("");
  const [articleFile, setArticleFile] = useState<File | null>(null);
  const [articleFileList, setArticleFileList] = useState<string[]>([]);

  // --- Google Sheets ---
  const [googleArticles, setGoogleArticles] = useState<string[]>([]);
  const [googleStatus, setGoogleStatus] = useState<StatusKind>("idle");
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleUsedFallback, setGoogleUsedFallback] = useState(false);

  // --- Состояние обработки ---
  const [status, setStatus] = useState<StatusKind>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);

  // Текущий список артикулов в зависимости от выбранного режима.
  const resolvedArticles = useMemo<string[]>(() => {
    if (source === "manual") return parseArticlesFromText(manualText);
    if (source === "demo") return cleanArticleList(DEMO_ARTICLES);
    if (source === "google") return googleArticles;
    return articleFileList;
  }, [source, manualText, articleFileList, googleArticles]);

  async function handleLoadGoogle() {
    setGoogleError(null);
    setGoogleStatus("loading");
    try {
      const data = await fetchArticlesFromGoogleSheets();
      setGoogleArticles(data.articles);
      setGoogleUsedFallback(data.usedFallback);
      setGoogleStatus("ready");
    } catch (e) {
      setGoogleArticles([]);
      setGoogleStatus("error");
      setGoogleError(
        e instanceof Error
          ? e.message
          : "Не удалось загрузить баркоды из Google Sheets."
      );
    }
  }

  async function handleArticleFile(file: File) {
    setError(null);
    setArticleFile(file);
    try {
      const list = await parseArticlesFromFile(file);
      setArticleFileList(list);
    } catch (e) {
      setArticleFileList([]);
      setError(
        e instanceof ReportParseError
          ? e.message
          : "Не удалось прочитать файл со списком баркодов."
      );
    }
  }

  async function handleLoadMiyoumi() {
    setMiyoumiError(null);
    setMiyoumiStatus("loading");
    try {
      const res = await fetch("/api/report/miyoumi", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Не удалось загрузить отчёт Miyoumi.");
      }
      const report: ParsedReport = {
        fileName: "TrueStats · Miyoumi",
        sheetName: data.sheetName,
        rows: data.rows,
        headers: data.headers,
        barcodeColumn: "Баркод",
      };
      setMiyoumiReport(report);
      setMiyoumiStatus("ready");
    } catch (e) {
      setMiyoumiReport(null);
      setMiyoumiStatus("error");
      setMiyoumiError(
        e instanceof Error ? e.message : "Не удалось загрузить отчёт Miyoumi."
      );
    }
  }

  async function handleProcess() {
    setError(null);
    setResult(null);

    const hasFileReports = reportSource === "file" && files.length > 0;
    const hasMiyoumi = reportSource === "miyoumi" && miyoumiReport !== null;

    // Валидация ввода.
    if (!hasFileReports && !hasMiyoumi) {
      setError(
        reportSource === "miyoumi"
          ? "Отчёт Miyoumi не загружен. Нажмите «Загрузить отчёт Miyoumi»."
          : "Не выбран ни один отчет. Загрузите хотя бы один файл .xlsx."
      );
      return;
    }
    if (resolvedArticles.length === 0) {
      setError(
        "Список баркодов пуст. Введите баркоды, загрузите файл или выберите демо-список."
      );
      return;
    }

    setStatus("loading");
    try {
      const reports: ParsedReport[] = [];
      if (reportSource === "file") {
        for (const file of files) {
          reports.push(await parseReportFile(file));
        }
      } else if (miyoumiReport) {
        reports.push(miyoumiReport);
      }

      const processed = processReports(reports, resolvedArticles);

      if (processed.stats.matchedRowsCount === 0) {
        setStatus("error");
        setError(
          "Совпадений не найдено: ни один баркод из списка не встретился в отчетах."
        );
        setResult(processed); // показываем статистику даже при 0 совпадений
        return;
      }

      setResult(processed);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(
        e instanceof ReportParseError
          ? e.message
          : "Ошибка чтения Excel. Проверьте формат файлов и попробуйте снова."
      );
    }
  }

  function handleDownload() {
    if (result) exportResultToExcel(result);
  }

  const hasReport =
    reportSource === "file" ? files.length > 0 : miyoumiReport !== null;
  const canProcess = hasReport && resolvedArticles.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Шапка */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Фильтр отчетов Wildberries
        </h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Загрузите отчет WB и список баркодов, чтобы получить отфильтрованный
          Excel-файл.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Блок 1 — отчеты */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              1. Источник отчёта
            </h2>
            {reportSource === "file" && files.length > 0 && (
              <Badge kind="uploaded" label={`Файлов: ${files.length}`} />
            )}
            {reportSource === "miyoumi" && miyoumiReport && (
              <Badge kind="uploaded" label="Miyoumi загружен" />
            )}
          </div>

          {/* Выбор источника */}
          <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: "file", label: "Файл WB", icon: <Upload className="h-4 w-4" /> },
                { id: "miyoumi", label: "Miyoumi (TrueStats)", icon: <Store className="h-4 w-4" /> },
              ] as { id: ReportSource; label: string; icon: React.ReactNode }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setReportSource(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  reportSource === tab.id
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {reportSource === "file" && (
            <FileDropzone files={files} onChange={setFiles} />
          )}

          {reportSource === "miyoumi" && (
            <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
              <p className="text-sm text-brand-800">
                Отчёт кабинета <span className="font-semibold">Miyoumi</span>{" "}
                собирается напрямую из TrueStats за весь период. Загрузка Excel не
                нужна.
              </p>
              <button
                type="button"
                onClick={handleLoadMiyoumi}
                disabled={miyoumiStatus === "loading"}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${miyoumiStatus === "loading" ? "animate-spin" : ""}`}
                />
                {miyoumiStatus === "loading"
                  ? "Собираю отчёт… (до ~15 сек)"
                  : miyoumiStatus === "ready"
                    ? "Обновить отчёт Miyoumi"
                    : "Загрузить отчёт Miyoumi"}
              </button>

              {miyoumiStatus === "ready" && miyoumiReport && (
                <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Отчёт Miyoumi загружен:{" "}
                    <span className="font-semibold">
                      {miyoumiReport.rows.length.toLocaleString("ru-RU")}
                    </span>{" "}
                    строк по баркодам.
                  </span>
                </div>
              )}

              {miyoumiStatus === "error" && miyoumiError && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{miyoumiError}</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Блок 2 — баркоды */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            2. Список баркодов
          </h2>
          <ArticleInput
            source={source}
            onSourceChange={setSource}
            manualText={manualText}
            onManualTextChange={setManualText}
            fileName={articleFile?.name ?? null}
            onFileSelected={handleArticleFile}
            demoCount={DEMO_ARTICLES.length}
            resolvedCount={resolvedArticles.length}
            onLoadGoogle={handleLoadGoogle}
            googleStatus={googleStatus}
            googleError={googleError}
            googleCount={googleArticles.length}
            googleUsedFallback={googleUsedFallback}
          />
        </section>
      </div>

      {/* Действие */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleProcess}
          disabled={!canProcess || status === "loading"}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlayCircle className="h-4 w-4" />
          {status === "loading" ? "Проверка…" : "Проверить данные"}
        </button>

        {status === "loading" && <Badge kind="loading" />}
        {status === "ready" && <Badge kind="ready" />}
        {status === "error" && <Badge kind="error" />}
      </div>

      {/* Ошибка */}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Результаты */}
      {result && (
        <div className="mt-8 space-y-6">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Статистика обработки
            </h2>
            <StatsCards stats={result.stats} />
          </section>

          {result.exceedsExcelLimit && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Найденных строк больше лимита одного листа Excel — при экспорте
                результат будет автоматически разбит на несколько листов.
              </span>
            </div>
          )}

          {result.stats.matchedRowsCount > 0 && (
            <>
              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Предпросмотр найденных строк
                  </h2>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    <Download className="h-4 w-4" />
                    Скачать результат Excel
                  </button>
                </div>
                <PreviewTable
                  rows={result.rows}
                  headers={result.headers}
                  limit={50}
                />
              </section>
            </>
          )}
        </div>
      )}

      {/* Подвал */}
      <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-400">
        Файлы обрабатываются локально в браузере и не сохраняются на сервере.
        Список баркодов берётся из Google Sheets (лист «Асортимент для Миюми»,
        колонка «Баркод»).
      </footer>
    </main>
  );
}
