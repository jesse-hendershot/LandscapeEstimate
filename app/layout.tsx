import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

import SiteHeader from "./components/SiteHeader";
import { C } from "./theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LandscapeEstimate",
  description: "AI-powered materials cost estimator for landscaping contractors",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        style={{ background: C.bg, color: C.black }}
      >
        {/*
          ClerkProvider goes INSIDE <body>, not wrapping <html>.

          Wrapping <html> was the documented pattern for years and is what most
          examples still show, but Clerk Core 3 renders elements that have to
          live inside the body. Same category of drift as <SignedIn>, which was
          removed in Core 3 and now throws.
        */}
        <ClerkProvider>
          <SiteHeader />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
