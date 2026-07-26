import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dolphn",
  description: "Session-centric file and homework system for freelance tutors.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
