import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// --- Helper Functions ---

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getDelayText(delay: number) {
  if (delay < 0) return `${Math.abs(delay)} mins early`;
  if (delay === 0) return "on time";
  return `${delay} mins late`;
}

function interpolateColour(c1: number[], c2: number[], t: number) {
  return `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(",")})`;
}

// 🎨 nicer modern palette (still matches signalling ranges)
function getTrainColour(delay: number, headcode?: string) {
  if (headcode === "N/A") return "#6B7280"; 

  if (delay <= -3) return "#3B82F6"; // blue
  if (delay <= 2) return "#22C55E";  // green

  if (delay <= 9) {
    const t = (delay - 3) / 6;
    return interpolateColour([245, 158, 11], [239, 68, 68], t); // amber → red
  }

  if (delay <= 19) {
    const t = (delay - 10) / 9;
    return interpolateColour([239, 68, 68], [236, 72, 153], t); // red → pink
  }

  if (delay <= 59) return "#EC4899"; // pink
  return "#8B5CF6"; // purple
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "true";
  const xmin = searchParams.get("xmin");
  const ymin = searchParams.get("ymin");
  const xmax = searchParams.get("xmax");
  const ymax = searchParams.get("ymax");

  const showTrains = searchParams.get("showTrains") !== "false";
  const showBuses = searchParams.get("showBuses") !== "false";

  if (!xmin || !ymin || !xmax || !ymax) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const latMin = parseFloat(ymin);
  const latMax = parseFloat(ymax);
  const lonMin = parseFloat(xmin);
  const lonMax = parseFloat(xmax);
  const bboxQuery = `xmin=${xmin}&ymin=${ymin}&xmax=${xmax}&ymax=${ymax}`;

  try {
    const results = await Promise.allSettled([
      showTrains
        ? fetch(`https://map-api.production.signalbox.io/api/locations?${bboxQuery}`)
        : Promise.resolve(null),
      showBuses
        ? fetch(`https://bustimes.org/vehicles.json?${bboxQuery}`)
        : Promise.resolve(null),
    ]);

    // -----------------------------
    // 🚆 TRAIN DATA (ALL TRAINS FIRST)
    // -----------------------------
    let allTrains: any[] = [];

    if (showTrains && results[0].status === "fulfilled" && results[0].value?.ok) {
      const data = await results[0].value.json();
      allTrains = data.train_locations || [];
    }

    // -----------------------------
    // 🚌 BUS DATA
    // -----------------------------
    let busData: any[] = [];
    if (showBuses && results[1].status === "fulfilled" && results[1].value?.ok) {
      busData = await results[1].value.json();
    }

    const isSimpleMode = (allTrains.length + busData.length) > 1000;
    const cachedDetails: Record<string, any> = {};

    // -----------------------------
    // 🔄 UPDATE ALL TRAIN DETAILS (NOT JUST VISIBLE)
    // -----------------------------
    if (!isSimpleMode && showTrains) {
      const rids = allTrains.map((t: any) => t.rid).filter(Boolean);
      const CHUNK_SIZE = 100;

      for (let i = 0; i < rids.length; i += CHUNK_SIZE) {
        const chunk = rids.slice(i, i + CHUNK_SIZE);

        const data = await convex.query(api.functions.trains.getDetailsForRids, {
          rids: chunk,
        });

        Object.assign(cachedDetails, data);

        const missingRids = chunk.filter((rid: string) => !data[rid]);

        if (missingRids.length > 0) {
          convex
            .action(api.functions.trains.syncBatch, { rids: missingRids })
            .catch((err) => console.error("Failed to sync new RIDs:", err));
        }
      }
    }

    // -----------------------------
    // 📦 FILTER TO BBOX (ONLY FOR RESPONSE)
    // -----------------------------
    const trainList = allTrains.filter((t: any) => {
      const lat = t.location?.lat;
      const lon = t.location?.lon;

      if (lat == null || lon == null) return false;

      return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
    });

    const today = new Date().toISOString().split("T")[0];

    const response = {
      trains: trainList
        //.filter((t: any) => {
        //  const details = cachedDetails[t.rid];
        //  return details?.headcode || t.headcode;
        //})
        .map((t: any) => {
          const rotation =
            t.location && t.predicted_location
              ? calculateBearing(
                  t.location.lat,
                  t.location.lon,
                  t.predicted_location.lat,
                  t.predicted_location.lon
                ) : 0;

          const details = cachedDetails[t.rid] || {};
          const headcode = details.headcode ?? t.headcode;
          const displayHeadcode = headcode || "";
          let label1 = '';
          
          if (displayHeadcode && details.destination_name) {
            label1 = `${displayHeadcode} to ${details.destination_name}`;
          } else if (displayHeadcode) {
            label1 = displayHeadcode;
          } else if (details.destination_name) {
            label1 = `Service to ${details.destination_name}`;
          } else {
            label1 = "Unknown Service";
          }

          return {
            id: t.rid,
            delay: t.delay,
            location: t.location,
            rotation,
            operator: isSimpleMode ? "" : details.train_operator ?? "Loading...",
            service: isSimpleMode ? (t.headcode ?? "Loading...") : displayHeadcode,
            destination: isSimpleMode ? "N/A" : details.destination_name ?? "Loading...",
            colour:  isSimpleMode ? getTrainColour(t.delay, headcode) : getTrainColour(t.delay),

            popup_data: {
              label1: label1,
              link1: details.uid? `https://www.realtimetrains.co.uk/service/gb-nr:${details.uid}/${today}/detailed` : "#",
              label2: getDelayText(t.delay),
              log_link: `/log?service_id=${t.rid}`,
            },
            debug: isSimpleMode ? undefined : t,
          };
        }),

      buses: busData.map((b: any) => {
        const vehicleName = b.vehicle?.name || " - ";
        const [fleet_number, reg] = vehicleName.split(" - ");
        const vehicleSlug = b.vehicle?.url?.replace("/vehicles/", "") ?? "";

        return {
          id: b.trip_id,
          location: {
            lat: b.coordinates?.[1] ?? 0,
            lon: b.coordinates?.[0] ?? 0,
          },
          rotation: b.heading ?? 0,
          service: b.service?.line_name ?? "N/A",
          destination: b.destination ?? "Unknown",
          colour: b.vehicle?.colour ?? "#3B82F6",
          liveryID: b.vehicle?.livery ?? 0,
          popup_data: {
            label1: `${b.service?.line_name ?? "Bus"} to ${b.destination ?? "Unknown"}`,
            //link1: `https://bustimes.org${b.service?.url ?? ""}`,
            link1: `https://bustimes.org/trips/${b.trip_id}`,
            label2: b.vehicle?.name ?? "Unknown Bus",
            link2: `https://bustimes.org${b.vehicle?.url ?? ""}`,
            log_link: `/log?reg=${reg ?? ""}&unit=${fleet_number ?? ""}&service_id=${b.trip_id}&vehicle_slug=${vehicleSlug}`,
          },
          debug: isSimpleMode ? undefined : b,
        };
      }),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in live-vehicles API:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}