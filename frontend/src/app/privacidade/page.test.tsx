import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PrivacyPage from "./page";

describe("/privacidade", () => {
  it("renders the notice headings, placeholders and the draft note", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Política de privacidade" })).toBeInTheDocument();
    for (const name of [
      "Controlador e encarregado (DPO)",
      "Dados coletados",
      "Finalidades",
      "Bases legais",
      "Anonimização antes de terceiros",
      "Segurança e criptografia",
      "Dados tratados para segurança",
      "Retenção",
      "Seus direitos (art. 18 da LGPD)",
      "Como exercer seus direitos",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText("Minuta — sujeita a revisão jurídica")).toBeInTheDocument();
    expect(screen.getByText("[Razão social do controlador]")).toBeInTheDocument();
    expect(screen.getAllByText("[e-mail do encarregado]").length).toBeGreaterThan(0);
  });

  it("does not overclaim anonymization and states the retention rules", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/busca remover/)).toBeInTheDocument();
    expect(screen.getByText(/nomes isolados, apelidos/)).toBeInTheDocument();
    expect(screen.getByText(/revisa e aprova a versão anonimizada antes/)).toBeInTheDocument();
    expect(screen.queryByText(/removidos do relato antes/)).not.toBeInTheDocument();
    expect(screen.getByText(/apagado por rotina periódica após 180 dias do último andamento de casos encerrados/)).toBeInTheDocument();
    expect(screen.getByText(/backups\/históricos técnicos são eliminadas conforme os ciclos de retenção/)).toBeInTheDocument();
    expect(screen.getByText(/mantida para a integridade da avaliação/)).toBeInTheDocument();
    expect(screen.getByText(/mantidos apenas em memória por até 1 hora/)).toBeInTheDocument();
    expect(screen.getByText(/exercício regular de direitos/)).toBeInTheDocument();
  });
});

describe("/privacidade attachments", () => {
  it("explains how attached files are stored, shown and erased", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/Arquivos anexados ao caso/)).toBeInTheDocument();
    expect(screen.getByText(/anexados também são armazenados criptografados em repouso e só podem ser lidos por você/)).toBeInTheDocument();
    expect(screen.getByText(/nunca são exibidos a juízes ou advogados, que apenas veem quantos arquivos/)).toBeInTheDocument();
    expect(screen.getByText(/apagados junto com o relato original, a seu pedido ou após os mesmos 180 dias/)).toBeInTheDocument();
  });
});
