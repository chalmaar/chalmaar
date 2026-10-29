import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSN Signature Events — Chh. Sambhajinagar",
  description: "Diwali Party booking site for CSN Signature Events.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
