import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DesignSystemPage from "./page";

describe("/design-system", () => {
  it("renders every design-system component", () => {
    render(<DesignSystemPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Design System PeaceLaw" })).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.getByText("Aguardando sua aprovação")).toBeInTheDocument();
    expect(screen.getByText("Em mediação")).toBeInTheDocument();
    expect(screen.getByText("Acordo fechado")).toBeInTheDocument();
    expect(screen.getByText("Aguardando Juiz")).toBeInTheDocument();
    expect(screen.getByText("Pronto para Acordo")).toBeInTheDocument();
    expect(screen.getAllByText("Anonimizado").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "Score 85 por cento, probabilidade alta" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 70 por cento, probabilidade média" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 40 por cento, probabilidade baixa" })).toBeInTheDocument();
    expect(screen.getByLabelText("Selecionar arquivos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ação principal" })).toBeInTheDocument();
  });
});
