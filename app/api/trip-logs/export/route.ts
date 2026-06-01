import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const CSV_COLUMNS = [
  "service_number",
  "operator",
  "operator_slug",
  "service_date",
  "transport_type",
  "bustimes_service_id",
  "bustimes_service_slug",
  "origin_name",
  "origin_stop_code",
  "destination_name",
  "destination_stop_code",
  "scheduled_departure",
  "actual_departure",
  "scheduled_arrival",
  "actual_arrival",
  "full_route",
  "ridden_route",
  "units",
  "notes",
];

function escapeCsv(value: unknown) {
  if (value == null) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const needsQuotes = /[",\n]/.test(raw);
  const escaped = raw.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export async function GET(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token =
    (await getToken({ template: "convex" })) ??
    (await getToken());

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    });
    convex.setAuth(token);

    const format = new URL(request.url).searchParams.get("format") ?? "csv";
    const trips: any[] = [];
    let cursor: string | null = null;

    while (true) {
      const page = await convex.query(api.functions.trips.getMyTripsPaginated, {
        cursor,
        limit: 500,
      });
      trips.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    if (format === "json") {
      const payload = JSON.stringify(trips, null, 2);
      const filename = `trip-logs-${new Date().toISOString().split("T")[0]}.json`;
      return new Response(payload, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"${filename}\"`,
        },
      });
    }

    const header = CSV_COLUMNS.join(",");
    const rows = trips.map((trip: any) =>
      CSV_COLUMNS.map((column) => escapeCsv(trip?.[column])).join(",")
    );
    const csv = [header, ...rows].join("\n");

    const filename = `trip-logs-${new Date().toISOString().split("T")[0]}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return new Response(message, { status: 500 });
  }
}
