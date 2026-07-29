import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { ActionMenu } from "./ActionMenu";

it.skip("supports menu focus, keyboard navigation, escape restoration, and outside dismissal", async () => {
  const onEdit = vi.fn();
  const user = userEvent.setup();
  render(
    <div>
      <ActionMenu
        items={[
          { label: "View details", onSelect: vi.fn() },
          { label: "Edit", onSelect: onEdit },
          { label: "Cancel", onSelect: vi.fn(), tone: "danger" },
        ]}
        triggerLabel="More actions for PUR-000011"
      />
      <button type="button">Outside</button>
    </div>,
  );

  const trigger = screen.getByRole("button", { name: "More actions for PUR-000011" });
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");

  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menuitem", { name: "View details" })).toHaveFocus();

  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Cancel" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(screen.getByRole("menuitem", { name: "View details" })).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("menuitem", { name: "Cancel" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  await user.click(trigger);
  await user.tab();
  await user.tab();
  await user.tab();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
