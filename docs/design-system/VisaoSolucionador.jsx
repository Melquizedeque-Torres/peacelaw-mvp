import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard, Briefcase, Handshake, Settings, Clock, Gavel, Check, X, ShieldCheck, Landmark, Undo2,
} from "lucide-react";

/* Visão do Solucionador (Advogado Mediador) — Kanban denso estilo CRM */

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const money = (v) => BRL.format(v).replace(/\u00a0/g, " ");
const cx = (...c) => c.filter(Boolean).join(" ");
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0] focus-visible:ring-offset-2";

const TIERS = {
  high: { main: "#4A7556", soft: "#F1F6F2", border: "#DDEBE0", text: "#2F4A37", label: "Alta chance de acordo",
    why: "Casos com valor e provas semelhantes costumam fechar acordo já na primeira rodada de negociação." },
  mid: { main: "#B7862A", soft: "#FBF6EA", border: "#F4E6C2", text: "#75531A", label: "Média chance",
    why: "O resultado depende de pontos em aberto. Uma proposta intermediária tende a destravar a negociação." },
  low: { main: "#B54740", soft: "#FBF1F0", border: "#F5DCDA", text: "#7E302B", label: "Baixa chance",
    why: "Posições distantes entre as partes. Considere a câmara arbitral se não houver avanço." },
};
const tierFor = (p) => (p >= 70 ? TIERS.high : p >= 45 ? TIERS.mid : TIERS.low);

const COLS = [
  { key: "novas", name: "Novas Oportunidades", dot: "#2B5BA6", empty: "Nenhuma oportunidade nova no momento." },
  { key: "neg", name: "Em Negociação", dot: "#B7862A", empty: "Assuma um caso ou arraste um card para cá." },
  { key: "acordo", name: "Acordo / Câmara Arbitral", dot: "#4A7556", empty: "Arraste um caso para registrar o desfecho." },
];

const SEED = [
  { id: "2026-0431", type: "Contrato comercial", sub: "Fornecimento de insumos", value: 126000, prob: 74, hours: 26, docs: 6, col: "novas" },
  { id: "2026-0418", type: "Prestação de serviços", sub: "Reforma residencial", value: 18400, prob: 82, hours: 50, docs: 3, col: "novas", parecer: { proof: 7, risk: "Médio", rec: "Sim" } },
  { id: "2026-0425", type: "Vício de produto", sub: "Eletrodoméstico", value: 2980, prob: 88, hours: 122, docs: 4, col: "novas", parecer: { proof: 8, risk: "Baixo", rec: "Sim" } },
  { id: "2026-0427", type: "Cobrança indevida", sub: "Telefonia", value: 4250, prob: 61, hours: 98, docs: 2, col: "novas" },
  { id: "2026-0433", type: "Locação comercial", sub: "Revisão de aluguel", value: 64500, prob: 38, hours: 6, docs: 5, col: "novas" },
  { id: "2026-0362", type: "Distrato imobiliário", sub: "Imóvel na planta", value: 210000, prob: 77, hours: 600, docs: 9, col: "neg", note: "Proposta enviada: R$ 168.000", parecer: { proof: 8, risk: "Baixo", rec: "Sim" } },
  { id: "2026-0377", type: "Contrato comercial", sub: "Serviços de TI", value: 92000, prob: 69, hours: 432, docs: 7, col: "neg", note: "Contraproposta recebida: R$ 70.000", parecer: { proof: 6, risk: "Médio", rec: "Sim" } },
  { id: "2026-0384", type: "Atraso na entrega", sub: "Comércio eletrônico", value: 6100, prob: 85, hours: 288, docs: 3, col: "neg", note: "Reunião com a outra parte em 16/10", parecer: { proof: 9, risk: "Baixo", rec: "Sim" } },
  { id: "2026-0390", type: "Negativa de cobertura", sub: "Seguro residencial", value: 37800, prob: 52, hours: 216, docs: 4, col: "neg", note: "Aguardando resposta da seguradora" },
  { id: "2026-0341", type: "Contrato de fornecimento", sub: "Indústria têxtil", value: 148000, agreed: 121000, prob: 81, hours: 744, docs: 8, col: "acordo", outcome: "acordo", note: "Acordo assinado: R$ 121.000", parecer: { proof: 8, risk: "Baixo", rec: "Sim" } },
  { id: "2026-0348", type: "Prestação de serviços", sub: "Consultoria", value: 22700, agreed: 19000, prob: 73, hours: 648, docs: 5, col: "acordo", outcome: "acordo", note: "Acordo assinado: R$ 19.000", parecer: { proof: 7, risk: "Médio", rec: "Sim" } },
  { id: "2026-0355", type: "Contrato de franquia", sub: "Rescisão antecipada", value: 310000, prob: 41, hours: 1056, docs: 11, col: "acordo", outcome: "camara", note: "Encaminhado à câmara arbitral em 02/10", parecer: { proof: 5, risk: "Alto", rec: "Não" } },
];
const age = (h) => (h < 24 ? `há ${h} h` : Math.floor(h / 24) === 1 ? "1 dia" : `${Math.floor(h / 24)} dias`);
const NAV = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { key: "casos", label: "Meus Casos", Icon: Briefcase },
  { key: "acordos", label: "Acordos Finalizados", Icon: Handshake },
  { key: "config", label: "Configurações", Icon: Settings },
];
const SORTERS = { chance: (a, b) => b.prob - a.prob, valor: (a, b) => b.value - a.value, antigos: (a, b) => b.hours - a.hours };

/* ---------- Primitivos ---------- */
const BTN = {
  primary: "bg-[#183A6E] text-white border-[#183A6E] hover:bg-[#132D56]",
  secondary: "bg-[#4A7556] text-white border-[#4A7556] hover:bg-[#3B5E45] focus-visible:ring-[#79A784]",
  outline: "bg-white text-slate-900 border-slate-300 hover:bg-slate-50 hover:border-slate-400",
  ghost: "bg-transparent text-slate-700 border-transparent hover:bg-slate-100 hover:text-slate-900",
};
const Btn = ({ variant = "outline", className, ...p }) => (
  <button type="button" className={cx("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[.98]", BTN[variant], FOCUS, className)} {...p} />
);
const ProbBadge = ({ prob }) => {
  const t = tierFor(prob);
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium" style={{ background: t.soft, color: t.text, borderColor: t.border }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.main }} />{t.label}<span className="font-bold tabular-nums">{prob}%</span>
    </span>
  );
};
const OutcomeChip = ({ outcome }) => {
  const camara = outcome === "camara";
  const Icon = camara ? Landmark : Handshake;
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white", camara ? "bg-[#132D56]" : "bg-[#3B5E45]")}>
      <Icon className="h-3 w-3" aria-hidden />{camara ? "Câmara arbitral" : "Acordo"}
    </span>
  );
};

/* ---------- Card ---------- */
function CaseCard({ c, dragging, onDragStart, onDragEnd, onAssume, onClose, onOpen }) {
  return (
    <article draggable onDragStart={onDragStart} onDragEnd={onDragEnd} aria-label={`Caso ${c.id}`}
      className={cx("flex cursor-grab flex-col gap-[9px] rounded-[10px] border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/[.04] transition hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/[.08]",
        dragging && "opacity-45")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-slate-500">#{c.id}</span>
        <span title="Tempo na plataforma" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-600"><Clock className="h-3 w-3" aria-hidden />{age(c.hours)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold leading-tight text-slate-900">{c.type}</span>
        <span className="text-xs text-slate-600">{c.sub}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold leading-none tracking-[-.01em] tabular-nums">{money(c.value)}</span>
        <span className={cx("inline-flex items-center gap-1 text-[11.5px] font-medium", c.parecer ? "text-[#2F4A37]" : "text-slate-500")}>
          <Gavel className="h-3 w-3" aria-hidden />{c.parecer ? "Parecer" : "Sem parecer"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ProbBadge prob={c.prob} />
        {c.col === "acordo" && c.outcome && <OutcomeChip outcome={c.outcome} />}
      </div>
      {c.note && <span className="rounded-md bg-slate-50 px-2 py-1.5 text-xs leading-snug text-slate-700">{c.note}</span>}
      <div className="flex gap-1.5 border-t border-slate-100 pt-[9px]">
        {c.col === "novas" && <Btn variant="primary" onClick={onAssume} className="h-[30px] flex-auto px-2.5 text-[12.5px]">Assumir caso</Btn>}
        {c.col === "neg" && <Btn variant="secondary" onClick={onClose} className="h-[30px] flex-auto px-2.5 text-[12.5px]">Fechar acordo</Btn>}
        <Btn onClick={onOpen} className="h-[30px] flex-auto px-2.5 text-[12.5px]">Ver detalhes</Btn>
      </div>
    </article>
  );
}

/* ---------- Drawer ---------- */
function CaseDrawer({ c, onClose, onAssume, onCloseDeal, onArbitrate }) {
  const t = tierFor(c.prob);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-slate-900/30" />
      <aside role="dialog" aria-modal="true" aria-label={`Detalhes do caso ${c.id}`}
        className="fixed inset-y-0 right-0 z-[41] flex w-full max-w-[440px] flex-col bg-white shadow-[-12px_0_32px_rgba(15,23,42,.16)] animate-[slideIn_220ms_cubic-bezier(.2,0,0,1)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <span className="font-mono text-xs text-slate-600">#{c.id} · {COLS.find((x) => x.key === c.col).name}</span>
          <button type="button" aria-label="Fechar" onClick={onClose} className={cx("flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900", FOCUS)}><X className="h-[18px] w-[18px]" /></button>
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold leading-tight tracking-[-.01em]">{c.type}</h2>
            <span className="text-sm text-slate-600">{c.sub}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[["Valor estimado", money(c.value)], ["Na plataforma", age(c.hours)], ["Documentos", `${c.docs} arquivos`]].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2.5">
                <span className="text-[11.5px] font-medium text-slate-600">{k}</span>
                <span className="text-[15px] font-semibold tabular-nums">{v}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 rounded-[10px] border p-3.5" style={{ background: t.soft, borderColor: t.border }}>
            <div className="flex items-center justify-between gap-2" style={{ color: t.text }}>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><span className="h-[7px] w-[7px] rounded-full" style={{ background: t.main }} />{t.label}</span>
              <span className="text-lg font-bold tabular-nums">{c.prob}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full" style={{ width: `${c.prob}%`, background: t.main }} /></div>
            <span className="text-[13px] leading-normal" style={{ color: t.text }}>{t.why}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><Gavel className="h-3.5 w-3.5 text-[#183A6E]" aria-hidden />Parecer do avaliador</span>
            {c.parecer ? (
              <dl className="flex flex-col rounded-lg border border-slate-200">
                {[["Solidez das provas", `${c.parecer.proof} de 10`], ["Risco de jurisprudência", c.parecer.risk], ["Recomenda acordo", c.parecer.rec]].map(([k, v], i) => (
                  <div key={k} className={cx("flex justify-between gap-3 px-3 py-2.5 text-[13px]", i < 2 && "border-b border-slate-100")}>
                    <dt className="text-slate-600">{k}</dt><dd className="font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="inline-flex h-[26px] items-center gap-1.5 self-start rounded-full border border-[#F4E6C2] bg-[#FBF6EA] px-2.5 text-xs font-medium text-[#75531A]">
                <Clock className="h-3 w-3" aria-hidden />Aguardando Juiz
              </span>
            )}
          </div>
          {c.note && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Última atualização</span>
              <span className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] leading-normal text-slate-700">{c.note}</span>
            </div>
          )}
          <p className="flex items-start gap-2.5 rounded-lg bg-[#EEF3FB] px-3 py-2.5 text-[12.5px] leading-normal text-[#132D56]">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />Os dados pessoais das partes seguem anonimizados até a assinatura do acordo.
          </p>
        </div>
        <div className="flex gap-2 border-t border-slate-200 px-5 py-3.5">
          {c.col === "novas" && <Btn variant="primary" onClick={onAssume} className="h-10 flex-1 rounded-lg text-sm">Assumir caso</Btn>}
          {c.col === "neg" && (
            <>
              <Btn variant="secondary" onClick={onCloseDeal} className="h-10 flex-1 rounded-lg text-sm">Fechar acordo</Btn>
              <Btn onClick={onArbitrate} className="h-10 flex-1 rounded-lg text-sm">Câmara arbitral</Btn>
            </>
          )}
          <Btn variant="ghost" onClick={onClose} className="h-10 rounded-lg px-4 text-sm">Fechar</Btn>
        </div>
      </aside>
    </>
  );
}

/* ---------- App ---------- */
export default function VisaoSolucionador() {
  const [cases, setCases] = useState(SEED);
  const [view, setView] = useState("casos");
  const [sort, setSort] = useState("chance");
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [toast, setToast] = useState(null);
  const undoSnap = useRef(null);
  const timer = useRef();

  useEffect(() => () => clearTimeout(timer.current), []);

  const move = (id, col, extra, msg) => {
    undoSnap.current = cases;
    setCases((cs) => cs.map((c) => (c.id === id ? { ...c, col, ...extra } : c)));
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setToast(null); undoSnap.current = null; }, 5000);
  };
  const assume = (c) => move(c.id, "neg", { note: "Caso assumido hoje" }, `Caso #${c.id} assumido. Movido para Em Negociação.`);
  const closeDeal = (c) => move(c.id, "acordo", { outcome: "acordo", note: "Acordo em redação" }, `Caso #${c.id} movido para Acordo.`);
  const arbitrate = (c) => move(c.id, "acordo", { outcome: "camara", note: "Encaminhado à câmara arbitral hoje" }, `Caso #${c.id} encaminhado à câmara arbitral.`);
  const dropTo = (col) => {
    const c = cases.find((x) => x.id === dragId);
    setDragId(null); setOverCol(null);
    if (!c || c.col === col) return;
    const extra = col === "novas" ? { note: undefined, outcome: undefined }
      : col === "neg" ? { note: c.col === "novas" ? "Caso assumido hoje" : c.note, outcome: undefined }
      : { outcome: c.outcome || "acordo", note: c.outcome === "camara" ? c.note : "Acordo em redação" };
    const msg = col === "neg" ? `Caso #${c.id} em negociação.` : col === "acordo" ? `Caso #${c.id} movido para Acordo.` : `Caso #${c.id} voltou para Novas Oportunidades.`;
    move(c.id, col, extra, msg);
  };

  const open = cases.filter((c) => c.col !== "acordo");
  const high = open.filter((c) => c.prob >= 70);
  const closed = cases.filter((c) => c.col === "acordo" && c.outcome === "acordo");
  const kpis = [
    { label: "Em aberto", dot: "#2B5BA6", value: money(open.reduce((s, c) => s + c.value, 0)), sub: `${open.length} casos em Novas e Negociação` },
    { label: "Alta chance de acordo", dot: "#4A7556", value: money(high.reduce((s, c) => s + c.value, 0)), sub: `${high.length} casos com 70% ou mais` },
    { label: "Acordos fechados", dot: "#3B5E45", value: money(closed.reduce((s, c) => s + (c.agreed || c.value), 0)), sub: `${closed.length} acordos neste mês` },
  ];
  const columns = useMemo(() => COLS.map((col) => ({
    ...col, list: cases.filter((c) => c.col === col.key && (!onlyHigh || c.prob >= 70)).sort(SORTERS[sort]),
  })), [cases, onlyHigh, sort]);
  const detail = cases.find((c) => c.id === detailId);
  const navItem = NAV.find((n) => n.key === view);

  return (
    <div className="flex min-h-screen bg-white font-['Inter'] text-slate-900 antialiased">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes slideIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}`}</style>

      <aside className="sticky top-0 flex h-screen w-56 flex-none flex-col border-r border-slate-200 bg-slate-50 px-3 py-4">
        <div className="flex items-center gap-2.5 px-2 pb-5 pt-1">
          <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            <img src="/assets/peacelaw-logo.jpeg" alt="" className="h-[170%] w-[170%] max-w-none object-contain" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold leading-tight">PeaceLaw</span>
            <span className="text-[11px] font-medium leading-tight text-slate-500">Solucionador</span>
          </div>
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-0.5">
          {NAV.map(({ key, label, Icon }) => {
            const on = view === key;
            const count = key === "casos" ? open.length : key === "acordos" ? closed.length : 0;
            return (
              <button key={key} type="button" onClick={() => setView(key)} aria-current={on ? "page" : undefined}
                className={cx("flex h-9 items-center gap-2.5 rounded-lg border px-2.5 text-left text-[13.5px] font-medium transition-colors hover:text-slate-900", FOCUS,
                  on ? "border-slate-200 bg-white text-slate-900 shadow-sm" : "border-transparent text-slate-700 hover:bg-slate-100")}>
                <Icon className={cx("h-4 w-4", on ? "text-[#183A6E]" : "text-slate-500")} aria-hidden />
                <span className="flex-1">{label}</span>
                {count > 0 && <span className="rounded-full bg-slate-200 px-[7px] py-[3px] text-[11px] font-semibold tabular-nums text-slate-600">{count}</span>}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t border-slate-200 px-2 pb-1 pt-3">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#183A6E] text-xs font-semibold text-white">MA</span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-semibold leading-tight">Dra. Marina Alves</span>
            <span className="text-[11px] leading-tight text-slate-500">OAB/SP 312.448</span>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {view === "casos" ? (
          <div className="flex flex-col gap-[18px] px-6 pb-8 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold tracking-[-.01em]">Meus Casos</h1>
                <span className="text-[13px] text-slate-600">Arraste os cards entre colunas ou use as ações rápidas.</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={onlyHigh} onClick={() => setOnlyHigh((v) => !v)}
                  className={cx("inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition", FOCUS,
                    onlyHigh ? "border-[#9DC2A6] bg-[#F1F6F2] text-[#2F4A37]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                  <span className="h-[7px] w-[7px] rounded-full bg-[#4A7556]" />Só alta chance
                </button>
                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-300 bg-white pl-3 pr-1 text-[13px] font-medium text-slate-600 focus-within:ring-2 focus-within:ring-[#4A78C0]">
                  Ordenar
                  <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-7 cursor-pointer border-none bg-transparent pr-1 text-[13px] font-semibold text-slate-900 outline-none">
                    <option value="chance">Maior chance</option>
                    <option value="valor">Maior valor</option>
                    <option value="antigos">Mais antigos</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
              {kpis.map((k) => (
                <div key={k.label} className="flex flex-col gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3.5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"><span className="h-[7px] w-[7px] rounded-full" style={{ background: k.dot }} />{k.label}</span>
                  <span className="text-xl font-semibold leading-tight tracking-[-.01em] tabular-nums">{k.value}</span>
                  <span className="text-xs text-slate-500">{k.sub}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[repeat(3,minmax(268px,1fr))] items-start gap-3 overflow-x-auto pb-1">
              {columns.map((col) => {
                const over = overCol === col.key && dragId;
                return (
                  <section key={col.key} aria-label={col.name}
                    onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(null); }}
                    onDrop={(e) => { e.preventDefault(); dropTo(col.key); }}
                    className={cx("flex min-h-[420px] flex-col rounded-xl border transition-colors", over ? "border-dashed border-[#7A9FD6] bg-[#EEF3FB]" : "border-slate-200 bg-slate-50")}>
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 pb-2.5 pt-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 flex-none rounded-full" style={{ background: col.dot }} />
                        <h2 className="text-[13px] font-semibold">{col.name}</h2>
                        <span className="rounded-full bg-slate-200 px-[7px] py-[3px] text-[11px] font-semibold tabular-nums text-slate-600">{col.list.length}</span>
                      </div>
                      <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-700">{money(col.list.reduce((s, c) => s + c.value, 0))}</span>
                    </div>
                    <div className="flex flex-col gap-2 px-2 pb-2">
                      {col.list.map((c) => (
                        <CaseCard key={c.id} c={c} dragging={dragId === c.id}
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setDragId(c.id); }}
                          onDragEnd={() => { setDragId(null); setOverCol(null); }}
                          onAssume={() => assume(c)} onClose={() => closeDeal(c)} onOpen={() => setDetailId(c.id)} />
                      ))}
                      {col.list.length === 0 && (
                        <div className="rounded-[10px] border border-dashed border-slate-300 px-3 py-6 text-center text-[12.5px] text-slate-500">{col.empty}</div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EEF3FB] text-[#183A6E]"><navItem.Icon className="h-5 w-5" aria-hidden /></span>
            <h1 className="text-lg font-semibold">{navItem.label}</h1>
            <p className="max-w-[40ch] text-sm leading-normal text-slate-600">Esta área ainda não foi desenhada. O quadro de casos está em Meus Casos.</p>
            <Btn onClick={() => setView("casos")} className="mt-1.5 h-[34px] rounded-lg px-3.5 text-[13px]">Ir para Meus Casos</Btn>
          </div>
        )}
      </main>

      {detail && (
        <CaseDrawer c={detail} onClose={() => setDetailId(null)}
          onAssume={() => { assume(detail); setDetailId(null); }}
          onCloseDeal={() => { closeDeal(detail); setDetailId(null); }}
          onArbitrate={() => { arbitrate(detail); setDetailId(null); }} />
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-40px)] items-center gap-3.5 rounded-[10px] bg-slate-900 py-3 pl-4 pr-3.5 text-[13px] text-white shadow-[0_10px_28px_rgba(15,23,42,.28)] animate-[fadeUp_220ms_cubic-bezier(.2,0,0,1)]">
          <span>{toast}</span>
          <button type="button" onClick={() => { clearTimeout(timer.current); if (undoSnap.current) setCases(undoSnap.current); undoSnap.current = null; setToast(null); }}
            className="inline-flex h-7 flex-none items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-[12.5px] font-semibold hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A9FD6]">
            <Undo2 className="h-3.5 w-3.5" aria-hidden />Desfazer
          </button>
        </div>
      )}
    </div>
  );
}
