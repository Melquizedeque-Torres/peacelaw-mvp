import { ProbabilityCard, StatusBadge, UploadZone } from "@/components/design-system";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Design System · PeaceLaw" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[.08em] text-primary-500 uppercase">PeaceLaw</span>
        <h1 className="font-serif text-3xl text-slate-900">Design System PeaceLaw</h1>
        <p className="text-slate-600">Tokens Safira e Sálvia, tipografia Inter e Lora e os componentes base do MVP.</p>
      </header>

      <Section title="Botões">
        <div className="flex flex-wrap gap-3">
          <Button>Ação principal</Button>
          <Button variant="secondary">Confirmar acordo</Button>
          <Button variant="outline">Voltar</Button>
          <Button variant="destructive">Excluir</Button>
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="draft" />
          <StatusBadge status="awaiting_approval" />
          <StatusBadge status="awaiting_judge" />
          <StatusBadge status="ready_for_agreement" />
          <StatusBadge status="in_mediation" />
          <StatusBadge status="resolved" />
          <StatusBadge status="anonymized" />
          <StatusBadge status="anonymized" tone="solid" />
        </div>
      </Section>

      <Section title="Probabilidade de êxito">
        <ProbabilityCard
          score={85}
          caseLabel="Caso nº 2026-0418 · Rescisão contratual"
          factors={[
            { direction: "up", label: "Jurisprudência favorável em casos semelhantes" },
            { direction: "up", label: "Contrato e comprovantes de pagamento anexados" },
            { direction: "down", label: "Ausência de notificação formal por escrito" },
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <ProbabilityCard score={70} />
          <ProbabilityCard score={40} />
        </div>
      </Section>

      <Section title="Upload seguro">
        <UploadZone />
      </Section>
    </main>
  );
}
