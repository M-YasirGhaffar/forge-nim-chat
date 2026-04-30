"use client";

import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/components/auth-provider";
import { useEffect } from "react";
import { ensureAppCheck } from "@/lib/firebase/client";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    ensureAppCheck();
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
