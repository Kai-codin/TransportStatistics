"use client";

import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient, useMutation } from "convex/react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function ClerkUserSyncFallback() {
  const { isLoaded, isSignedIn, user } = useUser();
  const syncCurrentUser = useMutation(api.functions.users.syncCurrentUser);
  const lastSyncedKey = useRef<string | null>(null);

  const username =
    user?.username ||
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    user?.id;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user?.id || !username) return;

    const syncKey = `${user.id}:${username}`;
    if (lastSyncedKey.current === syncKey) return;
    lastSyncedKey.current = syncKey;

    void syncCurrentUser({ username }).catch((error) => {
      lastSyncedKey.current = null;
      console.error("Failed to sync Clerk user to Convex", error);
    });
  }, [isLoaded, isSignedIn, syncCurrentUser, user?.id, username]);

  return null;
}

export default function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <ClerkUserSyncFallback />
      {children}
    </ConvexProviderWithClerk>
  );
}
