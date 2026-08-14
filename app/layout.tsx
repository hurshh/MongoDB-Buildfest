import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConvTree — Git for LLM conversations",
  description: "Branching LLM chat tree on MongoDB Atlas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
