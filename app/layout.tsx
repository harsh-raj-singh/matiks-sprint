import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matiks Sprint",
  description: "A 60-second single-player mental math sprint.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
