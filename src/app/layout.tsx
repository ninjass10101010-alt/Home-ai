import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Consuela — AI Family Organizer",
  description:
    "Consuela is your AI-powered family organizer. Manage calendars, meals, groceries, and chores through a single conversational interface.",
  keywords: [
    "family organizer",
    "AI assistant",
    "meal planning",
    "family calendar",
    "chore management",
    "grocery list",
  ],
  openGraph: {
    title: "Consuela — AI Family Organizer",
    description: "Your AI-powered family coordinator.",
    siteName: "Consuela",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f1117",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
