import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthModal } from "./auth-modal";

describe("AuthModal", () => {
  it("is closed (no open attribute) when open=false", () => {
    render(
      <AuthModal open={false} onClose={vi.fn()} title="Sign in">
        <p>form</p>
      </AuthModal>,
    );
    expect(screen.getByText("Sign in")).not.toBeVisible();
  });

  it("does not mount its children at all while closed", () => {
    // Not cosmetic: site-header.tsx passes the real SignInForm/SignUpForm
    // here, and those hard-code id="email"/id="password"/id="displayName".
    // Mounting them while closed duplicated those ids on every page --
    // including /sign-in, whose own visible <label for="email"> then
    // resolved to this hidden copy instead of its own field. See the
    // component's own comment for the full reasoning.
    render(
      <AuthModal open={false} onClose={vi.fn()} title="Sign in">
        <input id="email" aria-label="Email" />
      </AuthModal>,
    );
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("opens and renders its content when open=true", () => {
    render(
      <AuthModal open={true} onClose={vi.fn()} title="Sign in">
        <p>form content</p>
      </AuthModal>,
    );
    expect(screen.getByText("form content")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <AuthModal open={true} onClose={onClose} title="Sign in">
        <p>form</p>
      </AuthModal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop (the dialog element itself) is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AuthModal open={true} onClose={onClose} title="Sign in">
        <p>form</p>
      </AuthModal>,
    );
    const dialog = container.querySelector("dialog")!;
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when clicking inside the dialog content", () => {
    const onClose = vi.fn();
    render(
      <AuthModal open={true} onClose={onClose} title="Sign in">
        <p>form</p>
      </AuthModal>,
    );
    fireEvent.click(screen.getByText("form"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
