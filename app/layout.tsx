import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const description = "結合社群治理型 RAG、六腔證據揭露、HakkaGPT 與公眾共編的客家知識 AI 平台。";
  return {
    title: "客天光｜客家GPT",
    description,
    openGraph: {
      title: "客天光｜客家GPT",
      description,
      type: "website",
      locale: "zh_TW",
      images: [{ url: imageUrl, width: 1670, height: 939, alt: "客天光・客家GPT" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "客天光｜客家GPT",
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
