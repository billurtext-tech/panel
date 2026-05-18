"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueryString = getQueryString;
exports.getOptionalQueryString = getOptionalQueryString;
function getQueryString(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return String(value[0] ?? '');
    }
    return '';
}
function getOptionalQueryString(value) {
    const v = getQueryString(value);
    return v || undefined;
}
//# sourceMappingURL=query.js.map