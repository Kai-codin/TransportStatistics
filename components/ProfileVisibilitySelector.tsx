"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Globe, Users, Lock } from "lucide-react";

const options = [
  { value: "public" as const, label: "Public", icon: Globe, desc: "Anyone can view your profile" },
  { value: "friends" as const, label: "Friends Only", icon: Users, desc: "Only friends can view your profile" },
  { value: "private" as const, label: "Private", icon: Lock, desc: "Only you can view your profile" },
];

export function ProfileVisibilitySelector() {
  const currentVisibility = useQuery(api.functions.friends.getMyVisibility);
  const setVisibility = useMutation(api.functions.friends.setVisibility);

  if (!currentVisibility) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-ts-text-3">Profile Visibility</p>
      <div className="inline-flex rounded-full border border-ts-border p-0.5 bg-ts-surface-2">
        {options.map((opt) => {
          const active = currentVisibility === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => setVisibility({ visibility: opt.value })}
              title={opt.desc}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                active
                  ? "bg-ts-accent text-ts-text-inv shadow-sm"
                  : "text-ts-text-2 hover:text-ts-text-1"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
