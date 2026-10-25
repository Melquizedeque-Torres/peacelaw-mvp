import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

const cardClass = "flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm";

export function ForProfessionals() {
  return (
    <section aria-label="Para quem é" className="mx-auto max-w-5xl px-4 py-14">
      <div className="grid gap-6 md:grid-cols-3">
        <div className={cardClass}>
          <h2 className="font-serif text-xl text-slate-900">Sou cliente</h2>
          <p className="text-sm text-slate-600">Envie seu caso e acompanhe a análise.</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              Entrar
            </Link>
            <Link href="/register" className={buttonVariants()}>
              Criar conta
            </Link>
          </div>
        </div>
        <div className={cardClass}>
          <h2 className="font-serif text-xl text-slate-900">Sou juiz avaliador</h2>
          <p className="text-sm text-slate-600">Avalie casos anonimizados e contribua para a chance de êxito.</p>
          <div className="mt-auto">
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              Entrar
            </Link>
          </div>
        </div>
        <div className={cardClass}>
          <h2 className="font-serif text-xl text-slate-900">Sou advogado mediador</h2>
          <p className="text-sm text-slate-600">Escolha casos avaliados e conduza o acordo.</p>
          <div className="mt-auto">
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              Entrar
            </Link>
          </div>
        </div>
      </div>
      <p className="mt-6 text-sm text-slate-600">
        Contas de juiz e advogado são criadas pela plataforma; apenas clientes podem se cadastrar.
      </p>
    </section>
  );
}
