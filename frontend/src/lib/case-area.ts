export const CASE_AREAS = [
  "CONSUMIDOR",
  "CIVIL",
  "TRABALHISTA",
  "FAMILIA",
  "ALUGUEL",
  "EMPRESARIAL",
  "OUTROS",
] as const;

export type CaseArea = (typeof CASE_AREAS)[number];

export const AREA_LABEL: Record<CaseArea, string> = {
  CONSUMIDOR: "Consumidor",
  CIVIL: "Civil",
  TRABALHISTA: "Trabalhista",
  FAMILIA: "Família",
  ALUGUEL: "Aluguel",
  EMPRESARIAL: "Empresarial",
  OUTROS: "Outros",
};
