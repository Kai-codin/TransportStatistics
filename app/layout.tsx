import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Geist, Geist_Mono } from 'next/font/google'
import Sidebar from '@/components/Sidebar'
import { dark } from '@clerk/ui/themes'
import './globals.css'
import ConvexClientProvider from './ConvexClientProvider'

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
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0a0a0a]`}>
        <ClerkProvider
          appearance={{
            theme: dark,
          }}>
          <div className="flex h-screen overflow-hidden">
            {/* Sidebar fixed on the left */}
            <aside>
              <Sidebar />
            </aside>
            
            {/* Main Content area fills the rest */}
            <main className="flex-1 overflow-y-auto bg-ts-bg">
              <ConvexClientProvider>
              {children}
              </ConvexClientProvider>
            </main>
          </div>
        </ClerkProvider>
      </body>
    </html>
  )
}