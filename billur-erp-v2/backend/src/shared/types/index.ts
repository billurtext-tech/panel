import { Request } from 'express';

export interface User {
  id: string;
  username: string;
  full_name: string;
  role_id: string;
  permissions: string[];
}

/** Express request with authenticated session user. */
export interface AuthRequest extends Request {
  user?: User;
  ip_address?: string;
  device_id?: string;
  file?: Express.Multer.File;
}

export type SqlParam = string | number | boolean | Date | null;
export type SqlParams = SqlParam[];

export type JsonPrimitive =
  | string
  | number
  | boolean
  | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const BadRequest = (msg: string) => new HttpError(400, msg, 'BAD_REQUEST');
export const Unauthorized = (msg = 'Tizimga kiring') => new HttpError(401, msg, 'UNAUTHORIZED');
export const Forbidden = (msg = 'Ruxsat yo\'q') => new HttpError(403, msg, 'FORBIDDEN');
export const NotFound = (msg = 'Topilmadi') => new HttpError(404, msg, 'NOT_FOUND');
export const Conflict = (msg: string) => new HttpError(409, msg, 'CONFLICT');
