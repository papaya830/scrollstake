import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScrollStake",
  description: "Put your focus where your money is.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
