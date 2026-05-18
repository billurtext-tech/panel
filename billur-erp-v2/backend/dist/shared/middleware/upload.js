"use strict";
// File upload middleware using multer with local disk storage.
// In production with multi-instance deploy, switch to S3-compatible storage.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadDocument = void 0;
exports.uploadDir = uploadDir;
exports.fileUrl = fileUrl;
const multer_1 = __importDefault(require("multer"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const UPLOAD_DIR = process.env.UPLOAD_DIR || node_path_1.default.resolve(process.cwd(), 'uploads');
// Make sure base dirs exist
function ensureDir(p) {
    if (!node_fs_1.default.existsSync(p))
        node_fs_1.default.mkdirSync(p, { recursive: true });
}
ensureDir(UPLOAD_DIR);
ensureDir(node_path_1.default.join(UPLOAD_DIR, 'workers'));
const ALLOWED_MIME = new Set([
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        const dir = node_path_1.default.join(UPLOAD_DIR, 'workers');
        ensureDir(dir);
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const ext = node_path_1.default.extname(file.originalname || '').toLowerCase().slice(0, 8);
        const rand = node_crypto_1.default.randomBytes(8).toString('hex');
        cb(null, `${Date.now()}-${rand}${ext}`);
    },
});
exports.uploadDocument = (0, multer_1.default)({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
            return cb(new Error('Faqat JPEG/PNG/WEBP/PDF qabul qilinadi'));
        }
        cb(null, true);
    },
}).single('file');
function uploadDir() { return UPLOAD_DIR; }
/** Build a safe URL path for serving an uploaded file. */
function fileUrl(absolutePath) {
    const rel = node_path_1.default.relative(UPLOAD_DIR, absolutePath).replace(/\\/g, '/');
    return `/uploads/${rel}`;
}
//# sourceMappingURL=upload.js.map