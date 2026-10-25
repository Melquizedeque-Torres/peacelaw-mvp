import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, badgeForCaseStatus } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each([
    ["draft", "Rascunho"],
    ["awaiting_approval", "Aguardando sua aprovação"],
    ["awaiting_judge", "Aguardando Juiz"],
    ["ready_for_agreement", "Pronto para Acordo"],
    ["in_mediation", "Em mediação"],
    ["resolved", "Acordo fechado"],
    ["anonymized", "Anonimizado"],
  ] as const)("renders the %s label", (status, label) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute("data-status", status);
    expect(badge).toHaveAttribute("data-tone", "subtle");
  });

  it("hides the icon from assistive technology", () => {
    render(<StatusBadge status="anonymized" tone="solid" />);
    const svg = screen.getByText("Anonimizado").querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes the requested tone", () => {
    render(<StatusBadge status="ready_for_agreement" tone="solid" size="sm" />);
    expect(screen.getByText("Pronto para Acordo")).toHaveAttribute("data-tone", "solid");
  });

  it.each([
    ["DRAFT", "draft"],
    ["AWAITING_APPROVAL", "awaiting_approval"],
    ["READY_FOR_JUDGE", "awaiting_judge"],
    ["EVALUATED", "ready_for_agreement"],
    ["IN_MEDIATION", "in_mediation"],
    ["RESOLVED", "resolved"],
  ] as const)("maps case status %s to badge %s", (caseStatus, badge) => {
    expect(badgeForCaseStatus(caseStatus)).toBe(badge);
  });

  it("uses a different icon for the solid anonymized badge", () => {
    const { unmount } = render(<StatusBadge status="anonymized" tone="subtle" />);
    expect(screen.getByText("Anonimizado").querySelector("svg")).toHaveClass("lucide-eye-off");
    unmount();
    render(<StatusBadge status="anonymized" tone="solid" />);
    expect(screen.getByText("Anonimizado").querySelector("svg")).toHaveClass("lucide-shield-check");
  });
});
