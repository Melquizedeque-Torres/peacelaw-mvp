import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-16 md:py-24">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">PeaceLaw</p>
        <h1 className="mt-3 max-w-3xl font-serif text-4xl text-slate-900 md:text-5xl">
          Resolva a disputa antes que ela vire processo
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-600">
          O PeaceLaw anonimiza o seu caso, mostra a chance de êxito segundo juízes avaliadores e conecta você a um
          advogado mediador.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className={buttonVariants()}>
            Criar conta
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            Entrar
          </Link>
        </div>
      </div>
    </section>
  );
}
