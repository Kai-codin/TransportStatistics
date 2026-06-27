"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useUser } from "@clerk/nextjs";
import {
  Users, UserPlus, Inbox, Send, Search, UserCheck, UserX, Clock, LoaderCircle,
  X, Check,
} from "lucide-react";
import { FriendRequestButton } from "@/components/FriendRequestButton";
import { ProfileVisibilitySelector } from "@/components/ProfileVisibilitySelector";

type Tab = "friends" | "incoming" | "outgoing" | "search";

export default function FriendsPage() {
  const { isSignedIn } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>("friends");
  const [searchQuery, setSearchQuery] = useState("");

  const friends = useQuery(api.functions.friends.getMyFriends);
  const incoming = useQuery(api.functions.friends.getIncomingRequests);
  const outgoing = useQuery(api.functions.friends.getOutgoingRequests);
  const searchResults = useQuery(
    api.functions.friends.searchUsers,
    searchQuery.trim().length >= 2 ? { query: searchQuery } : "skip",
  );

  const acceptRequest = useMutation(api.functions.friends.acceptFriendRequest);
  const declineRequest = useMutation(api.functions.friends.declineFriendRequest);
  const cancelRequest = useMutation(api.functions.friends.cancelFriendRequest);
  const removeFriend = useMutation(api.functions.friends.removeFriend);
  const sendRequest = useMutation(api.functions.friends.sendFriendRequest);

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: "friends", label: "Friends", icon: Users },
    { key: "incoming", label: "Incoming", icon: Inbox },
    { key: "outgoing", label: "Outgoing", icon: Send },
    { key: "search", label: "Search", icon: Search },
  ];

  if (!isSignedIn) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="text-center py-10 text-slate-400">Please sign in to manage friends.</div>
      </div>
    );
  }

  const incomingCount = incoming?.length ?? 0;

  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-8 md:px-8 md:pt-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-ts-text-1">Friends</h1>
        {incomingCount > 0 && (
          <div className="rounded-full bg-ts-accent/15 px-3 py-1 text-xs font-semibold text-ts-accent">
            {incomingCount} pending
          </div>
        )}
      </div>

      <ProfileVisibilitySelector />

      <div className="mt-6 border-b border-white/10">
        <div className="flex gap-1">
          {tabs.map(({ key, label, icon: Icon }) => {
            const active = activeTab === key;
            const badge = key === "incoming" && incomingCount > 0 ? incomingCount : undefined;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-all border-b-2 -mb-px ${
                  active
                    ? "border-ts-accent text-ts-accent"
                    : "border-transparent text-ts-text-2 hover:text-ts-text-1"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {badge !== undefined && (
                  <span className="rounded-full bg-ts-accent/15 px-2 py-0.5 text-[10px] font-bold text-ts-accent">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        {activeTab === "friends" && (
          <FriendsTab
            friends={friends ?? []}
            onRemove={(id) => removeFriend({ friendId: id })}
          />
        )}
        {activeTab === "incoming" && (
          <IncomingTab
            requests={incoming ?? []}
            onAccept={(id) => acceptRequest({ requestId: id })}
            onDecline={(id) => declineRequest({ requestId: id })}
          />
        )}
        {activeTab === "outgoing" && (
          <OutgoingTab
            requests={outgoing ?? []}
            onCancel={(id) => cancelRequest({ toUser: id })}
          />
        )}
        {activeTab === "search" && (
          <SearchTab
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults ?? []}
            onSendRequest={(id) => sendRequest({ toUser: id })}
          />
        )}
      </div>
    </div>
  );
}

function FriendsTab({
  friends,
  onRemove,
}: {
  friends: { clerkId: string; username: string }[];
  onRemove: (id: string) => void;
}) {
  if (!friends.length) {
    return (
      <div className="text-center py-12 text-ts-text-3">
        <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No friends yet. Search for users to add!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {friends.map((f) => (
        <div
          key={f.clerkId}
          className="flex items-center justify-between rounded-2xl border border-ts-border bg-ts-surface p-4"
        >
          <div className="flex items-center gap-3">
            <Link href={`/profile/${f.clerkId}`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ts-accent/10 text-sm font-bold text-ts-accent hover:bg-ts-accent/20 transition-colors">
                {f.username.charAt(0).toUpperCase()}
              </div>
            </Link>
            <div>
              <Link href={`/profile/${f.clerkId}`} className="font-semibold text-ts-text-1 hover:text-ts-accent transition-colors">
                {f.username}
              </Link>
              <FriendRequestButton targetUserId={f.clerkId} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function IncomingTab({
  requests,
  onAccept,
  onDecline,
}: {
  requests: { _id: Id<"friendRequests">; fromUser: string; fromUsername: string; createdAt: number }[];
  onAccept: (id: Id<"friendRequests">) => void;
  onDecline: (id: Id<"friendRequests">) => void;
}) {
  if (!requests.length) {
    return (
      <div className="text-center py-12 text-ts-text-3">
        <Inbox className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No incoming requests.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {requests.map((r) => (
        <div
          key={r._id}
          className="flex items-center justify-between rounded-2xl border border-ts-border bg-ts-surface p-4"
        >
          <div className="flex items-center gap-3">
            <Link href={`/profile/${r.fromUser}`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ts-accent/10 text-sm font-bold text-ts-accent hover:bg-ts-accent/20 transition-colors">
                {r.fromUsername.charAt(0).toUpperCase()}
              </div>
            </Link>
            <div>
              <Link href={`/profile/${r.fromUser}`} className="font-semibold text-ts-text-1 hover:text-ts-accent transition-colors">
                {r.fromUsername}
              </Link>
              <p className="text-xs text-ts-text-3">
                Sent {new Date(r.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onAccept(r._id)}
              className="inline-flex items-center gap-1 rounded-full border border-ts-accent/30 bg-ts-accent/10 px-3 py-1.5 text-xs font-semibold text-ts-accent transition-all hover:border-ts-accent/50 hover:bg-ts-accent/20"
            >
              <Check className="h-3.5 w-3.5" />
              Accept
            </button>
            <button
              onClick={() => onDecline(r._id)}
              className="inline-flex items-center gap-1 rounded-full border border-ts-border bg-ts-surface px-3 py-1.5 text-xs font-semibold text-ts-text-2 transition-all hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <X className="h-3.5 w-3.5" />
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function OutgoingTab({
  requests,
  onCancel,
}: {
  requests: { _id: string; toUser: string; toUsername: string; status: string; createdAt: number }[];
  onCancel: (toUser: string) => void;
}) {
  if (!requests.length) {
    return (
      <div className="text-center py-12 text-ts-text-3">
        <Send className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No outgoing requests.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {requests.map((r) => (
        <div
          key={r._id}
          className="flex items-center justify-between rounded-2xl border border-ts-border bg-ts-surface p-4"
        >
          <div className="flex items-center gap-3">
            <Link href={`/profile/${r.toUser}`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ts-accent/10 text-sm font-bold text-ts-accent hover:bg-ts-accent/20 transition-colors">
                {r.toUsername.charAt(0).toUpperCase()}
              </div>
            </Link>
            <div>
              <Link href={`/profile/${r.toUser}`} className="font-semibold text-ts-text-1 hover:text-ts-accent transition-colors">
                {r.toUsername}
              </Link>
              <div className="flex items-center gap-1.5">
                {r.status === "pending" ? (
                  <span className="flex items-center gap-1 text-xs text-amber-400">
                    <Clock className="h-3 w-3" /> Pending
                  </span>
                ) : r.status === "accepted" ? (
                  <span className="flex items-center gap-1 text-xs text-ts-accent">
                    <UserCheck className="h-3 w-3" /> Accepted
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-rose-400">
                    <UserX className="h-3 w-3" /> Declined
                  </span>
                )}
                <span className="text-xs text-ts-text-3">
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          {r.status === "pending" && (
            <button
              onClick={() => onCancel(r.toUser)}
              className="inline-flex items-center gap-1 rounded-full border border-ts-border bg-ts-surface px-3 py-1.5 text-xs font-semibold text-ts-text-2 transition-all hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SearchTab({
  query,
  onQueryChange,
  results,
  onSendRequest,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: { clerkId: string; username: string; status: string }[];
  onSendRequest: (id: string) => void;
}) {
  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ts-text-3" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search users by username..."
          className="w-full rounded-2xl border border-ts-border bg-ts-surface-2 pl-10 pr-4 py-2.5 text-sm text-ts-text-1 outline-none focus:border-ts-accent"
        />
      </div>
      {query.trim().length < 2 ? (
        <div className="text-center py-12 text-ts-text-3">
          <Search className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Type at least 2 characters to search.</p>
        </div>
      ) : !results.length ? (
        <div className="text-center py-12 text-ts-text-3">
          <p className="text-sm">No users found matching "{query}".</p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((u) => (
            <div
              key={u.clerkId}
              className="flex items-center justify-between rounded-2xl border border-ts-border bg-ts-surface p-4"
            >
              <div className="flex items-center gap-3">
                <Link href={`/profile/${u.clerkId}`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ts-accent/10 text-sm font-bold text-ts-accent hover:bg-ts-accent/20 transition-colors">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                </Link>
                <Link href={`/profile/${u.clerkId}`} className="font-semibold text-ts-text-1 hover:text-ts-accent transition-colors">
                  {u.username}
                </Link>
              </div>
              <FriendRequestButton targetUserId={u.clerkId} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
