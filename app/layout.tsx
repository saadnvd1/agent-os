import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/Providers";
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
  title: "AgentOS",
  description: "AI Agent Command Center",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme initialization script - prevents flash of unstyled content */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Get theme from localStorage (where next-themes stores it)
                  const theme = localStorage.getItem('theme') || 'dark';
                  const root = document.documentElement;

                  // Handle system theme
                  let actualTheme = theme;
                  if (theme === 'system') {
                    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    actualTheme = isDark ? 'dark' : 'light';
                  }

                  // Parse compound themes like "dark-warm" or "light-default"
                  const parts = actualTheme.split('-');
                  const mode = parts[0];
                  const variant = parts[1];

                  // Apply theme class
                  root.classList.remove('light', 'dark');
                  root.classList.add(mode === 'dark' || mode === 'light' ? mode : 'dark');

                  // Apply variant as data attribute
                  // "deep" and "default" are base themes - no data attribute needed
                  root.removeAttribute('data-theme-variant');
                  if (variant && variant !== 'default' && variant !== 'deep') {
                    root.setAttribute('data-theme-variant', variant);
                  }
                } catch (e) {
                  // Fallback to dark mode if anything fails
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          {children}
        </Providers>
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            className: "!bg-card !border-border !text-foreground !shadow-lg",
          }}
        />
      </body>
    </html>
  );
}
