import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rid = searchParams.get("rid");
  const trip_id = searchParams.get("trip_id");

  try {
    if (rid) {
      // --- TRAIN DATA FETCH ---
      const [routeRes, infoRes] = await Promise.all([
        fetch(`https://map-api.production.signalbox.io/api/route/${rid}`),
        fetch(`https://map-api.production.signalbox.io/api/train-information/${rid}`)
      ]);

      if (!routeRes.ok || !infoRes.ok) throw new Error("Train data not found");
      const routeData = await routeRes.json();
      const infoData = await infoRes.json();

      return NextResponse.json({
        type: "train",
        id: rid,
        service: infoData.headcode,
        operator: infoData.train_operator,
        destination: infoData.destination_name,
        path: routeData.coordinates || [],
        snapped: true 
      });

    } else if (trip_id) {
      // --- BUS DATA FETCH ---
      const res = await fetch(`https://bustimes.org/api/trips/${trip_id}/`);
      if (!res.ok) throw new Error("Bus data not found");
      const data = await res.json();

      // 1. Flatten the fragmented tracks from the times array
      let fullPath: any[] = [];
      if (Array.isArray(data.times)) {
        data.times.forEach((t: any) => {
          if (Array.isArray(t.track)) {
            fullPath.push(...t.track);
          }
        });
      }

      // 2. Determine snapped status: if we collected any points from tracks, it's snapped
      const isSnapped = fullPath.length > 0;

      // 3. Fallback: If no tracks were found, use stop locations
      if (!isSnapped && Array.isArray(data.times)) {
        fullPath = data.times.map((t: any) => t.stop.location);
      }
      
      return NextResponse.json({
        type: "bus",
        id: trip_id,
        path: fullPath,
        snapped: isSnapped
      });
    }

    return NextResponse.json({ error: "Missing rid or trip_id" }, { status: 400 });
  } catch (error) {
    console.error("Proxy Error:", error);
    return NextResponse.json({ error: "Failed to fetch route info" }, { status: 500 });
  }
}