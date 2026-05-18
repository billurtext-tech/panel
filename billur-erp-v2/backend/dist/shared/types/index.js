"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Conflict = exports.NotFound = exports.Forbidden = exports.Unauthorized = exports.BadRequest = exports.HttpError = void 0;
class HttpError extends Error {
    status;
    code;
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.HttpError = HttpError;
const BadRequest = (msg) => new HttpError(400, msg, 'BAD_REQUEST');
exports.BadRequest = BadRequest;
const Unauthorized = (msg = 'Tizimga kiring') => new HttpError(401, msg, 'UNAUTHORIZED');
exports.Unauthorized = Unauthorized;
const Forbidden = (msg = 'Ruxsat yo\'q') => new HttpError(403, msg, 'FORBIDDEN');
exports.Forbidden = Forbidden;
const NotFound = (msg = 'Topilmadi') => new HttpError(404, msg, 'NOT_FOUND');
exports.NotFound = NotFound;
const Conflict = (msg) => new HttpError(409, msg, 'CONFLICT');
exports.Conflict = Conflict;
//# sourceMappingURL=index.js.map