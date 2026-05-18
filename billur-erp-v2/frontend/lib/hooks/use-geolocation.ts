"use client";

import { useState, useCallback } from "react";

const OFFICE_LAT = 40.81538207813601;
const OFFICE_LON = 72.73871767330503;
const MAX_RADIUS_M = 10;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useGeolocation() {
  const [coords, setCoords] = useState<{ lat: number; lon: number; distance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Geolokatsiya qo'llab-quvvatlanmaydi"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const dist = distanceMeters(lat, lon, OFFICE_LAT, OFFICE_LON);
      if (dist > MAX_RADIUS_M) {
        setError(`Ofis hududidan ${Math.round(dist)}m uzoqdasiz (max ${MAX_RADIUS_M}m)`);
        setCoords({ lat, lon, distance: dist });
        return null;
      }
      const result = { lat, lon, distance: dist };
      setCoords(result);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Joylashuv olinmadi";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { coords, error, loading, requestLocation, isInRange: coords ? coords.distance <= MAX_RADIUS_M : false };
}
