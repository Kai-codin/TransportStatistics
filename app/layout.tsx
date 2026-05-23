import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Sidebar from '@/components/Sidebar'
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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppProviders>
          <div className="flex h-screen overflow-hidden">
            {/* Sidebar fixed on the left */}
            <aside>
              <Sidebar />
            </aside>

            {/* Main Content area fills the rest */}
            <main className="flex-1 overflow-y-auto bg-ts-bg">
              {children}
            </main>
          </div>
        </AppProviders>
      </body>
    </html>
  )
}