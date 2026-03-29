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
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "spar — talk it through with kabir before it counts",
  description:
    "the friend you call at 11pm when you're spiraling about tomorrow's conversation. practice out loud. get kabir's notes. built for students and anyone who needs the words.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      localization={{
        signIn: {
          start: {
            title: "get started",
            subtitle: "welcome back. your practices stay private.",
          },
        },
        signUp: {
          start: {
            title: "join spar",
            subtitle: "takes a minute. then you can talk to kabir.",
          },
        },
        userButton: {
          action__signOut: "sign out",
        },
      }}
    >
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
