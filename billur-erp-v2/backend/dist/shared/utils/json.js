"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toJsonValue = toJsonValue;
/** Coerce unknown runtime values into JSON-serializable JsonValue (omits undefined keys). */
function toJsonValue(value) {
    if (value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            if (val === undefined)
                continue;
            out[key] = toJsonValue(val);
        }
        return out;
    }
    return String(value);
}
//# sourceMappingURL=json.js.map