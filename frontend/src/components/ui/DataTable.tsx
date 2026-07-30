import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

type DataTableProps = ComponentPropsWithoutRef<"table">;

export const DataTable = ({ className, ...props }: DataTableProps) => (
  <div className="overflow-x-auto">
    <table className={cn("min-w-full border-separate border-spacing-0 text-left text-base leading-6", className)} {...props} />
  </div>
);
