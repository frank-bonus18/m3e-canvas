import type { Metadata, Viewport } from "next";
import "./globals.css";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://frank-bonus18.github.io",
  ),
  title: "M3E Canvas",
  applicationName: "M3E Canvas",
  alternates: { canonical: `${BASE}/` },
  description:
    "Sketch Material 3 Expressive screens in the browser and turn them into vibe-coding prompts. / 在浏览器里拼出 Material 3 Expressive 界面，直接变成提示词。",
  openGraph: {
    title: "M3E Canvas",
    description: "Design Material 3 Expressive screens, link them, preview them, and copy a prompt for your AI coding tool.",
    images: [`${BASE}/og.png`],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: [`${BASE}/og.png`] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#6750A4",
};

/* 字体自托管。上游从这里加载 fonts.googleapis.com 的两个样式表，
   在无法访问 Google 的网络里（例如中国大陆）图标会退化成连字文字，
   整个界面看起来像坏了。改成从 public/fonts/ 取，构建期确定 basePath。
   Material Symbols 已把 GRAD / opsz 轴钉死，5.2 MB → 1.4 MB，字形一个没少。 */
const fontFaceCss = `
@font-face {
  font-family: "Material Symbols Rounded";
  font-style: normal;
  font-weight: 100 700;
  font-display: block;
  src: url("${BASE}/fonts/material-symbols-rounded.woff2") format("woff2");
}
@font-face {
  font-family: "Roboto";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("${BASE}/fonts/roboto-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191,
    U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Roboto";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("${BASE}/fonts/roboto-latin-ext.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF,
    U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020,
    U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The script below writes the --skel-* variables onto this element before React hydrates;
    // the DOM is meant to win over the server-rendered (empty) style.
    <html lang="zh-Hans" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: fontFaceCss }} />
        {/* 在首屏之前把语言定下来：与 lib/lang.ts 的 preferredLang 同一套规则，
            避免服务端先渲染一种语言、水合后再跳一次。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var u=JSON.parse(localStorage.getItem('m3e:ui')||'null')||{};" +
              "var l=u.lang;if(l!=='ja'&&l!=='en'&&l!=='zh'&&l!=='ko'){" +
              "var n=(navigator.language||'').toLowerCase();" +
              "l=n.indexOf('zh')===0?'zh':n.indexOf('ko')===0?'ko':n.indexOf('ja')===0?'ja':'en';}" +
              "document.documentElement.lang=l;}catch(e){}",
          }}
        />
        {/* before the first paint: the panel widths and the theme colours the last visit left, so
            the shell drawn while the editor loads is the one that appears. The editor reads the
            same key itself; only well-formed hex colours are taken from it. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var u=JSON.parse(localStorage.getItem('m3e:ui')||'null')||{};var s=document.documentElement.style;" +
              "var n=function(v){return typeof v==='number'&&isFinite(v)};" +
              "if(u.leftOpen===false)s.setProperty('--skel-left','52px');else if(n(u.leftW))s.setProperty('--skel-left',Math.min(480,Math.max(296,u.leftW))+'px');" +
              "if(u.rightOpen===false)s.setProperty('--skel-right','0px');else if(n(u.rightW))s.setProperty('--skel-right',Math.min(480,Math.max(280,u.rightW))+'px');" +
              "var b=u.boot||{};var ok=function(c){return typeof c==='string'&&/^#[0-9a-fA-F]{6}$/.test(c)};" +
              "['surface','container','low','high','primary','canvas'].forEach(function(k){if(ok(b[k]))s.setProperty('--skel-'+k,b[k])});}catch(e){}",
          }}
        />
      </head>
      <body style={{ fontFamily: "Roboto, system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
