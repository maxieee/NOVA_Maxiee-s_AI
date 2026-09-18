import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { MobileHeader } from "@/components/layout/MobileHeader";

export const metadata: Metadata = {
  title: "NOVA — Your Personal Assistant",
  description: "NOVA makes sure you never forget anything important.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen bg-nova-bg font-sans text-white antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-h-screen flex-1 flex-col">
            <MobileHeader />
            <main className="flex-1 pb-20 md:pb-0">{children}</main>
          </div>
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
