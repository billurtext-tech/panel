// Static UI dropdown enums. Not data — these are options for forms.
// All actual data comes from the backend via hooks.ts.

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

// Empty arrays for backward compatibility (UI references these but they're now empty —
// real data comes from backend hooks)
export const workers: any[] = [];
export const orders: any[] = [];
export const productionStages: any[] = [];
export const inventory: any[] = [];
export const qualityDefects: any[] = [];
export const scanLogs: any[] = [];
export const clients: any[] = [];
export const workerDocuments: any[] = [];
export const payrollData: any[] = [];

export const dashboardStats = {
  activeOrders: 0,
  todayProduction: 0,
  defectRate: 0,
  activeWorkers: 0,
  packedBoxes: 0,
  delayedOrders: 0,
  warehouseStock: 0,
  surplusCount: 0,
};

export const productionChartData: any[] = [];
export const qualityChartData: any[] = [];
