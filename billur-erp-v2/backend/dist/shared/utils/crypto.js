"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.generateSessionToken = generateSessionToken;
exports.generateQrToken = generateQrToken;
exports.validateQrToken = validateQrToken;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_util_1 = require("node:util");
const scryptAsync = (0, node_util_1.promisify)(node_crypto_1.default.scrypt);
const SCRYPT_KEYLEN = 64;
async function hashPassword(plain) {
    const salt = node_crypto_1.default.randomBytes(16).toString('hex');
    const hash = (await scryptAsync(plain, salt, SCRYPT_KEYLEN)).toString('hex');
    return `scrypt:${salt}:${hash}`;
}
async function verifyPassword(plain, stored) {
    if (!stored || !plain)
        return false;
    if (!stored.startsWith('scrypt:'))
        return false;
    const parts = stored.split(':');
    if (parts.length !== 3)
        return false;
    const [, salt, hashHex] = parts;
    try {
        const test = await scryptAsync(plain, salt, SCRYPT_KEYLEN);
        const stor = Buffer.from(hashHex, 'hex');
        if (stor.length !== test.length)
            return false;
        return node_crypto_1.default.timingSafeEqual(stor, test);
    }
    catch {
        return false;
    }
}
function generateSessionToken() {
    return node_crypto_1.default.randomBytes(32).toString('hex');
}
// QR token: workerId.issuedAt.nonce.hmac
function generateQrToken(workerId) {
    const secret = process.env.QR_SECRET;
    if (!secret)
        throw new Error('QR_SECRET not configured');
    const issuedAt = Math.floor(Date.now() / 1000);
    const nonce = node_crypto_1.default.randomBytes(8).toString('hex');
    const payload = `${workerId}.${issuedAt}.${nonce}`;
    const hmac = node_crypto_1.default.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
    return `${payload}.${hmac}`;
}
function validateQrToken(token) {
    const secret = process.env.QR_SECRET;
    if (!secret)
        return { valid: false, error: 'config' };
    const parts = token.split('.');
    if (parts.length !== 4)
        return { valid: false, error: 'format' };
    const [workerId, issuedAtStr, nonce, hmac] = parts;
    const expected = node_crypto_1.default.createHmac('sha256', secret)
        .update(`${workerId}.${issuedAtStr}.${nonce}`)
        .digest('hex').slice(0, 16);
    try {
        if (!node_crypto_1.default.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
            return { valid: false, error: 'hmac' };
        }
    }
    catch {
        return { valid: false, error: 'hmac' };
    }
    return { valid: true, workerId, issuedAt: parseInt(issuedAtStr) };
}
//# sourceMappingURL=crypto.js.map