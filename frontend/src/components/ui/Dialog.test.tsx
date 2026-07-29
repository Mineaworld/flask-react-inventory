import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Dialog } from "./Dialog";

const DialogHarness = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open search</button>
      <Dialog description="Find a product by name or SKU." onClose={() => setOpen(false)} open={open} title="Search products">
        <input aria-label="Search products" data-dialog-initial-focus />
        <button type="button">Second action</button>
      </Dialog>
    </>
  );
};

const TwoDialogHarness = () => {
  const [firstOpen, setFirstOpen] = useState(true);
  const [secondOpen, setSecondOpen] = useState(true);

  return (
    <>
      <Dialog onClose={() => setFirstOpen(false)} open={firstOpen} title="First dialog">
        <button type="button">First action</button>
      </Dialog>
      <Dialog onClose={() => setSecondOpen(false)} open={secondOpen} title="Second dialog">
        <button type="button">Second action</button>
      </Dialog>
    </>
  );
};

describe("Dialog", () => {
  it("moves focus inside, traps keyboard focus, closes on Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "Open search" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Search products" });
    const input = screen.getByRole("textbox", { name: "Search products" });
    const close = screen.getByRole("button", { name: "Close dialog" });

    expect(dialog).toHaveAccessibleDescription("Find a product by name or SKU.");
    expect(input).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("portals above an inert application root and restores the page when it closes", async () => {
    const user = userEvent.setup();
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.append(appRoot);
    const { unmount } = render(<DialogHarness />, { container: appRoot });

    await user.click(screen.getByRole("button", { name: "Open search" }));

    const dialog = screen.getByRole("dialog", { name: "Search products" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(appRoot).toHaveAttribute("aria-hidden", "true");
    expect(appRoot).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(appRoot).not.toHaveAttribute("aria-hidden");
    expect(appRoot).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");

    unmount();
    appRoot.remove();
  });

  it("keeps the page isolated until the final simultaneous dialog closes", async () => {
    const user = userEvent.setup();
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    document.body.append(appRoot);
    const { unmount } = render(<TwoDialogHarness />, { container: appRoot });

    expect(appRoot).toHaveAttribute("aria-hidden", "true");
    expect(appRoot).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getAllByRole("button", { name: "Close dialog" })[0]);

    expect(screen.queryByRole("dialog", { name: "First dialog" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Second dialog" })).toBeInTheDocument();
    expect(appRoot).toHaveAttribute("aria-hidden", "true");
    expect(appRoot).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(appRoot).not.toHaveAttribute("aria-hidden");
    expect(appRoot).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");

    unmount();
    appRoot.remove();
  });
});
