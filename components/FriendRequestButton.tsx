"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { UserPlus, UserCheck, UserX, Clock, LoaderCircle } from "lucide-react";
import { useState } from "react";

type Props = {
  targetUserId: string;
};

export function FriendRequestButton({ targetUserId }: Props) {
  const status = useQuery(api.functions.friends.getFriendStatus, { targetUserId });
  const incomingRequestId = useQuery(
    api.functions.friends.getIncomingRequestId,
    status === "received" ? { fromUser: targetUserId } : "skip",
  );
  const sendRequest = useMutation(api.functions.friends.sendFriendRequest);
  const cancelRequest = useMutation(api.functions.friends.cancelFriendRequest);
  const acceptRequest = useMutation(api.functions.friends.acceptFriendRequest);
  const declineRequest = useMutation(api.functions.friends.declineFriendRequest);
  const removeFriend = useMutation(api.functions.friends.removeFriend);
  const [loading, setLoading] = useState(false);

  if (!status || status === "self") return null;

  const handleAction = async (action: () => Promise<unknown>) => {
    setLoading(true);
    try {
      await action();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const btnClass = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50";

  if (status === "friends") {
    return (
      <button
        onClick={() => handleAction(() => removeFriend({ friendId: targetUserId }))}
        disabled={loading}
        className={`${btnClass} border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:border-rose-400/50 hover:bg-rose-500/20`}
      >
        {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
        Remove Friend
      </button>
    );
  }

  if (status === "received") {
    return (
      <div className="flex gap-1.5">
        <button
          onClick={() => {
            if (incomingRequestId) handleAction(() => acceptRequest({ requestId: incomingRequestId }));
          }}
          disabled={loading || !incomingRequestId}
          className={`${btnClass} border border-ts-accent/30 bg-ts-accent/10 text-ts-accent hover:border-ts-accent/50 hover:bg-ts-accent/20`}
        >
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
          Accept
        </button>
        <button
          onClick={() => {
            if (incomingRequestId) handleAction(() => declineRequest({ requestId: incomingRequestId }));
          }}
          disabled={loading || !incomingRequestId}
          className={`${btnClass} border border-ts-border bg-ts-surface text-ts-text-2 hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-300`}
        >
          Decline
        </button>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <button
        onClick={() => handleAction(() => cancelRequest({ toUser: targetUserId }))}
        disabled={loading}
        className={`${btnClass} border border-ts-border bg-ts-surface text-ts-text-2 hover:border-amber-400/50 hover:bg-amber-500/10 hover:text-amber-300`}
      >
        {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
        Request Sent
      </button>
    );
  }

  return (
    <button
      onClick={() => handleAction(() => sendRequest({ toUser: targetUserId }))}
      disabled={loading}
      className={`${btnClass} border border-ts-accent/30 bg-ts-accent/10 text-ts-accent hover:border-ts-accent/50 hover:bg-ts-accent/20`}
    >
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
      Add Friend
    </button>
  );
}
