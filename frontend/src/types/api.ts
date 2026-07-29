export type Role = "admin" | "manager" | "staff";

export type SessionUser = {
  id: number;
  username: string;
  full_name: string;
  role: Role;
};

export type LowStockItem = {
  product_id: number;
  product_name: string;
  quantity: string;
  reorder_level: string;
  unit: string;
};

export type StockMovement = {
  id: number;
  product_id: number;
  product_name: string | null;
  movement_type: "purchase_receipt" | "sale_issue" | "adjustment_in" | "adjustment_out";
  quantity_delta: string;
  unit_cost_usd: string | null;
  reason: string | null;
  purchase_id: number | null;
  sale_id: number | null;
  created_by_id: number | null;
  created_at: string;
};

export type DashboardRange = "today" | "week" | "month";

export type DashboardActivity = {
  date: string;
  purchases_usd: string;
  sales_usd: string;
};

export type ProductSearchResult = {
  id: number;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: number | null;
  category_name: string | null;
  unit: string;
  reorder_level: string;
  default_sale_price_usd: string;
  is_active: boolean;
};

export type Category = {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Product = ProductSearchResult & {
  default_cost_usd?: string;
  created_at: string;
  updated_at: string;
};

export type Partner = {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SaleCustomerPicker = {
  id: number;
  name: string;
  code: string;
};

export type StockRecord = {
  product_id: number;
  product_name: string;
  sku: string;
  unit: string;
  quantity: string;
  reorder_level: string;
  updated_at: string | null;
};

export type DashboardData = {
  low_stock_count: number;
  low_stock: LowStockItem[];
  period_days?: number;
  own_draft_sale_count?: number;
  stock_value_usd?: string;
  sales_total_usd?: string;
  purchases_total_usd?: string;
  activity?: DashboardActivity[];
  sales_total_usd_last_30_days?: string;
  purchases_total_usd_last_30_days?: string;
  draft_purchase_count?: number;
  draft_sale_count?: number;
  latest_movements?: StockMovement[];
};

export type Currency = "USD" | "KHR";
export type PurchaseStatus = "draft" | "received" | "cancelled";
export type SaleStatus = "draft" | "completed" | "cancelled";

export type PurchaseItem = {
  id: number;
  product_id: number;
  product_name: string | null;
  quantity: string;
  unit_cost: string;
  unit_cost_usd: string;
  line_total: string;
  line_total_usd: string;
};

export type Purchase = {
  id: number;
  document_number: string;
  supplier_id: number;
  supplier_name: string | null;
  status: PurchaseStatus;
  currency: Currency;
  exchange_rate_to_usd: string;
  total_amount: string;
  total_usd: string;
  notes: string | null;
  created_by: SessionUser | null;
  received_by: SessionUser | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
  items: PurchaseItem[];
};

export type SaleItem = {
  id: number;
  product_id: number;
  product_name: string | null;
  quantity: string;
  unit_price: string;
  unit_price_usd: string;
  line_total: string;
  line_total_usd: string;
};

export type Sale = {
  id: number;
  document_number: string;
  customer_id: number | null;
  customer_name: string | null;
  status: SaleStatus;
  currency: Currency;
  exchange_rate_to_usd: string;
  total_amount: string;
  total_usd: string;
  notes: string | null;
  created_by: SessionUser | null;
  completed_by: SessionUser | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  items: SaleItem[];
};
