import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { DeletedObjectJSON, UserJSON, WebhookEvent } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import type { NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function getPrimaryEmail(user: UserJSON) {
  return user.email_addresses.find(
    (email) => email.id === user.primary_email_address_id,
  )?.email_address;
}

function getFullName(user: UserJSON) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
}

function getUsername(user: UserJSON) {
  return user.username || getFullName(user) || getPrimaryEmail(user) || user.id;
}

async function handleUserUpsert(user: UserJSON, syncSecret: string) {
  await convex.mutation(api.functions.users.upsertFromClerkWebhook, {
    clerkId: user.id,
    username: getUsername(user),
    syncSecret,
  });
}

async function handleUserDelete(user: DeletedObjectJSON, syncSecret: string) {
  if (!user.id) return;

  await convex.mutation(api.functions.users.deleteFromClerkWebhook, {
    clerkId: user.id,
    syncSecret,
  });
}

export async function POST(request: NextRequest) {
  const syncSecret = process.env.CLERK_CONVEX_SYNC_SECRET;

  if (!syncSecret) {
    return Response.json(
      { error: "Missing CLERK_CONVEX_SYNC_SECRET" },
      { status: 500 },
    );
  }

  let event: WebhookEvent;

  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("Clerk webhook verification failed", error);
    return Response.json({ error: "Webhook verification failed" }, { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated":
      await handleUserUpsert(event.data, syncSecret);
      break;
    case "user.deleted":
      await handleUserDelete(event.data, syncSecret);
      break;
    default:
      break;
  }

  return Response.json({ received: true });
}
