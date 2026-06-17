"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";
import { UploadCloud, FileSpreadsheet, X } from "lucide-react";

interface FileDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
}

/** Drag & drop зона для загрузки одного или нескольких .xlsx отчетов. */
export function FileDropzone({ files, onChange }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const next = [...files];
    Array.from(incoming).forEach((f) => {
      // Не добавляем дубли по имени+размеру.
      if (!next.some((e) => e.name === f.name && e.size === f.size)) {
        next.push(f);
      }
    });
    onChange(next);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    e.target.value = ""; // позволяет повторно выбрать тот же файл
  }

  function removeFile(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          dragging
            ? "border-brand-500 bg-brand-50"
            : "border-slate-300 bg-slate-50/60 hover:border-brand-400 hover:bg-brand-50/50"
        }`}
      >
        <UploadCloud className="mb-3 h-10 w-10 text-brand-500" />
        <p className="text-sm font-medium text-slate-700">
          Перетащите отчеты сюда или нажмите для выбора
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Поддерживаются файлы .xlsx · можно несколько
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Выбрать файлы
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          hidden
          onChange={handleSelect}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-600" />
                <span className="truncate text-slate-700">{f.name}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {(f.size / 1024).toFixed(0)} КБ
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                aria-label="Удалить файл"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
