import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./studio.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: { default: "PicLite 图轻", template: "%s · PicLite 图轻" },
    description: "本地优先、可自托管的图片与 GIF 压缩工作台。支持无损优化、尺寸调整、实时对比、剪贴板导入与桌面文件夹监测。",
    applicationName: "PicLite 图轻",
    openGraph: {
      title: "PicLite 图轻",
      description: "清晰，轻一点。浏览器与 Windows、macOS、Linux 上的本地图片压缩工作台。",
      type: "website",
      images: [{ url: "/og.png", width: 1731, height: 909, alt: "PicLite 图轻 — 清晰，轻一点。" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "PicLite 图轻",
      description: "清晰，轻一点。浏览器与 Windows、macOS、Linux 上的本地图片压缩工作台。",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
