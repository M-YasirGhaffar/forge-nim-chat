import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Polyglot — Frontier AI, Many Models",
  description:
    "Chat with frontier open models — DeepSeek V4, Kimi K2, Qwen 3.5, GLM 5.1, FLUX — through one fast streaming UI with thinking traces and live artifacts.",
  applicationName: "Polyglot",
  authors: [{ name: "Asim" }],
  keywords: [
    "AI chat",
    "DeepSeek",
    "Kimi",
    "Qwen",
    "FLUX",
    "GLM",
    "NVIDIA NIM",
    "model picker",
    "artifacts",
  ],
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
