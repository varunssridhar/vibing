import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Good Morning",
  description: "Good Morning – a Next.js app in the monorepo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
