import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./workspace-polish.css";
import "./themes.css";
import "./workflow-ui.css";

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
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(()=>{let p='system';try{let v=localStorage.getItem('frontline-theme');if(v==='light'||v==='dark')p=v}catch{}let r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p})()",
          }}
        />
        {children}
      </body>
    </html>
  );
}
