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
        map.addControl(new maplibregl.NavigationControl());
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