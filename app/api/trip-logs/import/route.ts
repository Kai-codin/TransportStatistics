import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const REQUIRED_COLUMNS = [
  "service_number",
  "operator",
  "operator_slug",
  "service_date",
  "transport_type",
  "origin_name",
  "origin_stop_code",
  "destination_name",
  "destination_stop_code",
  "scheduled_departure",
  "scheduled_arrival",
];

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function parseNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseJson(value: string | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeServiceDate(value: string | undefined) {
  if (!value) return undefined;
  const asNumber = parseNumber(value);
  if (asNumber) return asNumber;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const token =
    (await getToken({ template: "convex" })) ??
    (await getToken());

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: "Missing CSV file" }), { status: 400 });
  }

  const csvText = await file.text();
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return new Response(JSON.stringify({ error: "CSV is empty" }), { status: 400 });
  }

  const headers = rows[0].map((value) => value.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({ error: `Missing required columns: ${missing.join(", ")}` }),
      { status: 400 }
    );
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  });
  convex.setAuth(token);

  let imported = 0;
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });

    const serviceDate = normalizeServiceDate(record.service_date);
    if (!serviceDate) {
      errors.push(`Row ${i + 1}: invalid service_date`);
      continue;
    }

    try {
      await convex.mutation(api.functions.trips.logTrip, {
        service_number: record.service_number || "Unknown",
        operator: record.operator || "Unknown",
        operator_slug: record.operator_slug || "unknown",
        service_date: serviceDate,
        transport_type: (record.transport_type as any) || "Other",
        bustimes_service_id: parseNumber(record.bustimes_service_id),
        bustimes_service_slug: record.bustimes_service_slug || undefined,
        origin_name: record.origin_name || "Unknown",
        origin_stop_code: record.origin_stop_code || "",
        destination_name: record.destination_name || "Unknown",
        destination_stop_code: record.destination_stop_code || "",
        scheduled_departure: record.scheduled_departure || "",
        actual_departure: record.actual_departure || undefined,
        scheduled_arrival: record.scheduled_arrival || "",
        actual_arrival: record.actual_arrival || undefined,
        full_route: parseJson(record.full_route) ?? null,
        ridden_route: parseJson(record.ridden_route) ?? null,
        units: parseJson(record.units) ?? [],
        notes: record.notes || undefined,
      });
      imported += 1;
    } catch (error) {
      errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return new Response(JSON.stringify({ imported, failed: errors.length, errors }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
