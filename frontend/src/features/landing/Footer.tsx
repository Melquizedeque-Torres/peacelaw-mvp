import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-600">
        <p>PeaceLaw · versão de demonstração (MVP)</p>
        <Link href="/privacidade" className="text-primary-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:outline-none rounded-sm">
          Política de privacidade
        </Link>
      </div>
    </footer>
  );
}
