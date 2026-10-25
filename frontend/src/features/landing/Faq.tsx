const items = [
  {
    q: "O PeaceLaw substitui um advogado?",
    a: "Não. Ele estima a chance de êxito e ajuda a negociar; um advogado mediador conduz o acordo.",
  },
  {
    q: "Quem vê o meu relato?",
    a: "Só você. Juízes e advogados recebem apenas o texto anonimizado que você aprovou.",
  },
  {
    q: "A chance de êxito é uma garantia?",
    a: "Não. É uma estimativa baseada nas notas dos juízes avaliadores e não garante o resultado.",
  },
  {
    q: "Posso apagar meus dados?",
    a: "Sim. Você pode apagar o relato original a qualquer momento e ele também é apagado após 180 dias do encerramento.",
  },
];

export function Faq() {
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="font-serif text-3xl text-slate-900">Perguntas frequentes</h2>
        <div className="mt-8 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {items.map((item) => (
            <details key={item.q} className="p-4">
              <summary className="cursor-pointer font-medium text-slate-900 focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:outline-none rounded-sm">{item.q}</summary>
              <p className="mt-3 text-sm text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
