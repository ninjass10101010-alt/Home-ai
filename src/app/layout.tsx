import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/hooks/useTheme";
import { WeatherProvider } from "@/hooks/useWeather";
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

// Anti-FOUC script: runs inline before React hydrates so the correct
// data-theme is set on <html> from the very first paint, avoiding the
// "stuck between dark and light" flash.
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('home-ai-theme-config');
    var config = stored ? JSON.parse(stored) : null;
    var mode = config && config.mode ? config.mode : 'system';
    var resolvedDark = false;
    if (mode === 'dark') {
      resolvedDark = true;
    } else if (mode === 'light') {
      resolvedDark = false;
    } else {
      resolvedDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.setAttribute('data-theme', resolvedDark ? 'dark' : 'light');
    if (config && config.contrastBoost) {
      document.documentElement.setAttribute('data-contrast', 'boost');
    }
    if (config && config.accentColor) {
      document.documentElement.style.setProperty(
        '--color-accent-selected',
        'var(--color-accent-' + config.accentColor + ')'
      );
    }
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        {/* Inline script runs before any CSS or React — prevents flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <WeatherProvider>
            {children}
          </WeatherProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

