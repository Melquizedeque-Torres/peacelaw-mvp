import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";

import { SessionProvider } from "@/lib/session";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "PeaceLaw",
  description: "Resolução online de disputas com análise preditiva e anonimização de dados.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${lora.variable}`}>
      <body className="bg-background font-sans text-foreground antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
