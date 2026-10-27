import type { Metadata } from "next";
import "./globals.css";
import { InspectionSessionProvider } from "@/components/inspection/InspectionSession";

export const metadata: Metadata = {
  title: "AssemblyPilot — Visual Assembly Intelligence",
  description: "A local visual workspace for guided LEGO assembly. Camera capture, custom projects and on-demand Meta AI inspection.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><InspectionSessionProvider>{children}</InspectionSessionProvider></body></html>;
}
