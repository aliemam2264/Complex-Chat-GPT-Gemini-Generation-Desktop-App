import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { GenerationActivityDock } from "@/components/generation/generation-activity-dock";
import { GenerationInspectorModal } from "@/components/generation/generation-inspector-modal";

import "./globals.css";

import Providers from "./providers";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "Eskander Plus Studio",
  description: "Architectural AI workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={geist.variable}>
        <Providers>
          {children}

          <GenerationActivityDock />
          <GenerationInspectorModal />
        </Providers>
      </body>
    </html>
  );
}
