// Order parsers for SET and Speka order types.

import { pool } from '../../shared/database/pool';
import { BadRequest } from '../../shared/types';

// ──────────────────────────────────────────────────────────────────────────
// SET code parser
// Format:  SET{number}-{model}-{color}-{size}
// Examples:
//   SET86288828-LRTT-275-BLU-XL    (model has hyphens: LRTT-275)
//   SET12345-SHIRT001-RED-M
//
// Strategy: anchor on SET-prefix and trailing size; everything between
// must be split as model + color. We look up models from DB to find the
// longest matching code.
// ──────────────────────────────────────────────────────────────────────────
export interface ParsedSet {
  set_number: string;
  model_code: string;
  color_code: string;
  size_code: string;
  raw: string;
}

export async function parseSetCode(rawCode: string): Promise<ParsedSet> {
  const code = (rawCode || '').trim().toUpperCase();
  const m = /^SET([0-9A-Z]+)-(.+)$/.exec(code);
  if (!m) throw BadRequest(`SET kod formati noto'g'ri: ${code}`);

  const setNumber = m[1];
  const rest = m[2]; // e.g. "LRTT-275-BLU-XL"

  // Try to match against existing models in the DB to find the longest model code
  // that's a prefix of `rest` (case-insensitive).
  const models = await pool.query(
    `SELECT code FROM models ORDER BY length(code) DESC`
  );

  let matched: { model: string; remainder: string } | null = null;
  for (const row of models.rows) {
    const mc = String(row.code).toUpperCase();
    if (rest === mc) {
      matched = { model: mc, remainder: '' };
      break;
    }
    if (rest.startsWith(mc + '-')) {
      matched = { model: mc, remainder: rest.substring(mc.length + 1) };
      break;
    }
  }

  if (!matched) {
    // Fallback: split by last two hyphens — assume `..MODEL..-COLOR-SIZE`
    const parts = rest.split('-');
    if (parts.length < 3) throw BadRequest(`SET kod parse qilinmadi: ${code}`);
    const size = parts.pop()!;
    const color = parts.pop()!;
    const model = parts.join('-');
    return { set_number: setNumber, model_code: model, color_code: color, size_code: size, raw: rawCode };
  }

  // remainder is like "BLU-XL" — split last hyphen
  const parts = matched.remainder.split('-');
  if (parts.length < 2) throw BadRequest(`SET kod color va size aniqlanmadi: ${code}`);
  const size = parts.pop()!;
  const color = parts.join('-');

  return {
    set_number: setNumber,
    model_code: matched.model,
    color_code: color,
    size_code: size,
    raw: rawCode,
  };
}

/** Parse multiple SET codes (bulk-create scenario). */
export async function parseSetCodes(rawCodes: string[]): Promise<ParsedSet[]> {
  const out: ParsedSet[] = [];
  for (const c of rawCodes) {
    out.push(await parseSetCode(c));
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Speka order: multi-model, multi-color, multi-size with size breakdown
//
// Input shape:
// {
//   client_id, deadline, priority,
//   speka_number,
//   items: [
//     { model_code, color_code, size_breakdown: { "S": 50, "M": 100, "L": 80 } },
//     ...
//   ]
// }
// ──────────────────────────────────────────────────────────────────────────
export interface SpekaItemInput {
  model_code: string;
  color_code: string;
  size_breakdown: Record<string, number>;
}

export interface SpekaParsed {
  external_code: string;
  items_to_create: Array<{
    model_id: string;
    color_id: string;
    size_id: string;
    quantity: number;
  }>;
}

export async function parseSpekaOrder(opts: {
  speka_number?: string;
  items: SpekaItemInput[];
}): Promise<SpekaParsed> {
  if (!Array.isArray(opts.items) || !opts.items.length) {
    throw BadRequest("Speka kamida 1 item bo'lishi kerak");
  }

  const out: SpekaParsed = {
    external_code: opts.speka_number ? `SPEKA-${opts.speka_number}` : `SPEKA-${Date.now()}`,
    items_to_create: [],
  };

  for (const item of opts.items) {
    const m = await pool.query(`SELECT id FROM models WHERE UPPER(code) = $1`,
      [item.model_code.toUpperCase()]);
    if (!m.rows.length) throw BadRequest(`Model topilmadi: ${item.model_code}`);

    const c = await pool.query(`SELECT id FROM colors WHERE UPPER(code) = $1 OR UPPER(name_uz) = $1`,
      [item.color_code.toUpperCase()]);
    if (!c.rows.length) throw BadRequest(`Rang topilmadi: ${item.color_code}`);

    for (const [sizeCode, qty] of Object.entries(item.size_breakdown || {})) {
      if (!qty || qty < 1) continue;
      const s = await pool.query(`SELECT id FROM sizes WHERE UPPER(code) = $1`,
        [sizeCode.toUpperCase()]);
      if (!s.rows.length) throw BadRequest(`O'lcham topilmadi: ${sizeCode}`);

      out.items_to_create.push({
        model_id: m.rows[0].id,
        color_id: c.rows[0].id,
        size_id: s.rows[0].id,
        quantity: qty,
      });
    }
  }

  if (!out.items_to_create.length) {
    throw BadRequest("Speka'da hech bir size breakdown ko'rsatilmagan");
  }

  return out;
}
