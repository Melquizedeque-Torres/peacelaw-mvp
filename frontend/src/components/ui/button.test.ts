import { describe, expect, it } from "vitest";

import { buttonVariants } from "./button";

describe("buttonVariants", () => {
  it("keeps the sm size classes as separate tokens", () => {
    const tokens = buttonVariants({ size: "sm" }).split(/\s+/);
    expect(tokens).toContain("has-data-[icon=inline-start]:pl-2");
    expect(tokens).toContain("[&_svg:not([class*='size-'])]:size-3.5");
  });
});
