"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICE_RADIUS_METERS = exports.OFFICE_LON = exports.OFFICE_LAT = void 0;
exports.distanceMeters = distanceMeters;
exports.isWithinOfficeRadius = isWithinOfficeRadius;
/** Haversine distance in meters between two WGS84 coordinates. */
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
exports.OFFICE_LAT = 40.81538207813601;
exports.OFFICE_LON = 72.73871767330503;
exports.OFFICE_RADIUS_METERS = 10;
function isWithinOfficeRadius(lat, lon) {
    return distanceMeters(lat, lon, exports.OFFICE_LAT, exports.OFFICE_LON) <= exports.OFFICE_RADIUS_METERS;
}
//# sourceMappingURL=geo.js.map