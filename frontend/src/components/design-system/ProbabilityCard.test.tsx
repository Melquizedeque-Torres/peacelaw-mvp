import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProbabilityCard, clampScore, formatScore, tierFor } from "./ProbabilityCard";

describe("tierFor", () => {
  it.each([
    [0, "low"],
    [59, "low"],
    [60, "mid"],
    [79, "mid"],
    [80, "high"],
    [100, "high"],
  ] as const)("score %d is %s", (score, tier) => {
    expect(tierFor(score)).toBe(tier);
  });
});

describe("clampScore", () => {
  it.each([
    [84.6, 84.6],
    [79.96, 79.9],
    [120, 100],
    [-5, 0],
    [Number.NaN, 0],
  ])("clamps %d to %d", (input, expected) => {
    expect(clampScore(input)).toBe(expected);
  });
});

describe("formatScore", () => {
  it.each([
    [79.6, "79,6"],
    [80, "80"],
    [85, "85"],
    [0, "0"],
    [140, "100"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatScore(input)).toBe(expected);
  });
});

describe("ProbabilityCard", () => {
  it("shows one decimal with a comma and keeps the tier from the raw score", () => {
    render(<ProbabilityCard score={79.6} />);
    expect(screen.getByText("79,6%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 79,6 por cento, probabilidade média" })).toBeInTheDocument();
  });

  it("replaces the statistical disclaimer with a custom note", () => {
    render(<ProbabilityCard score={70} note="Prévia calculada a partir das suas notas." />);
    expect(screen.getByText("Prévia calculada a partir das suas notas.")).toBeInTheDocument();
    expect(screen.queryByText(/Estimativa estatística/)).not.toBeInTheDocument();
  });

  it("shows the score with an accessible description of the tier", () => {
    render(<ProbabilityCard score={85} />);
    expect(screen.getByRole("img", { name: "Score 85 por cento, probabilidade alta" })).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("Seu caso tem boas chances")).toBeInTheDocument();
  });

  it("uses the mid tier copy between 60 and 79", () => {
    render(<ProbabilityCard score={70} />);
    expect(screen.getByRole("img", { name: "Score 70 por cento, probabilidade média" })).toBeInTheDocument();
    expect(screen.getByText("Seu caso tem chances moderadas")).toBeInTheDocument();
  });

  it("uses the high-risk client copy below 60", () => {
    render(<ProbabilityCard score={40} />);
    expect(screen.getByText("Seu caso tem risco alto")).toBeInTheDocument();
  });

  it("speaks to professionals when audience is professional", () => {
    render(<ProbabilityCard score={85} audience="professional" />);
    expect(screen.getByText("Alta probabilidade de êxito no Judiciário")).toBeInTheDocument();
    expect(screen.queryByText("Seu caso tem boas chances")).not.toBeInTheDocument();
  });

  it("clamps out-of-range scores before rendering", () => {
    render(<ProbabilityCard score={140} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("lists the factors and the case label when provided", () => {
    render(
      <ProbabilityCard
        score={24}
        caseLabel="Caso nº 2026-0418 · Rescisão contratual"
        factors={[
          { direction: "up", label: "Contrato anexado" },
          { direction: "down", label: "Sem notificação formal" },
        ]}
      />,
    );
    expect(screen.getByText("Caso nº 2026-0418 · Rescisão contratual")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Fatores considerados" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("omits the factors section when there are none", () => {
    render(<ProbabilityCard score={24} />);
    expect(screen.queryByRole("list", { name: "Fatores considerados" })).not.toBeInTheDocument();
  });

  it("always shows the non-binding disclaimer", () => {
    render(<ProbabilityCard score={70} />);
    expect(
      screen.getByText("Estimativa estatística baseada em decisões similares. Não constitui decisão judicial."),
    ).toBeInTheDocument();
  });

  it("keeps factor list ids distinct when several cards share a page", () => {
    const factors = [{ direction: "up" as const, label: "Contrato anexado" }];
    render(
      <>
        <ProbabilityCard score={85} factors={factors} />
        <ProbabilityCard score={24} factors={factors} />
      </>,
    );
    const lists = screen.getAllByRole("list", { name: "Fatores considerados" });
    expect(lists).toHaveLength(2);
    const ids = lists.map((list) => list.getAttribute("aria-labelledby"));
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("tolerates repeated factor labels", () => {
    render(
      <ProbabilityCard
        score={50}
        factors={[
          { direction: "up", label: "Igual" },
          { direction: "down", label: "Igual" },
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
