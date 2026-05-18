// UI form options only — barcha real ma'lumotlar API dan keladi (hooks.ts).

export const departments = [
  "Cutting",
  "Printing",
  "Sewing",
  "Quality",
  "Ironing",
  "Tagging",
  "Packing",
  "Warehouse",
  "Administration",
] as const;

export const productionLines = [
  "Line A",
  "Line B",
  "Line C",
  "Line D",
] as const;

export const positions = [
  "Machine Operator",
  "Senior Operator",
  "Cutting Specialist",
  "Quality Inspector",
  "Ironing Specialist",
  "Packing Worker",
  "Line Supervisor",
  "Shift Manager",
] as const;
