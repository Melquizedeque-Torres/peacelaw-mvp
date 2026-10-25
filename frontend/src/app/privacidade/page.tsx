import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de privacidade | PeaceLaw",
  description: "Como o PeaceLaw trata seus dados pessoais, conforme a LGPD.",
};

const RETENTION_DAYS = 180;

const sectionClass = "mt-8 space-y-3";
const h2Class = "font-serif text-xl text-slate-900";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-slate-700">
      <p
        role="note"
        className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
      >
        Minuta — sujeita a revisão jurídica
      </p>
      <h1 className="mt-6 font-serif text-3xl text-slate-900">Política de privacidade</h1>
      <p className="mt-3 text-sm">
        Este aviso explica como o PeaceLaw trata seus dados pessoais, em conformidade com a Lei Geral
        de Proteção de Dados (Lei 13.709/2018, LGPD).
      </p>

      <section className={sectionClass}>
        <h2 className={h2Class}>Controlador e encarregado (DPO)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            Controlador: <strong>[Razão social do controlador]</strong> (a preencher)
          </li>
          <li>
            Encarregado pelo tratamento de dados (DPO): <strong>[e-mail do encarregado]</strong> (a
            preencher)
          </li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Dados coletados</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Dados de conta: e-mail e senha (armazenada apenas como hash).</li>
          <li>
            Dados do caso: título e relato que você escreve, que podem conter dados pessoais e dados
            sensíveis, além das avaliações feitas por juízes e advogados.
          </li>
          <li>
            Arquivos anexados ao caso (PDF, JPG, PNG ou TXT, até 5 arquivos de 2,5 MB cada), que
            podem conter dados pessoais e dados sensíveis.
          </li>
          <li>Registro do consentimento: data e versão do texto aceito.</li>
          <li>
            Texto anonimizado e avaliações do caso (prazos na seção Retenção).
          </li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Finalidades</h2>
        <p className="text-sm">
          Seus dados são tratados exclusivamente para a análise do seu caso, a avaliação por juízes
          avaliadores e a mediação por advogados. Não são usados para publicidade nem vendidos a
          terceiros.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Bases legais</h2>
        <p className="text-sm">
          Consentimento do titular: art. 7º, I, da LGPD para dados pessoais e art. 11, I, para dados
          sensíveis. O consentimento é dado de forma específica ao enviar o caso e pode ser revogado a
          qualquer momento.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Anonimização antes de terceiros</h2>
        <p className="text-sm">
          A anonimização é automática e busca remover do relato dados pessoais como nomes, CPF,
          telefones, e-mails e valores. Ela pode falhar em alguns casos (por exemplo, nomes isolados,
          apelidos), por isso você revisa e aprova a versão anonimizada antes que juízes ou advogados a
          vejam. Somente você vê o relato original.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Segurança e criptografia</h2>
        <p className="text-sm">
          O relato original é armazenado criptografado em repouso. O acesso é restrito ao titular do
          caso e as sessões usam cookies protegidos.
        </p>
        <p className="text-sm">
          Os arquivos anexados também são armazenados criptografados em repouso e só podem ser lidos
          por você. Eles nunca são exibidos a juízes ou advogados, que apenas veem quantos arquivos
          foram anexados.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Dados tratados para segurança</h2>
        <p className="text-sm">
          Para prevenção de abuso, tratamos o endereço IP e as tentativas de login, mantidos apenas em
          memória por até 1 hora.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Retenção</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            {`O relato original é apagado por rotina periódica após ${RETENTION_DAYS} dias do último andamento de casos encerrados. Você pode apagá-lo antes, a qualquer momento. Cópias residuais em backups/históricos técnicos são eliminadas conforme os ciclos de retenção desses sistemas.`}
          </li>
          <li>
            Os arquivos anexados são apagados junto com o relato original, a seu pedido ou após os
            mesmos {RETENTION_DAYS} dias.
          </li>
          <li>
            O texto anonimizado e as avaliações são mantidos enquanto o caso estiver ativo e pelo prazo
            necessário ao exercício regular de direitos.
          </li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Seus direitos (art. 18 da LGPD)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Acesso aos seus dados;</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>Eliminação dos dados tratados com consentimento;</li>
          <li>
            Revogação do consentimento: apagar o relato original no aplicativo e/ou excluir o caso
            enquanto ele não tiver sido avaliado.
          </li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={h2Class}>Como exercer seus direitos</h2>
        <p className="text-sm">
          Pelo aplicativo, use a opção de apagar o relato original ou de excluir o caso (enquanto não
          avaliado) na página do seu caso. Para os demais pedidos, entre em contato com o encarregado
          pelo e-mail <strong>[e-mail do encarregado]</strong> (a preencher).
        </p>
        <p className="text-sm">
          A versão anonimizada já compartilhada com avaliadores e mediadores é mantida para a
          integridade da avaliação.
        </p>
      </section>

      <p className="mt-10 text-sm">
        <Link href="/" className="text-primary-700 underline underline-offset-2">
          Voltar ao início
        </Link>
      </p>
    </main>
  );
}
