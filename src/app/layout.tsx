import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Фильтр отчетов Wildberries",
  description:
    "Загрузите отчет WB и список артикулов, чтобы получить отфильтрованный Excel-файл.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
