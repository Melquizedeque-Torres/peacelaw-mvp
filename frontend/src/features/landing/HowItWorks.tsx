const steps = [
  {
    title: "Conte o seu caso",
    text: "Descreva a disputa em passos curtos, com o seu consentimento e, se quiser, anexos de provas.",
  },
  {
    title: "Aprove a versão anonimizada",
    text: "Nomes, CPF, telefones, endereços e valores são removidos antes de qualquer pessoa ler.",
  },
  {
    title: "Veja a chance e feche acordo",
    text: "Juízes avaliam provas e jurisprudência; um advogado mediador conduz o acordo.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-14">
      <h2 className="font-serif text-3xl text-slate-900">Como funciona</h2>
      <ol className="mt-8 grid gap-6 md:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            aria-label={`Passo ${i + 1}`}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <span aria-hidden="true" className="font-serif text-2xl text-primary-700">
              {i + 1}
            </span>
            <h3 className="font-serif text-xl text-slate-900">{step.title}</h3>
            <p className="text-sm text-slate-600">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
