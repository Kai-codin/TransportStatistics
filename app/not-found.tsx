// app/not-found.tsx
import Link from 'next/link';
import { MapPin, AlertTriangle } from 'lucide-react'; // Assuming you have lucide-react installed

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] text-center px-4">
      <div className="relative mb-8">
        <MapPin className="w-20 h-20 text-gray-600" />
        <AlertTriangle className="w-8 h-8 text-ts-accent absolute -top-2 -right-2" />
      </div>
      
      <h2 className="text-4xl font-bold text-white mb-2">404 | Not Found</h2>
      <p className="text-gray-400 max-w-md mb-8">
        We couldn't find the route or page you were looking for. 
        It might have been moved, or this service is currently undergoing maintenance.
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