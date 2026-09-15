import type { ComponentProps } from "react";

const variants = {
  primary: "border-transparent bg-button text-white hover:bg-button-hover",
  secondary: "border-edge bg-transparent text-ink hover:bg-raised",
};

/**
 * Graphite, square, weight 600. The brand fills its buttons from the grey ramp
 * and keeps blue for links, so that the one blue thing on a screen is always
 * the thing you navigate to. There is deliberately no blue variant.
 *
 * `secondary` is the same geometry unfilled, for the lesser of two choices
 * (Deny beside Approve). Both carry a 1px border so the two line up.
 */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={`border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
