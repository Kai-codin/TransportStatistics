// app/api/operators/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { auth } from "@clerk/nextjs/server";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const allMode = searchParams.get("all") === "1";

  // ── ALL MODE ────────────────────────────────────────────────────────────
  // Just read from the local table. Sync is a separate concern (cron/webhook).
  if (allMode) {
    try {
      const allOperators = await convex.query(
        api.functions.operators.getAllOperators, {}
      );

      allOperators.sort((a, b) => a.operator_name.localeCompare(b.operator_name));
      return NextResponse.json({
        mode: "all",
        total: allOperators.length,
        operators: allOperators,
      });
    } catch (error: any) {
      console.error("[operators/all] error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ── USER MODE ──────────────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const operators = await convex.query(
        api.functions.operators.getUserRiddenOperators,
        { userId }
    );

    operators.sort((a, b) => a.operator_name.localeCompare(b.operator_name));
    return NextResponse.json({
      mode: "user",
      total: operators.length,
      operators,
    });
  } catch (error: any) {
    console.error("[operators/user] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}