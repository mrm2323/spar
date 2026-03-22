import type { Metadata } from "next";
import { Suspense } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { AmplitudeBootstrap } from "@/components/analytics/AmplitudeBootstrap";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmMono = IBM_Plex_Mono({
  variable: "--font-ibm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "SPAR — AI voice companion for hard conversations",
  description:
    "Rehearse out loud with Kabir. Real pushback, notes you can use—before raises, boundaries, feedback, and the talks you’ve been putting off.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body
          className={`${dmSans.variable} ${ibmMono.variable} font-sans antialiased bg-[#0A0A0F] text-zinc-50`}
          suppressHydrationWarning
        >
          <Suspense fallback={null}>
            <AmplitudeBootstrap />
          </Suspense>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
