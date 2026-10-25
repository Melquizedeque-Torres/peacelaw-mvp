import Link from "next/link";

const promises = [
  {
    title: "Anonimização antes de terceiros",
    text: "Juízes e advogados só veem o texto anonimizado que você aprovou.",
  },
  {
    title: "Relato original criptografado e só seu",
    text: "O relato original e os anexos ficam criptografados e visíveis apenas para você.",
  },
  {
    title: "Apagado a pedido ou após 180 dias",
    text: "Você pode apagar o relato original quando quiser; ele também é apagado 180 dias após o encerramento do caso.",
  },
];

export function PrivacyPromises() {
  return (
    <section className="border-y border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="font-serif text-3xl text-slate-900">Privacidade desde o desenho</h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-3">
          {promises.map((p) => (
            <li key={p.title} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-serif text-xl text-slate-900">{p.title}</h3>
              <p className="text-sm text-slate-600">{p.text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm">
          <Link href="/privacidade" className="text-primary-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:outline-none rounded-sm">
            Política de privacidade
          </Link>
        </p>
      </div>
    </section>
  );
}
