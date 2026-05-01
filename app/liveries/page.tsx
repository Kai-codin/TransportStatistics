// app/placeholder/page.tsx
import Link from 'next/link';
import { Construction, Clock } from 'lucide-react';

export default function ComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] text-center px-4">
      <div className="relative mb-8">
        <Construction className="w-20 h-20 text-gray-600" />
        <Clock className="w-8 h-8 text-ts-accent absolute -top-2 -right-2" />
      </div>
      
      <h2 className="text-4xl font-bold text-white mb-2">Coming Soon</h2>
      <p className="text-gray-400 max-w-md mb-8">
        This feature is currently under development. 
        <br />
        Our team is working hard to bring 
        <br />
        it to you. Please check back later!
      </p>

      <Link 
        href="/" 
        className="px-6 py-2.5 bg-ts-accent hover:bg-ts-accent text-ts-text-inv rounded-lg font-bold transition-all shadow-lg hover:shadow-ts-accent/20"
      >
        Return to Map
      </Link>
    </div>
  );
}