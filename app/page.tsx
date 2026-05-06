'use client';

import { useRef, useEffect } from 'react';
import { Map } from '@/components/Map';
import maplibregl from 'maplibre-gl';

export default function Home() {
  const mapRef = useRef<any>(null);

  useEffect(() => {
    // Wait until the map component has mounted
    const checkMap = setInterval(() => {
      const map = mapRef.current?.getMap();
      if (map) {
        clearInterval(checkMap);
        
        // Now you can manipulate the map
        map.addControl(
          new maplibregl.NavigationControl({
            showCompass: false, // 👈 disables compass
            showZoom: true      // keep zoom buttons (optional)
          })
        );
        map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: true,
        }),
        'top-right'
      );
        console.log("Map interaction successful");
      }
    }, 100);
  }, []);

  return (
    <div className="h-full w-full">
      <Map ref={mapRef} />
    </div>
  );
}