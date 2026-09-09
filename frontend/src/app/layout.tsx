import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { ApiStatus } from "@/components/ApiStatus";
import { KeeperPicker } from "@/components/KeeperPicker";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Equipment Ledger",
  description: "The tool store's book: who has what, since when, and what happened before.",
};

const nav = [
  { href: "/", label: "Store" },
  { href: "/as-of", label: "As of" },
  { href: "/ledger", label: "Ledger" },
  { href: "/workers", label: "Workers" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <Providers>
          <header className="border-b border-zinc-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
              <Link href="/" className="font-semibold tracking-tight">
                Equipment Ledger
              </Link>
              <nav className="flex gap-4 text-sm text-zinc-600">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="hover:text-zinc-900">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-4">
                <KeeperPicker />
                <ApiStatus />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
