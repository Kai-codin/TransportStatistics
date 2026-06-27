import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import LayoutShell from '@/components/LayoutShell'
import './globals.css'
import AppProviders from './providers'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Transport Statistics',
  description: 'Manage your logistics',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-ts-theme="dark">
      <script async src="https://umami.nextstoplabs.org/script.js" data-website-id="99db04f7-a5bc-47ff-badc-646033044041"></script>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppProviders>
          <LayoutShell>{children}</LayoutShell>
        </AppProviders>
      </body>
    </html>
  )
}