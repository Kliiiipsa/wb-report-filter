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
  CalendarRange,
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
  ReportRow,
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
import {
  WB_COLUMNS,
  WB_COMPACT_COLUMNS,
  WB_BARCODE_COLUMN,
  wbArrayToRow,
} from "@/lib/wbColumns";

type ReportSource = "file" | "miyoumi" | "wb-api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Пауза между запросами к WB. Формально лимит — 1 запрос/мин, но на практике
 * после тяжёлой страницы (100k строк) WB отдаёт 429 и через 65 сек, поэтому
 * берём запас и увеличиваем паузу при повторных отказах.
 */
const WB_WAIT_BASE_MS = 75000;
const wbWaitMs = (retries: number) =>
  Math.min(WB_WAIT_BASE_MS + retries * 15000, 150000);

export default function Home() {
  // --- Отчеты ---
  const [reportSource, setReportSource] = useState<ReportSource>("file");
  const [files, setFiles] = useState<File[]>([]);

  // --- Кабинет Miyoumi (TrueStats) ---
  const [miyoumiReport, setMiyoumiReport] = useState<ParsedReport | null>(null);
  const [miyoumiStatus, setMiyoumiStatus] = useState<StatusKind>("idle");
  const [miyoumiError, setMiyoumiError] = useState<string | null>(null);
  // Период: пустые строки = весь период.
  const [miyoumiFrom, setMiyoumiFrom] = useState("");
  const [miyoumiTo, setMiyoumiTo] = useState("");

  // Сброс загруженного отчёта при смене периода (чтобы данные не устаревали).
  function updateMiyoumiPeriod(from: string, to: string) {
    setMiyoumiFrom(from);
    setMiyoumiTo(to);
    setMiyoumiReport(null);
    setMiyoumiStatus("idle");
    setMiyoumiError(null);
  }
  function setMiyoumiPreset(days: number | null) {
    if (days === null) {
      updateMiyoumiPeriod("", "");
      return;
    }
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    updateMiyoumiPeriod(
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10)
    );
  }

  // --- Кабинет WB (по API, детальный отчёт) ---
  const [wbFrom, setWbFrom] = useState("");
  const [wbTo, setWbTo] = useState("");
  const [wbProgress, setWbProgress] = useState("");
  // true = только нужные колонки (легче файл), false = все колонки WB-отчёта
  const [wbCompact, setWbCompact] = useState(true);
  function setWbWeek(offsetWeeks: number) {
    // offsetWeeks: 0 = последние 7 дней, 1 = предыдущая неделя
    const to = new Date();
    to.setDate(to.getDate() - offsetWeeks * 7);
    const from = new Date(to);
    from.setDate(from.getDate() - 6);
    setWbFrom(from.toISOString().slice(0, 10));
    setWbTo(to.toISOString().slice(0, 10));
  }

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
      const params = new URLSearchParams();
      if (miyoumiFrom) params.set("dateFrom", miyoumiFrom);
      if (miyoumiTo) params.set("dateTo", miyoumiTo);
      const qs = params.toString();
      const res = await fetch(
        `/api/report/miyoumi${qs ? "?" + qs : ""}`,
        { cache: "no-store" }
      );
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

  async function processWbApi() {
    if (resolvedArticles.length === 0) {
      setError("Сначала укажите баркоды в блоке 2 (например, из Google Sheets).");
      return;
    }
    if (!wbFrom || !wbTo) {
      setError("Выберите неделю (даты «с» и «по»).");
      return;
    }
    setError(null);
    setResult(null);
    setStatus("loading");
    setWbProgress(
      "Запрашиваю WB… Неделя обычно = 2 страницы по 100 000 строк; между ними " +
        "обязательная пауза 60 сек (лимит WB). Обычно занимает 2–3 минуты."
    );
    try {
      const matched: ReportRow[] = [];
      const barcodeSet = new Set<string>();
      let columns: string[] = wbCompact ? WB_COMPACT_COLUMNS : WB_COLUMNS;
      let rrdid = 0;
      let done = false;
      let totalRows = 0;
      let page = 0;
      let retries = 0;
      while (!done) {
        page++;
        setWbProgress(`Страница ${page}: запрашиваю WB (до ~1–2 мин на страницу)…`);
        let res: Response;
        try {
          res = await fetch("/api/report/wb", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dateFrom: wbFrom,
              dateTo: wbTo,
              rrdid,
              barcodes: resolvedArticles,
              compact: wbCompact,
            }),
          });
        } catch {
          // Обрыв сети / таймаут — повторяем ту же страницу после паузы.
          if (++retries > 3) throw new Error("Не удалось связаться с сервером. Попробуйте позже.");
          const w = wbWaitMs(retries);
          setWbProgress(
            `Сбой соединения, повторяю страницу ${page} через ${Math.round(w / 1000)} сек…`
          );
          await sleep(w);
          page--;
          continue;
        }
        const data = await res.json().catch(() => null);
        // 429 — лимит WB; 504 — WB отдаёт страницу дольше лимита функции;
        // 502 — WB оборвал/отклонил соединение (бывает, когда слот WB занят
        // другим запросом, например фоновой подтяжкой). Всё это временно —
        // повторяем ту же страницу после паузы, а не роняем весь процесс.
        if (res.status === 429 || res.status === 504 || res.status === 502) {
          if (++retries > 5) throw new Error("WB не отвечает / держит лимит слишком долго. Попробуйте позже.");
          const w = wbWaitMs(retries);
          const why =
            res.status === 429
              ? `Лимит WB — жду ${Math.round(w / 1000)} сек и повторяю страницу ${page}`
              : res.status === 504
                ? `WB отдаёт страницу слишком долго — повторяю страницу ${page} через ${Math.round(w / 1000)} сек`
                : `Соединение с WB оборвалось (возможно, слот занят) — повторяю страницу ${page} через ${Math.round(w / 1000)} сек`;
          setWbProgress(why + "… (это нормально, не закрывайте вкладку)");
          await sleep(w);
          page--;
          continue;
        }
        if (!res.ok) throw new Error(data?.error ?? "Ошибка WB API.");
        retries = 0;
        if (Array.isArray(data.columns) && data.columns.length) columns = data.columns;
        for (const a of data.matched ?? []) matched.push(wbArrayToRow(a, columns));
        totalRows += data.pageRowCount ?? 0;
        for (const b of data.pageBarcodes ?? []) barcodeSet.add(b);
        rrdid = data.lastRrdId ?? rrdid;
        done = !!data.done;
        const fromCache = !!data.fromCache;
        setWbProgress(
          `Страница ${page} ${fromCache ? "из кэша" : "получена от WB"}: ` +
            `строк в отчёте ${totalRows.toLocaleString("ru-RU")}, ` +
            `совпадений ${matched.length.toLocaleString("ru-RU")}` +
            (done
              ? " · собираю результат…"
              : fromCache
                ? " · следующая страница…"
                : ` · пауза ${WB_WAIT_BASE_MS / 1000} сек (лимит WB), затем следующая страница…`)
        );
        // Пауза нужна только если мы реально ходили в WB: страницы из кэша лимит не тратят.
        if (!done && !fromCache) await sleep(WB_WAIT_BASE_MS);
      }

      const parsed: ParsedReport = {
        fileName: `WB API · ${wbFrom}…${wbTo}`,
        sheetName: "WB отчёт",
        rows: matched,
        headers: columns,
        barcodeColumn: WB_BARCODE_COLUMN,
      };
      const processed = processReports([parsed], resolvedArticles);
      // Патчим агрегаты по данным сервера (всего строк / уникальных баркодов в отчёте).
      processed.stats.totalRowsInReports = totalRows;
      processed.stats.uniqueArticlesInReports = barcodeSet.size;

      setWbProgress("");
      if (processed.stats.matchedRowsCount === 0) {
        setStatus("error");
        setError("Совпадений не найдено: ни один баркод из списка не встретился за выбранную неделю.");
        setResult(processed);
        return;
      }
      setResult(processed);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setWbProgress("");
      setError(e instanceof Error ? e.message : "Ошибка WB API.");
    }
  }

  async function handleProcess() {
    if (reportSource === "wb-api") {
      await processWbApi();
      return;
    }
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
    reportSource === "file"
      ? files.length > 0
      : reportSource === "miyoumi"
        ? miyoumiReport !== null
        : !!wbFrom && !!wbTo; // wb-api
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
            {reportSource === "wb-api" && wbFrom && wbTo && (
              <Badge kind="uploaded" label="Неделя выбрана" />
            )}
          </div>

          {/* Выбор источника */}
          <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: "file", label: "Файл WB", icon: <Upload className="h-4 w-4" /> },
                { id: "wb-api", label: "WB (по API)", icon: <CalendarRange className="h-4 w-4" /> },
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

          {reportSource === "wb-api" && (
            <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
              <p className="text-sm text-brand-800">
                Настоящий детальный WB-отчёт по API — со всеми колонками (Тип
                документа, Обоснование для оплаты и т.д.). Из-за лимитов WB
                тянется <span className="font-semibold">по одной неделе</span>.
              </p>
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Сначала укажите баркоды в блоке 2 (фильтр применяется при
                  загрузке). Затем выберите неделю и нажмите «Проверить данные».
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "Последняя неделя", off: 0 },
                  { label: "Прошлая неделя", off: 1 },
                ].map((pr) => (
                  <button
                    key={pr.label}
                    type="button"
                    onClick={() => setWbWeek(pr.off)}
                    className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-50"
                  >
                    {pr.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-brand-800">
                  С
                  <input
                    type="date"
                    value={wbFrom}
                    max={wbTo || undefined}
                    onChange={(e) => setWbFrom(e.target.value)}
                    className="mt-1 block rounded-md border border-brand-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                  />
                </label>
                <label className="text-xs text-brand-800">
                  По
                  <input
                    type="date"
                    value={wbTo}
                    min={wbFrom || undefined}
                    onChange={(e) => setWbTo(e.target.value)}
                    className="mt-1 block rounded-md border border-brand-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                  />
                </label>
                <span className="pb-1 text-xs text-brand-700/70">
                  {wbFrom && wbTo ? `Неделя: ${wbFrom} … ${wbTo}` : "Период не выбран"}
                </span>
              </div>

              <label className="flex items-start gap-2 rounded-md border border-brand-200 bg-white px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={wbCompact}
                  onChange={(e) => setWbCompact(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                />
                <span>
                  Только нужные колонки{" "}
                  <span className="text-slate-500">
                    ({WB_COMPACT_COLUMNS.length} вместо {WB_COLUMNS.length}) — файл
                    заметно легче. Снимите галочку, если нужны все колонки
                    WB-отчёта.
                  </span>
                </span>
              </label>

              {wbProgress && (
                <div className="flex items-start gap-2 rounded-md border border-brand-200 bg-white px-3 py-2 text-sm text-brand-700">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                  <span>{wbProgress}</span>
                </div>
              )}
            </div>
          )}

          {reportSource === "miyoumi" && (
            <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
              <p className="text-sm text-brand-800">
                Отчёт кабинета <span className="font-semibold">Miyoumi</span>{" "}
                собирается напрямую из TrueStats за выбранный период. Загрузка
                Excel не нужна.
              </p>

              {/* Пресеты периода */}
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { label: "Весь период", days: null },
                    { label: "Последняя неделя", days: 7 },
                    { label: "Последний месяц", days: 30 },
                  ] as { label: string; days: number | null }[]
                ).map((pr) => {
                  const active =
                    pr.days === null
                      ? !miyoumiFrom && !miyoumiTo
                      : false;
                  return (
                    <button
                      key={pr.label}
                      type="button"
                      onClick={() => setMiyoumiPreset(pr.days)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                        active
                          ? "bg-brand-600 text-white ring-brand-600"
                          : "bg-white text-brand-700 ring-brand-200 hover:bg-brand-50"
                      }`}
                    >
                      {pr.label}
                    </button>
                  );
                })}
              </div>

              {/* Поля дат */}
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-brand-800">
                  С
                  <input
                    type="date"
                    value={miyoumiFrom}
                    max={miyoumiTo || undefined}
                    onChange={(e) => updateMiyoumiPeriod(e.target.value, miyoumiTo)}
                    className="mt-1 block rounded-md border border-brand-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                  />
                </label>
                <label className="text-xs text-brand-800">
                  По
                  <input
                    type="date"
                    value={miyoumiTo}
                    min={miyoumiFrom || undefined}
                    onChange={(e) => updateMiyoumiPeriod(miyoumiFrom, e.target.value)}
                    className="mt-1 block rounded-md border border-brand-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                  />
                </label>
                <span className="pb-1 text-xs text-brand-700/70">
                  {miyoumiFrom || miyoumiTo
                    ? `Период: ${miyoumiFrom || "начало"} … ${miyoumiTo || "сегодня"}`
                    : "Период: весь"}
                </span>
              </div>

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
                    строк по баркодам
                    {miyoumiFrom || miyoumiTo
                      ? ` за ${miyoumiFrom || "начало"} … ${miyoumiTo || "сегодня"}`
                      : " за весь период"}
                    .
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
