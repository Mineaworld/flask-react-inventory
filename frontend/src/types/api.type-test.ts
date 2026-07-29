import type { StockMovement } from "./api";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
  ? true
  : false;
type Expect<Value extends true> = Value;

export type StockMovementTypesMatchApi = Expect<Equal<
  StockMovement["movement_type"],
  "purchase_receipt" | "sale_issue" | "adjustment_in" | "adjustment_out"
>>;
