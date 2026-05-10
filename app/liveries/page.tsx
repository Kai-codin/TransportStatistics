"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUser } from "@clerk/nextjs";
import { LoaderCircle } from "lucide-react";

export default function LiveryPage() {
  const { user } = useUser();
  const liveries = useQuery(api.functions.liveries.getLiveryGrid, 
    user?.id ? { user: user.id } : "skip"
  );

  if (!liveries) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-ts-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-ts-text-1">Livery Grid</h1>
        <p className="text-ts-text-3">Every unique branding you've spotted on your travels.</p>
      </header>

      {/* FIXED: Single grid container using auto-fill */}
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(125px,1fr))]">
        {liveries.map((livery) => (
          <div 
            key={livery.name}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-ts-border bg-ts-surface transition-all hover:border-ts-accent/50 hover:shadow-lg"
          >
            {/* The "Flag" / CSS Swatch */}
            <div className="p-2">
              <div 
                className="aspect-[24/16] w-full border-b border-ts-border"
                style={{ 
                  background: livery.css || "linear-gradient(135deg, #333, #000)",
                }}
              />
            </div>
            
            {/* Details */}
            <div className="p-3">
              <h3 className="line-clamp-2 text-[13px] font-bold leading-tight text-ts-text-1" title={livery.name}>
                {livery.name}
              </h3>
              <p className="mt-1 text-[11px] font-medium text-ts-text-3">
                {livery.count} {livery.count === 1 ? 'trip' : 'trips'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}