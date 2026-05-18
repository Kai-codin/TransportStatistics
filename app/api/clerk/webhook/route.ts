import { ConvexHttpClient } from "convex/browser";
import { Webhook } from "standardwebhooks";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";

type ClerkUserWebhookEvent = {
  type: string;
  data: {
    id: string;
    username?: string | null;
  };
};

function getWebhookSecret() {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("CLERK_WEBHOOK_SECRET is not configured.");
  }
  return secret;
}

function getConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }
  return new ConvexHttpClient(url);
}

function getClerkUserId(event: ClerkUserWebhookEvent) {
  if (!event.data?.id) {
    throw new Error("Webhook payload is missing a Clerk user id.");
  }
  return event.data.id;
}

function getClerkUsername(event: ClerkUserWebhookEvent) {
  return event.data?.username ?? null;
}

export async function POST(request: Request) {
  const body = await request.text();
  const webhook = new Webhook(getWebhookSecret());
  const event = webhook.verify(body, Object.fromEntries(request.headers.entries())) as ClerkUserWebhookEvent;
  const clerkId = getClerkUserId(event);
  const convex = getConvexClient();

  switch (event.type) {
    case "user.created":
    case "user.updated":
      await convex.mutation(api.functions.users.upsertFromClerk, {
        clerkId,
        username: getClerkUsername(event),
      });
      break;
    case "user.deleted":
      await convex.mutation(api.functions.users.deleteByClerkId, {
        clerkId,
      });
      break;
    default:
      break;
  }

  return NextResponse.json({ success: true });
}
