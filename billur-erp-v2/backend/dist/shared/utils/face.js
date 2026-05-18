"use strict";
/**
 * Face descriptor comparison for attendance verification.
 * Descriptors are 128-float arrays produced client-side (face-api.js style).
 * Uses Euclidean distance; threshold tuned for same-person match.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDescriptor = parseDescriptor;
exports.euclideanDistance = euclideanDistance;
exports.compareFaceDescriptors = compareFaceDescriptors;
const MATCH_THRESHOLD = 0.6;
function parseDescriptor(raw) {
    if (!raw)
        return null;
    if (Array.isArray(raw) && raw.every(n => typeof n === 'number')) {
        return raw;
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.every(n => typeof n === 'number')) {
                return parsed;
            }
        }
        catch { /* ignore */ }
    }
    return null;
}
function euclideanDistance(a, b) {
    if (a.length !== b.length)
        return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}
/** Returns match score 0–1 (higher = better match) and whether it passes threshold. */
function compareFaceDescriptors(enrolled, captured) {
    if (!enrolled?.length || !captured?.length) {
        return { match: false, score: 0, distance: Infinity };
    }
    const distance = euclideanDistance(enrolled, captured);
    const match = distance <= MATCH_THRESHOLD;
    const score = Math.max(0, Math.min(1, 1 - distance / MATCH_THRESHOLD));
    return { match, score, distance };
}
//# sourceMappingURL=face.js.map