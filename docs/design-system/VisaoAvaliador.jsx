import React, { useRef, useState } from "react";
import { ShieldCheck, FileText, Check, Minus, Plus, Send, ArrowRight } from "lucide-react";

/* Visão do Avaliador (Juiz aposentado) — WCAG AAA
   Texto mínimo 18px, contraste ≥ 7:1 (slate-900/slate-700 sobre branco e slate-100),
   alvos ≥ 56px, foco sempre visível, nenhuma digitação. */

const SIZES = [18, 20, 22, 24, 26, 28, 32];
const BASE_IDX = 2; // 22px
const RISK = [
  { v: "baixo", label: "Baixo", desc: "Decisões semelhantes são, em sua maioria, favoráveis ao demandante." },
  { v: "medio", label: "Médio", desc: "Há decisões relevantes nos dois sentidos." },
  { v: "alto", label: "Alto", desc: "Decisões semelhantes são, em sua maioria, desfavoráveis." },
];
const REC = [
  { v: "sim", label: "Sim", desc: "O caso tem bons elementos para uma negociação." },
  { v: "nao", label: "Não", desc: "Um acordo é improvável ou desaconselhável." },
];
const proofWord = (v) => (v <= 3 ? "Frágeis" : v <= 6 ? "Moderadas" : v <= 8 ? "Sólidas" : "Muito sólidas");
const clamp = (v) => Math.max(1, Math.min(10, v));
const cx = (...c) => c.filter(Boolean).join(" ");
const RING = "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#183A6E] focus-visible:ring-offset-[3px]";

const Protected = () => (
  <span aria-label="Dado protegido"
    className="inline-block whitespace-nowrap rounded bg-slate-900 px-[.5em] align-[.1em] font-['Inter'] text-[.72em] font-semibold leading-[1.7] tracking-[.04em] text-white">
    [DADO PROTEGIDO]
  </span>
);

/* ---------- Documento (painel esquerdo) ---------- */
function CaseDocument() {
  const [idx, setIdx] = useState(BASE_IDX);
  const fs = SIZES[idx];
  const H2 = ({ children }) => <h2 className="mb-[.5em] font-['Lora'] text-[1.15em] font-bold leading-snug">{children}</h2>;

  return (
    <article aria-label="Documento do caso" className="min-w-0 flex-[3_1_0] bg-white">
      <div role="toolbar" aria-label="Tamanho do texto"
        className="sticky top-[76px] z-10 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-10 py-3.5">
        <span className="text-lg font-semibold text-slate-900">Tamanho do texto</span>
        <div className="flex items-center gap-2.5">
          <button type="button" aria-label="Diminuir o texto" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
            className={cx("h-14 w-16 rounded-[10px] border-2 border-slate-900 bg-white font-['Lora'] text-xl font-bold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40", RING)}>A−</button>
          <span aria-live="polite" className="min-w-[72px] text-center text-lg font-semibold tabular-nums">{Math.round((fs / SIZES[BASE_IDX]) * 100)}%</span>
          <button type="button" aria-label="Aumentar o texto" disabled={idx === SIZES.length - 1} onClick={() => setIdx((i) => Math.min(SIZES.length - 1, i + 1))}
            className={cx("h-14 w-16 rounded-[10px] border-2 border-slate-900 bg-white font-['Lora'] text-[26px] font-bold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40", RING)}>A+</button>
          <button type="button" onClick={() => setIdx(BASE_IDX)}
            className={cx("h-14 rounded-lg px-3.5 text-lg font-semibold text-[#132D56] underline underline-offset-4", RING)}>Restaurar</button>
        </div>
      </div>

      <div className="max-w-[860px] px-10 pb-24 pt-11 font-['Lora'] leading-[1.75] text-slate-900" style={{ fontSize: fs }}>
        <p className="mb-[.6em] font-['Inter'] text-lg font-semibold uppercase leading-snug tracking-[.06em] text-slate-700">Relato do demandante</p>
        <h1 className="mb-[.9em] font-['Lora'] text-[1.55em] font-bold leading-tight [text-wrap:pretty]">Rescisão de contrato de prestação de serviços</h1>

        <dl className="mb-[2em] grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-x-8 gap-y-4 rounded-xl border-2 border-slate-200 px-6 py-5 font-['Inter'] leading-snug"
          style={{ fontSize: Math.max(18, fs * 0.82) }}>
          {[["Valor da causa", "R$ 18.400,00"], ["Natureza", "Consumidor · prestação de serviços"], ["Demandante", <Protected key="p" />], ["Recebido em", "12 de outubro de 2026"]].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1"><dt className="font-medium text-slate-700">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
        </dl>

        <H2>Os fatos</H2>
        <p className="mb-[1em] max-w-[66ch] [text-wrap:pretty]">O demandante contratou a empresa <Protected /> para reformar seu apartamento, situado à <Protected />, em março de 2026. O valor total ajustado foi de R$ 18.400,00, pago em duas parcelas, conforme comprovantes anexados.</p>
        <p className="mb-[1em] max-w-[66ch] [text-wrap:pretty]">Segundo o relato, o responsável pela obra, <Protected />, abandonou os serviços com aproximadamente metade do escopo concluído e deixou de responder às mensagens enviadas a partir de maio de 2026.</p>
        <p className="mb-[2em] max-w-[66ch] [text-wrap:pretty]">O demandante afirma não ter recebido notificação de rescisão nem proposta de devolução dos valores pagos.</p>

        <H2>O pedido</H2>
        <p className="mb-[2em] max-w-[66ch] [text-wrap:pretty]">Devolução proporcional dos valores pagos pelos serviços não executados, estimada em R$ 9.200,00, e reparação dos danos materiais decorrentes da obra inacabada.</p>

        <H2>Documentos anexados</H2>
        <ul className="mb-[2em] flex flex-col gap-2.5 font-['Inter'] leading-snug" style={{ fontSize: Math.max(18, fs * 0.82) }}>
          {[["Contrato de prestação de serviços", "4 páginas"], ["Comprovantes de transferência bancária", "2 arquivos"], ["Registro de conversas por aplicativo", "12 imagens"]].map(([n, m]) => (
            <li key={n} className="flex items-center gap-3.5 rounded-[10px] border-2 border-slate-200 px-[18px] py-3.5">
              <FileText className="h-6 w-6 flex-none text-[#183A6E]" aria-hidden />
              <span className="flex-1 font-medium">{n}</span>
              <span className="whitespace-nowrap text-slate-700">{m}</span>
            </li>
          ))}
        </ul>

        <H2>Manifestação da parte demandada</H2>
        <p className="max-w-[66ch] italic text-slate-700">A parte demandada ainda não apresentou manifestação.</p>
      </div>
    </article>
  );
}

/* ---------- Controles grandes ---------- */
function BigSlider({ value, onChange, labelledBy }) {
  const track = useRef(null);
  const dragging = useRef(false);
  const pct = ((value - 1) / 9) * 100;
  const fromX = (x) => {
    const r = track.current.getBoundingClientRect();
    onChange(Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 9) + 1);
  };
  const onKey = (e) => {
    const map = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key in map) onChange(clamp(value + map[e.key]));
    else if (e.key === "Home") onChange(1);
    else if (e.key === "End") onChange(10);
    else return;
    e.preventDefault();
  };
  const Step = ({ dir, label, Icon }) => (
    <button type="button" aria-label={label} onClick={() => onChange(clamp(value + dir))}
      className={cx("flex h-14 w-14 flex-none items-center justify-center rounded-[10px] border-2 border-slate-900 bg-white text-slate-900 hover:bg-slate-100", RING)}>
      <Icon className="h-6 w-6" strokeWidth={2.25} aria-hidden />
    </button>
  );
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center justify-between gap-3">
        <Step dir={-1} label="Diminuir nota" Icon={Minus} />
        <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
          <span className="text-[40px] font-bold leading-none tabular-nums">{value}<span className="text-xl font-medium"> de 10</span></span>
          <span className="text-lg font-semibold">{proofWord(value)}</span>
        </div>
        <Step dir={1} label="Aumentar nota" Icon={Plus} />
      </div>
      <div className="flex flex-col">
        <div className="px-[22px]">
          <div ref={track} className="relative h-14 cursor-pointer touch-none"
            onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); fromX(e.clientX); }}
            onPointerMove={(e) => dragging.current && fromX(e.clientX)}
            onPointerUp={() => (dragging.current = false)} onPointerCancel={() => (dragging.current = false)}>
            <span className="absolute inset-x-0 top-1/2 -mt-1.5 h-3 rounded-full bg-slate-300" />
            <span className="absolute left-0 top-1/2 -mt-1.5 h-3 rounded-full bg-[#183A6E]" style={{ width: `${pct}%` }} />
            <button type="button" role="slider" aria-labelledby={labelledBy} aria-valuemin={1} aria-valuemax={10} aria-valuenow={value}
              aria-valuetext={`${value} de 10, ${proofWord(value)}`} onKeyDown={onKey}
              className="absolute top-1/2 -ml-[22px] -mt-[22px] h-11 w-11 cursor-grab rounded-full border-4 border-white bg-[#183A6E] p-0 shadow-[0_0_0_2px_#183A6E,0_2px_8px_rgba(15,23,42,.25)] outline-none focus-visible:shadow-[0_0_0_2px_#183A6E,0_0_0_7px_rgba(24,58,110,.35)]"
              style={{ left: `${pct}%` }} />
          </div>
          <div className="relative h-9">
            {Array.from({ length: 10 }, (_, k) => (
              <button key={k} type="button" aria-label={`Nota ${k + 1}`} onClick={() => onChange(k + 1)}
                className={cx("absolute top-0 h-9 w-8 -translate-x-1/2 rounded-md p-0 text-[17px] text-slate-900", value === k + 1 ? "font-bold" : "font-medium", RING)}
                style={{ left: `${(k / 9) * 100}%` }}>{k + 1}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-between gap-3 pt-1 text-base font-medium text-slate-700"><span>1 · Frágeis</span><span className="text-right">Muito sólidas · 10</span></div>
      </div>
    </div>
  );
}

function BigRadioGroup({ name, number, question, options, value, onChange }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3.5 rounded-[14px] border-2 border-slate-300 bg-white p-6">
      <legend className="float-left mb-1 flex w-full flex-col gap-1.5 p-0">
        <span className="text-base font-semibold text-slate-700">Pergunta {number} de 3</span>
        <span className="text-[22px] font-bold leading-snug text-slate-900">{question}</span>
      </legend>
      {options.map((o) => {
        const on = value === o.v;
        return (
          <label key={o.v} className={cx("flex cursor-pointer items-start gap-4 rounded-xl border-2 px-5 py-[18px] transition-colors hover:border-[#183A6E]",
            on ? "border-[#183A6E] bg-[#EEF3FB]" : "border-slate-300 bg-white")}>
            <input type="radio" name={name} value={o.v} checked={on} onChange={() => onChange(o.v)}
              className="m-0 h-7 w-7 flex-none cursor-pointer accent-[#183A6E] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#183A6E]" />
            <span className="flex flex-col gap-1">
              <span className="text-xl font-bold leading-tight text-slate-900">{o.label}</span>
              <span className="text-[17px] leading-normal text-slate-700">{o.desc}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/* ---------- Avaliação (painel direito) ---------- */
function EvaluationPanel() {
  const [proof, setProof] = useState(5);
  const [risk, setRisk] = useState(null);
  const [rec, setRec] = useState(null);
  const [sent, setSent] = useState(false);
  const missing = [!risk && "2", !rec && "3"].filter(Boolean);
  const can = missing.length === 0;

  return (
    <aside aria-label="Avaliação" className="min-w-[360px] flex-[2_1_0] self-stretch border-l-2 border-slate-300 bg-slate-100">
      <div className="sticky top-[76px] flex max-h-[calc(100vh-76px)] flex-col gap-6 overflow-y-auto px-7 pb-12 pt-9">
        {!sent ? (
          <>
            <div className="flex flex-col gap-2">
              <h2 className="text-[28px] font-bold leading-tight tracking-[-.01em]">Sua avaliação</h2>
              <p className="text-lg text-slate-700">Três perguntas. Nada precisa ser digitado.</p>
            </div>

            <section aria-labelledby="q1" className="flex flex-col gap-[18px] rounded-[14px] border-2 border-slate-300 bg-white p-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-base font-semibold text-slate-700">Pergunta 1 de 3</span>
                <h3 id="q1" className="text-[22px] font-bold leading-snug">Qual a solidez das provas?</h3>
              </div>
              <BigSlider value={proof} onChange={setProof} labelledBy="q1" />
            </section>

            <BigRadioGroup name="risk" number={2} question="Qual o risco de jurisprudência desfavorável?" options={RISK} value={risk} onChange={setRisk} />
            <BigRadioGroup name="rec" number={3} question="Recomenda tentar um acordo?" options={REC} value={rec} onChange={setRec} />

            <div className="flex flex-col gap-3 pt-1">
              <button type="button" disabled={!can} onClick={() => setSent(true)} aria-describedby={!can ? "send-hint" : undefined}
                className={cx("flex h-20 w-full items-center justify-center gap-3.5 rounded-[14px] border-2 text-2xl font-bold transition-[background-color,transform] duration-150",
                  can ? "border-[#0E2140] bg-[#183A6E] text-white shadow-[0_2px_6px_rgba(15,23,42,.18)] hover:bg-[#0E2140] active:scale-[.99]"
                      : "cursor-not-allowed border-dashed border-slate-700 bg-slate-200 text-slate-900", RING)}>
                <Send className="h-7 w-7" strokeWidth={2.25} aria-hidden />Enviar Parecer
              </button>
              {!can && (
                <p id="send-hint" className="text-center text-lg font-medium">
                  {missing.length === 2 ? "Responda às perguntas 2 e 3 para enviar." : `Responda à pergunta ${missing[0]} para enviar.`}
                </p>
              )}
            </div>
          </>
        ) : (
          <div role="status" className="flex flex-col gap-6">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2F4A37] text-white"><Check className="h-8 w-8" strokeWidth={2.5} aria-hidden /></span>
            <div className="flex flex-col gap-2.5">
              <h2 className="text-[30px] font-bold leading-tight">Parecer enviado</h2>
              <p className="text-[19px] leading-relaxed">Obrigado. O demandante e o mediador serão avisados. Sua identidade não é revelada às partes.</p>
            </div>
            <dl className="flex flex-col rounded-[14px] border-2 border-slate-300 bg-white px-6 py-2">
              {[["Solidez das provas", `${proof} de 10 · ${proofWord(proof)}`],
                ["Risco de jurisprudência desfavorável", RISK.find((o) => o.v === risk)?.label],
                ["Recomenda acordo", REC.find((o) => o.v === rec)?.label]].map(([k, v], i) => (
                <div key={k} className={cx("flex flex-col gap-1 py-4", i < 2 && "border-b border-slate-200")}>
                  <dt className="text-[17px] font-medium text-slate-700">{k}</dt>
                  <dd className="text-xl font-bold">{v}</dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => { setSent(false); setProof(5); setRisk(null); setRec(null); }}
              className={cx("flex h-[72px] w-full items-center justify-center gap-3 rounded-[14px] border-2 border-[#0E2140] bg-[#183A6E] text-[22px] font-bold text-white hover:bg-[#0E2140]", RING)}>
              Abrir próximo caso<ArrowRight className="h-6 w-6" aria-hidden />
            </button>
            <button type="button" onClick={() => setSent(false)}
              className={cx("h-16 w-full rounded-[14px] border-2 border-slate-900 bg-white text-xl font-semibold hover:bg-slate-50", RING)}>
              Corrigir parecer
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default function VisaoAvaliador() {
  return (
    <div className="flex min-h-screen flex-col bg-white font-['Inter'] text-slate-900 antialiased">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,600;0,700;1,400&display=swap');`}</style>
      <header className="sticky top-0 z-20 h-[76px] flex-none border-b-2 border-slate-300 bg-white">
        <div className="flex h-full items-center justify-between gap-5 px-8">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-[10px] border border-slate-300 bg-white">
              <img src="/assets/peacelaw-logo.jpeg" alt="" className="h-[170%] w-[170%] max-w-none object-contain" />
            </span>
            <span className="text-xl font-bold tracking-[-.01em]">PeaceLaw</span>
            <span className="h-7 w-px flex-none bg-slate-300" />
            <span className="text-lg font-medium">Área do avaliador</span>
          </div>
          <div className="flex items-center gap-3.5">
            <span className="whitespace-nowrap text-lg font-semibold">Caso nº 2026-0418</span>
            <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#132D56] px-3 text-[15px] font-semibold text-white">
              <ShieldCheck className="h-4 w-4" aria-hidden />Anonimizado
            </span>
          </div>
        </div>
      </header>
      <div className="flex flex-1 items-start">
        <CaseDocument />
        <EvaluationPanel />
      </div>
    </div>
  );
}
