import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "620 路線工作室｜TWB 2026",
  description: "四極點 620 路線編輯、檢錄點、Garmin 軌跡與版本管理。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
