import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./workspace-polish.css";

const manrope = localFont({
  src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-workspace",
  weight: "200 800",
  display: "swap",
  fallback: ["Arial"],
});
export const metadata: Metadata = {
  title: "FRONTLINE · Operations CRM",
  description: "Frontline customer operations workspace",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
