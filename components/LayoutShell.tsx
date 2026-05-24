'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

type LayoutShellProps = {
  children: React.ReactNode;
};

export default function LayoutShell({ children }: LayoutShellProps) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith('/admin');

  if (isAdmin) {
    return <div className="min-h-screen bg-ts-bg">{children}</div>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside>
        <Sidebar />
      </aside>
      <main className="flex-1 overflow-y-auto bg-ts-bg">
        {children}
      </main>
    </div>
  );
}
