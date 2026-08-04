import type { Metadata } from "next"
import { DevToolbar } from "@/components/dev-toolbar"
import { FrameLines } from "@/components/frame"
import "./globals.css"

export const metadata: Metadata = {
  title: "karaoke-v",
  description: "A live effects overlay for the Synthesizer V Studio piano roll.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <FrameLines />
        <div className="relative z-10">{children}</div>
        {process.env.NODE_ENV === "development" && <DevToolbar />}
      </body>
    </html>
  )
}
