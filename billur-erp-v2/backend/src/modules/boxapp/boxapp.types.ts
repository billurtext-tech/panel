import type { JsonValue } from '../../shared/types';

export interface BoxSyncRecord {
  uid: string;
  box_num?: number | string | null;
  order_id?: string | null;
  zakaz?: string | null;
  type?: string | null;
  model?: string | null;
  color?: string | null;
  kg?: number | string | null;
  status?: string | null;
  sizes?: JsonValue;
  items?: JsonValue;
  created_by_name?: string | null;
  created_at?: string | Date | null;
}

export interface ShipmentSyncRecord {
  id: string;
  client_id?: string | null;
  truck_info?: string | null;
  box_uids?: string[] | null;
  status?: string | null;
  created_at?: string | Date | null;
  [key: string]: JsonValue | string | string[] | Date | null | undefined;
}

export interface RemoteApiResponse {
  id?: string;
  uid?: string;
  raw?: string;
  [key: string]: unknown;
}
