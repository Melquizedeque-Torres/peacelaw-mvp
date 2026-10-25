import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("design tokens", () => {
  it.each([
    ["--color-primary-700", "#183A6E"],
    ["--color-primary-50", "#EEF3FB"],
    ["--color-sage-600", "#4A7556"],
    ["--color-danger-600", "#9A3A34"],
    ["--color-warning-600", "#946A1E"],
  ])("defines %s as %s", (token, hex) => {
    expect(css).toMatch(new RegExp(`${token}:\\s*${hex};`, "i"));
  });

  it.each([
    ["--primary", "#183A6E"],
    ["--secondary", "#4A7556"],
    ["--ring", "#4A78C0"],
    ["--destructive", "#9A3A34"],
  ])("maps shadcn %s to %s in :root", (variable, value) => {
    const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
    expect(root).toContain(`${variable}: ${value};`);
  });

  it.each([
    "--color-success: var(--success);",
    "--color-warning: var(--warning);",
    "--font-sans: var(--font-inter);",
    "--font-serif: var(--font-lora);",
  ])("maps theme line %s", (line) => {
    expect(css).toContain(line);
  });

  it("does not reference the unloaded Geist Mono font", () => {
    expect(css).not.toContain("--font-geist-mono");
  });
});
