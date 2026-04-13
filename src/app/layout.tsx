import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proposal AI Studio · Gravity One",
  description: "Internal proposal writing tool for the Gravity One team.",
  icons: { icon: '/Logo.png', shortcut: '/Logo.png', apple: '/Logo.png' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
