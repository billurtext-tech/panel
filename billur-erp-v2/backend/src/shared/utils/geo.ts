/** Haversine distance in meters between two WGS84 coordinates. */
export function distanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const OFFICE_LAT = 40.81538207813601;
export const OFFICE_LON = 72.73871767330503;
export const OFFICE_RADIUS_METERS = 10;

export function isWithinOfficeRadius(lat: number, lon: number): boolean {
  return distanceMeters(lat, lon, OFFICE_LAT, OFFICE_LON) <= OFFICE_RADIUS_METERS;
}
