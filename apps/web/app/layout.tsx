// Root layout: fonts, theme bootstrap (before paint, so no flash), providers, the app frame, and the @drawer slot for intercepted round receipts.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { AppFrame, Providers, themeScript } from "@/components/shell";
import { Splash } from "@/components/mosaic/Splash";
import { DevAgentation } from "@/components/DevAgentation";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "ToD", template: "%s · ToD" },
  description: "ML training on idle laptops, with every round verified and paid on chain.",
};

export default function RootLayout({ children, drawer }: { children: ReactNode; drawer: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-raised focus:px-2">Skip to content</a>
          <AppFrame>{children}</AppFrame>
          {drawer}
          <Splash />
        </Providers>
        <DevAgentation />
      </body>
    </html>
  );
}
