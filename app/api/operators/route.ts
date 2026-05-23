import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { auth } from "@clerk/nextjs/server";
import { withApiKeyAuth } from "@/lib/api-key-auth";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const GET = withApiKeyAuth(async (_auth, request: Request) => {
  const { searchParams } = new URL(req.url);
  const allMode = searchParams.get("all") === "1";

  // ── ALL MODE ────────────────────────────────────────────────────────────
  if (allMode) {
    try {
      const allOperators = await convex.query(
        api.functions.operators.getAllOperators, {}
      );

      // FIX: Changed operator_name to display_name
      allOperators.sort((a, b) => 
        (a.display_name ?? "").localeCompare(b.display_name ?? "")
      );

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

    // FIX: Changed operator_name to display_name
    operators.sort((a, b) => 
      (a.display_name ?? "").localeCompare(b.display_name ?? "")
    );

    return NextResponse.json({
      mode: "user",
      total: operators.length,
      operators,
    });
  } catch (error: any) {
    console.error("[operators/user] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});