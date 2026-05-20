import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    // Exclude Next internals, static files, and health checks
    '/((?!_next|api/health|api/proxy/map-style|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    
    // Run on API routes EXCEPT health + proxy
    '/api/(?!health|proxy/map-style).*',
    '/trpc/(.*)',
  ],
};