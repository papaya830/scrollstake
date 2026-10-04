import type { Metadata } from "next";
import { Figtree, Titan_One } from "next/font/google";
import "./globals.css";

const display = Titan_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "ScrollStake",
  description: "Put your focus where your money is.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
