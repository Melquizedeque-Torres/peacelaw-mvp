import React, { useEffect, useRef, useState } from "react";
import {
  Scale, ShieldCheck, Shield, Lock, FileText, Check, Clock, Eye, EyeOff, ArrowRight, ArrowLeft,
  LogOut, X, Info, Loader2, AlertTriangle, TrendingUp, TrendingDown, UserCheck,
} from "lucide-react";

/* ---------- Constantes ---------- */
const MIN = 40;
const EXAMPLE =
  "Contratei a Reforma Fácil Ltda para reformar meu apartamento na Rua das Acácias, 142, em março de 2026. Paguei R$ 18.400 em duas parcelas. O responsável, Carlos Menezes, abandonou a obra na metade e não responde mais às mensagens. Meu CPF é 123.456.789-00 e meu telefone é (11) 98765-4321.";
const LABELS = ["Relato", "Privacidade", "Resultado"];
const ANALYZE = ["Criptografando seus documentos", "Ocultando dados pessoais", "Comparando com decisões semelhantes"];

const U = "A-ZÀ-ÖØ-Ý", L = "a-zß-öø-ÿ";
const PATTERNS = [
  ["E-mail", /[\w.+-]+@[\w-]+\.[\w.]+/g],
  ["CPF", /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g],
  ["Telefone", /\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g],
  ["Endereço", /\b(?:Rua|Avenida|Av\.|Travessa|Alameda|Praça|Rodovia)\s[^,.\n]+(?:,\s?\d+)?/g],
  ["Empresa", new RegExp(`(?:[${U}][${U}${L}]*\\s)+(?:Ltda|S\\.A\\.|S/A|EIRELI|ME)\\b\\.?`, "g")],
  ["Nome", new RegExp(`[${U}][${L}]+(?:\\s(?:d[aeo]s?\\s)?[${U}][${L}]+)+`, "g")],
];

function redact(text) {
  const hits = [];
  PATTERNS.forEach(([label, re]) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const s = m.index, e = s + m[0].length;
      if (!hits.some((h) => s < h.e && e > h.s)) hits.push({ s, e, label });
    }
  });
  hits.sort((a, b) => a.s - b.s);
  const segs = [];
  let i = 0;
  hits.forEach((h) => {
    if (h.s > i) segs.push({ text: text.slice(i, h.s) });
    segs.push({ text: text.slice(h.s, h.e), label: h.label });
    i = h.e;
  });
  if (i < text.length) segs.push({ text: text.slice(i) });
  return { segs, hits };
}

const TIERS = {
  high: { main: "#4A7556", soft: "#F1F6F2", border: "#DDEBE0", text: "#2F4A37", label: "Alta", headline: "Seu caso tem boas chances",
    copy: "Casos com fatos e provas semelhantes tiveram decisão favorável na maioria das vezes. Um acordo agora tende a preservar valor e prazo." },
  mid: { main: "#B7862A", soft: "#FBF6EA", border: "#F4E6C2", text: "#75531A", label: "Média", headline: "Seu caso tem chances moderadas",
    copy: "O resultado depende de pontos ainda em aberto. Reforçar a prova documental pode mudar a estimativa." },
  low: { main: "#B54740", soft: "#FBF1F0", border: "#F5DCDA", text: "#7E302B", label: "Baixa", headline: "Seu caso tem chances reduzidas",
    copy: "Decisões em casos semelhantes foram majoritariamente desfavoráveis. A mediação costuma ser o caminho de menor risco." },
};
const tierFor = (s) => (s >= 70 ? TIERS.high : s >= 40 ? TIERS.mid : TIERS.low);
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const cx = (...c) => c.filter(Boolean).join(" ");

/* ---------- Primitivos ---------- */
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0] focus-visible:ring-offset-2";
const BTN = {
  primary: `bg-[#183A6E] text-white border border-[#183A6E] shadow-sm hover:bg-[#132D56] hover:shadow-[0_6px_16px_rgba(19,45,86,.22)] active:scale-[.99] disabled:opacity-40 disabled:pointer-events-none ${FOCUS}`,
  outline: `bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 ${FOCUS}`,
  ghost: `bg-transparent text-slate-700 border border-transparent hover:bg-slate-100 hover:text-slate-900 ${FOCUS}`,
};
const Button = ({ variant = "primary", className, ...p }) => (
  <button type="button" className={cx("inline-flex items-center justify-center gap-2.5 font-medium transition-[background-color,border-color,box-shadow,transform] duration-150", BTN[variant], className)} {...p} />
);
const Eyebrow = ({ children }) => <span className="text-xs font-semibold uppercase tracking-[.08em] text-[#2B5BA6]">{children}</span>;
const StepHeader = ({ eyebrow, title, desc }) => (
  <div className="flex flex-col gap-3">
    <Eyebrow>{eyebrow}</Eyebrow>
    <h1 className="text-[30px] font-semibold leading-tight tracking-[-.02em] text-slate-900 [text-wrap:pretty]">{title}</h1>
    {desc && <p className="text-base leading-relaxed text-slate-600 [text-wrap:pretty]">{desc}</p>}
  </div>
);
const Note = ({ icon: Icon, tone = "info", children }) => (
  <p className={cx("flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-[13px] leading-normal",
    tone === "info" ? "bg-[#EEF3FB] text-[#132D56]" : "bg-slate-50 text-slate-600")}>
    <Icon className="mt-px h-4 w-4 flex-none" aria-hidden />{children}
  </p>
);
const Fade = ({ children, className }) => (
  <div className={cx("animate-[fadeUp_360ms_cubic-bezier(.2,0,0,1)] motion-reduce:animate-none", className)}>{children}</div>
);

/* ---------- Upload seguro ---------- */
function SecureUpload({ files, setFiles }) {
  const [drag, setDrag] = useState(false);
  const depth = useRef(0);
  const nid = useRef(1);

  useEffect(() => {
    const t = setInterval(() => {
      setFiles((fs) => fs.some((f) => !f.error && f.progress < 100)
        ? fs.map((f) => (!f.error && f.progress < 100 ? { ...f, progress: Math.min(100, f.progress + 3 + Math.random() * 5) } : f))
        : fs);
    }, 120);
    return () => clearInterval(t);
  }, [setFiles]);

  const add = (list) => {
    const ok = ["application/pdf", "image/jpeg", "image/png"];
    const next = Array.from(list || []).map((f) => ({
      id: nid.current++, name: f.name, size: f.size, progress: 0,
      error: !ok.includes(f.type) && !/\.(pdf|jpe?g|png)$/i.test(f.name) ? "Formato não aceito. Envie PDF, JPG ou PNG."
        : f.size > 25 * 1024 * 1024 ? "Arquivo acima de 25 MB." : null,
    }));
    if (next.length) setFiles((fs) => [...fs, ...next]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-slate-900">Documentos e provas</span>
        <span className="text-[13px] text-slate-500">opcional</span>
      </div>
      <label
        onDragEnter={(e) => { e.preventDefault(); depth.current++; setDrag(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); depth.current = 0; setDrag(false); add(e.dataTransfer.files); }}
        className={cx("relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-8 text-center transition-colors duration-150",
          "focus-within:ring-2 focus-within:ring-[#4A78C0] focus-within:ring-offset-2",
          drag ? "border-[#2B5BA6] bg-[#EEF3FB]" : "border-slate-300 bg-slate-50 hover:border-[#4A78C0] hover:bg-[#F5F8FD]")}>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="sr-only" aria-label="Selecionar arquivos"
          onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <span className={cx("flex h-[52px] w-[52px] items-center justify-center rounded-[14px] transition-colors duration-200",
          drag ? "bg-[#183A6E] text-white" : "bg-[#EEF3FB] text-[#183A6E]")}><Shield className="h-6 w-6" aria-hidden /></span>
        <span className="text-[15px] font-semibold text-slate-900">{drag ? "Solte para enviar com segurança" : "Arraste seus arquivos para cá"}</span>
        <span className="text-sm text-slate-600">ou <span className="font-medium text-[#1F4787] underline underline-offset-[3px]">selecione do seu aparelho</span></span>
        <span className="text-xs text-slate-500">Contratos, notas fiscais, prints de conversa · PDF, JPG ou PNG até 25 MB</span>
      </label>
      <Note icon={Lock}>Seus documentos estão protegidos por criptografia de ponta a ponta e anonimizados por IA.</Note>
      {files.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {files.map((f) => {
            const pct = Math.round(f.progress), done = !f.error && pct >= 100;
            const Icon = f.error ? AlertTriangle : done ? ShieldCheck : FileText;
            return (
              <li key={f.id} className="flex items-center gap-3 rounded-[10px] border border-slate-200 bg-white p-3">
                <span className={cx("flex h-9 w-9 flex-none items-center justify-center rounded-lg",
                  f.error ? "bg-[#FBF1F0] text-[#9A3A34]" : done ? "bg-[#F1F6F2] text-[#3B5E45]" : "bg-[#EEF3FB] text-[#1F4787]")}>
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-900">{f.name}</span>
                    <span className="flex-none text-xs tabular-nums text-slate-500">{fmtSize(f.size)}</span>
                  </div>
                  {!f.error && !done && (
                    <div className="h-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-[#2B5BA6] transition-[width] duration-100" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <span className={cx("text-xs", f.error ? "text-[#9A3A34]" : done ? "text-[#3B5E45]" : "text-slate-600")}>
                    {f.error ?? (done ? "Criptografado e protegido" : `Criptografando… ${pct}%`)}
                  </span>
                </div>
                <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                  className={cx("flex h-9 w-9 flex-none items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900", FOCUS)}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- Passos ---------- */
function StepSubmit({ text, setText, files, setFiles, onAnalyze }) {
  const len = text.trim().length;
  const uploading = files.some((f) => !f.error && f.progress < 100);
  const can = len >= MIN && !uploading;
  return (
    <Fade className="flex flex-col gap-9">
      <StepHeader eyebrow="Seu relato" title="Conte-nos o que aconteceu de forma resumida"
        desc="Escreva com suas palavras, sem termos jurídicos. Datas, valores e o que você já tentou fazer ajudam na análise." />
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="relato" className="text-sm font-semibold text-slate-900">O que aconteceu</label>
          <button type="button" onClick={() => setText(EXAMPLE)} className={cx("rounded text-[13px] font-medium text-[#1F4787] underline underline-offset-[3px] hover:text-[#132D56]", FOCUS)}>Usar um exemplo</button>
        </div>
        <textarea id="relato" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="relato-hint"
          placeholder="Ex.: Comprei um sofá em janeiro, paguei à vista e ele chegou com defeito. A loja não respondeu às minhas mensagens…"
          className="min-h-[208px] w-full resize-y rounded-xl border border-slate-300 bg-white p-[18px] text-base leading-[1.65] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#4A78C0] focus:ring-[3px] focus:ring-[#4A78C0]/25" />
        <div id="relato-hint" className="flex justify-between gap-3 text-[13px]">
          <span className={len >= MIN ? "text-[#3B5E45]" : "text-slate-500"}>
            {len >= MIN ? "Ótimo. Isso já é suficiente para a análise." : len === 0 ? "Algumas frases bastam." : `Escreva mais um pouco: faltam ${MIN - len} caracteres.`}
          </span>
          <span className="tabular-nums text-slate-500">{text.length} caracteres</span>
        </div>
      </div>
      <SecureUpload files={files} setFiles={setFiles} />
      <div className="flex flex-col gap-3.5 pt-1">
        <Button disabled={!can} onClick={onAnalyze} className="h-14 w-full rounded-[10px] text-base font-semibold">
          Analisar meu caso<ArrowRight className="h-[18px] w-[18px]" aria-hidden />
        </Button>
        <span className="flex items-center justify-center gap-2 text-center text-[13px] text-slate-500">
          <Clock className="h-3.5 w-3.5 flex-none" aria-hidden />A análise leva menos de um minuto e não gera nenhum custo.
        </span>
      </div>
    </Fade>
  );
}

function StepAnalyzing({ idx }) {
  return (
    <Fade className="flex flex-col items-center gap-7 pt-12 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-[#EEF3FB] text-[#183A6E]"><Shield className="h-8 w-8" aria-hidden /></span>
      <div className="flex flex-col gap-2.5" aria-live="polite">
        <h1 className="text-[26px] font-semibold tracking-[-.02em]">Analisando seu caso</h1>
        <p className="text-base text-slate-600">Isso leva alguns segundos. Você não precisa fazer nada.</p>
      </div>
      <ol className="flex w-full max-w-[360px] flex-col gap-3.5 rounded-xl border border-slate-200 px-[22px] py-5 text-left">
        {ANALYZE.map((label, i) => {
          const done = i < idx, active = i === idx;
          return (
            <li key={label} className={cx("flex items-center gap-3 text-sm font-medium transition-colors", done || active ? "text-slate-900" : "text-slate-400")}>
              <span className={cx("flex h-6 w-6 flex-none items-center justify-center rounded-full",
                done ? "bg-[#4A7556] text-white" : active ? "bg-[#EEF3FB] text-[#183A6E]" : "bg-slate-100")}>
                {done && <Check className="h-3.5 w-3.5" aria-hidden />}
                {active && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
    </Fade>
  );
}

function StepAnonymize({ text, files, onConfirm, onBack }) {
  const [reveal, setReveal] = useState(false);
  const { segs, hits } = redact(text);
  const counts = hits.reduce((a, h) => ({ ...a, [h.label]: (a[h.label] || 0) + 1 }), {});
  const n = hits.length;
  const valid = files.filter((f) => !f.error);
  return (
    <Fade className="flex flex-col gap-8">
      <StepHeader eyebrow="Privacidade" title="Revise o que vamos esconder"
        desc={n
          ? `Encontramos ${n} ${n === 1 ? "dado pessoal" : "dados pessoais"} no seu relato. Eles ficam ocultos para a outra parte e para o mediador até você decidir compartilhar.`
          : "Não encontramos dados pessoais no seu relato. Os documentos enviados também foram verificados."} />

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_6px_16px_rgba(15,23,42,.05)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <EyeOff className="h-4 w-4 text-[#183A6E]" aria-hidden />{reveal ? "Versão original" : "Como a outra parte verá"}
          </span>
          <Button variant="outline" aria-pressed={reveal} onClick={() => setReveal((r) => !r)} className="h-8 gap-1.5 rounded-md px-3 text-[13px]">
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{reveal ? "Ocultar dados" : "Mostrar originais"}
          </Button>
        </div>
        <p className="whitespace-pre-wrap break-words px-5 py-6 text-[17px] leading-[1.9] text-slate-900">
          {segs.map((g, i) =>
            !g.label ? <React.Fragment key={i}>{g.text}</React.Fragment>
              : reveal ? <mark key={i} className="rounded-[3px] border-b-2 border-[#7A9FD6] bg-[#EEF3FB] px-[3px] text-[#132D56]">{g.text}</mark>
              : <span key={i} title={`${g.label} oculto`} aria-label={`${g.label} oculto`}
                  className="inline-block rounded bg-slate-900 px-2 align-[1px] text-[11px] font-semibold leading-[22px] tracking-[.08em] text-white">{g.label.toUpperCase()}</span>
          )}
        </p>
        {n > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 pb-[18px] pt-3.5">
            {Object.entries(counts).map(([k, v]) => (
              <span key={k} className="inline-flex h-[26px] items-center rounded-full border border-[#D5E1F4] bg-[#EEF3FB] px-2.5 text-xs font-medium text-[#132D56]">{k} · {v}</span>
            ))}
          </div>
        )}
        {reveal && <div className="px-5 pb-[18px] text-xs text-slate-500">Só você vê esta versão.</div>}
      </section>

      {valid.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="text-sm font-semibold text-slate-900">Documentos verificados</span>
          {valid.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-[10px] border border-slate-200 px-3.5 py-3">
              <ShieldCheck className="h-[18px] w-[18px] flex-none text-[#3B5E45]" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.name}</span>
              <span className="flex-none text-xs text-[#3B5E45]">Dados pessoais ocultos</span>
            </div>
          ))}
        </div>
      )}

      <Note icon={Info} tone="muted">Algo ficou visível e não deveria? Volte e edite o relato antes de confirmar.</Note>

      <div className="flex flex-col gap-2.5">
        <Button onClick={onConfirm} className="min-h-14 w-full rounded-[10px] px-6 py-3 text-base font-semibold">
          <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />Confirmo que meus dados estão protegidos
        </Button>
        <Button variant="ghost" onClick={onBack} className="h-12 w-full rounded-[10px] text-[15px]">
          <ArrowLeft className="h-4 w-4" aria-hidden />Voltar e editar
        </Button>
      </div>
    </Fade>
  );
}

const TIMELINE = [
  { state: "done", title: "Relato enviado", desc: "Texto e documentos criptografados" },
  { state: "done", title: "Dados pessoais protegidos", desc: "Você confirmou a anonimização" },
  { state: "active", title: "Apreciação do avaliador", desc: "Em andamento" },
  { state: "todo", title: "Resultado e proposta de mediação", desc: "Disponível após o parecer" },
];

function StepReview() {
  return (
    <Fade className="flex flex-col gap-8">
      <StepHeader eyebrow="Em apreciação" title="Seu caso está com um avaliador"
        desc="Um juiz aposentado da nossa rede vai ler seu relato anonimizado e dar um parecer. Ele não vê seu nome nem seus dados pessoais." />
      <section className="flex flex-col gap-[22px] rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,.04),0_6px_16px_rgba(15,23,42,.05)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#F4E6C2] bg-[#FBF6EA] px-3 text-[13px] font-medium text-[#75531A]">
            <Clock className="h-3.5 w-3.5" aria-hidden />Aguardando Juiz
          </span>
          <span className="text-[13px] font-medium text-slate-600">Prazo estimado: até 2 dias úteis</span>
        </div>
        <ol className="flex flex-col">
          {TIMELINE.map((t, i) => (
            <li key={t.title} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                <span className={cx("flex h-7 w-7 flex-none items-center justify-center rounded-full",
                  t.state === "done" ? "bg-[#4A7556] text-white" : t.state === "active" ? "border-2 border-[#183A6E] bg-[#EEF3FB] text-[#183A6E]" : "border-2 border-slate-200 bg-slate-100")}>
                  {t.state === "done" && <Check className="h-[15px] w-[15px]" aria-hidden />}
                  {t.state === "active" && <Clock className="h-3.5 w-3.5" aria-hidden />}
                </span>
                {i < TIMELINE.length - 1 && <span className={cx("min-h-5 w-0.5 flex-1", t.state === "done" ? "bg-[#BFD8C5]" : "bg-slate-200")} />}
              </div>
              <div className={cx("flex flex-col gap-1 pt-[3px]", i < TIMELINE.length - 1 && "pb-5")}>
                <span className={cx("text-[15px] font-semibold", t.state === "active" ? "text-[#183A6E]" : t.state === "todo" ? "text-slate-500" : "text-slate-900")}>{t.title}</span>
                <span className={cx("text-[13px]", t.state === "todo" ? "text-slate-500" : "text-slate-600")}>{t.desc}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <Note icon={Info}>Você pode fechar esta página. Avisaremos por e-mail e por aqui quando o parecer estiver pronto.</Note>
    </Fade>
  );
}

function ProbabilityCard({ score, text, files }) {
  const t = tierFor(score);
  const R = 66, C = 2 * Math.PI * R;
  const [on, setOn] = useState(false);
  useEffect(() => { const id = setTimeout(() => setOn(true), 80); return () => clearTimeout(id); }, []);
  const factors = [
    /R\$\s?\d/.test(text) ? [true, "Valores e datas informados no relato"] : [false, "Relato sem valores informados"],
    files.some((f) => !f.error) ? [true, "Provas documentais anexadas"] : [false, "Nenhum documento anexado"],
    t === TIERS.low ? [false, "Jurisprudência desfavorável em casos semelhantes"] : [true, "Jurisprudência favorável em casos semelhantes"],
  ];
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-7 shadow-[0_1px_2px_rgba(15,23,42,.04),0_10px_28px_rgba(15,23,42,.07)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-[#EEF3FB] text-[#183A6E]"><Scale className="h-5 w-5" aria-hidden /></span>
          <h2 className="text-[15px] font-semibold">Probabilidade de êxito</h2>
        </div>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium" style={{ background: t.soft, color: t.text, borderColor: t.border }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.main }} />{t.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-7">
        <div className="relative h-[156px] w-[156px] flex-none" role="img" aria-label={`${score}% de chance de êxito`}>
          <svg width="156" height="156" className="-rotate-90">
            <circle cx="78" cy="78" r={R} fill="none" stroke="#F1F5F9" strokeWidth="12" />
            <circle cx="78" cy="78" r={R} fill="none" stroke={t.main} strokeWidth="12" strokeLinecap="round"
              strokeDasharray={`${((on ? score : 0) * C) / 100} 999`} className="transition-[stroke-dasharray] duration-[900ms] ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-[40px] font-semibold leading-none tracking-[-.03em] tabular-nums">{score}%</span>
            <span className="text-[11px] font-medium uppercase tracking-[.06em]" style={{ color: t.text }}>{t.label}</span>
          </div>
        </div>
        <div className="flex min-w-[220px] flex-1 flex-col gap-3">
          <span className="text-[22px] font-semibold leading-snug tracking-[-.01em]">{score}% de chance de êxito</span>
          <p className="text-[15px] leading-relaxed text-slate-700">{t.copy}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-[18px]">
        <span className="text-xs font-medium text-slate-500">O que pesou na estimativa</span>
        {factors.map(([up, label]) => {
          const Icon = up ? TrendingUp : TrendingDown;
          return (
            <div key={label} className="flex items-center gap-2.5 text-sm text-slate-700">
              <Icon className={cx("h-4 w-4 flex-none", up ? "text-[#4A7556]" : "text-[#9A3A34]")} aria-hidden />{label}
            </div>
          );
        })}
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-normal text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />Estimativa estatística baseada em decisões similares. Não constitui decisão judicial.
      </p>
    </section>
  );
}

function StepResult({ score, text, files }) {
  const [med, setMed] = useState("idle");
  const t = tierFor(score);
  return (
    <Fade className="flex flex-col gap-8">
      <StepHeader eyebrow="Resultado" title={t.headline} desc="Um avaliador revisou seu caso anonimizado. Comparamos o parecer com decisões em casos semelhantes." />
      <ProbabilityCard score={score} text={text} files={files} />

      {med === "idle" && (
        <section className="flex flex-col gap-5 rounded-2xl bg-[#183A6E] p-7 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10"><UserCheck className="h-[22px] w-[22px]" aria-hidden /></span>
          <div className="flex flex-col gap-2.5">
            <h2 className="text-[22px] font-semibold leading-snug tracking-[-.01em] [text-wrap:pretty]">Deseja que um especialista negocie um acordo para você?</h2>
            <p className="text-[15px] leading-relaxed text-[#D5E1F4]">Um advogado mediador conversa com a outra parte em seu nome. Nenhum acordo é fechado sem a sua aprovação.</p>
          </div>
          <ul className="flex flex-col gap-2.5 text-sm">
            {["Seus dados continuam anonimizados", "Você acompanha cada proposta por aqui", "Pode desistir a qualquer momento"].map((x) => (
              <li key={x} className="flex items-center gap-2.5"><Check className="h-4 w-4 text-[#9DC2A6]" aria-hidden />{x}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2.5 pt-1">
            <button type="button" onClick={() => setMed("requested")}
              className="inline-flex h-[52px] flex-[1_1_220px] items-center justify-center gap-2.5 rounded-[10px] bg-white px-[22px] text-[15px] font-semibold text-[#132D56] transition hover:bg-[#EEF3FB] active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#183A6E]">
              Sim, quero um especialista<ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setMed("declined")}
              className="h-[52px] rounded-[10px] border border-white/35 px-5 text-[15px] font-medium text-white transition hover:border-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#183A6E]">
              Agora não
            </button>
          </div>
        </section>
      )}

      {med === "requested" && (
        <Fade className="flex items-start gap-4 rounded-2xl border border-[#DDEBE0] bg-[#F1F6F2] p-6">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#3B5E45] text-white"><Check className="h-5 w-5" aria-hidden /></span>
          <div className="flex min-w-0 flex-1 flex-col gap-2" aria-live="polite">
            <span className="text-[17px] font-semibold text-[#243829]">Pedido de mediação enviado</span>
            <p className="text-[15px] leading-relaxed text-[#2F4A37]">Um advogado mediador vai analisar seu caso e entrar em contato em até 2 dias úteis. Avisaremos por e-mail.</p>
            <button type="button" onClick={() => setMed("idle")} className="self-start rounded py-1.5 text-sm font-medium text-[#2F4A37] underline underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7556]">Cancelar pedido</button>
          </div>
        </Fade>
      )}

      {med === "declined" && (
        <Fade className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <span className="text-base font-semibold">Tudo bem. Seu resultado fica salvo.</span>
          <p className="text-[15px] leading-relaxed text-slate-600">Você pode pedir a mediação quando quiser, a partir da sua página de casos.</p>
          <Button variant="outline" onClick={() => setMed("idle")} className="h-11 self-start rounded-lg px-4 text-sm">Rever a oferta de mediação</Button>
        </Fade>
      )}
    </Fade>
  );
}

/* ---------- App ---------- */
export default function VisaoDemandante({ initialStep = 1, score = 85 }) {
  const [step, setStep] = useState(initialStep);
  const [text, setText] = useState(initialStep > 1 ? EXAMPLE : "");
  const [files, setFiles] = useState([]);
  const [aIdx, setAIdx] = useState(0);
  const [exitOpen, setExitOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const timer = useRef();

  const go = (s) => {
    clearTimeout(timer.current);
    if (s !== 1 && text.trim().length < MIN) setText(EXAMPLE);
    setStep(s); setSignedOut(false); setExitOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (step !== "analyzing") return;
    timer.current = setTimeout(() => (aIdx < ANALYZE.length - 1 ? setAIdx(aIdx + 1) : go(2)), aIdx < ANALYZE.length - 1 ? 950 : 700);
    return () => clearTimeout(timer.current);
  }, [step, aIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!exitOpen) return;
    const onKey = (e) => e.key === "Escape" && setExitOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitOpen]);

  const stepNum = step === "analyzing" ? 1 : step === "review" ? 3 : step;

  return (
    <div className="min-h-screen bg-white font-['Inter'] text-slate-900 antialiased">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center overflow-hidden rounded-[10px] border border-slate-200 bg-white">
              <img src="/assets/peacelaw-logo.jpeg" alt="" className="h-[170%] w-[170%] max-w-none object-contain" />
            </span>
            <span className="text-base font-semibold tracking-[-.01em]">PeaceLaw</span>
          </div>
          <Button variant="ghost" onClick={() => setExitOpen(true)} className="h-10 rounded-lg px-3.5 text-sm"><LogOut className="h-4 w-4" aria-hidden />Sair</Button>
        </div>
        {!signedOut && (
          <div className="mx-auto flex max-w-[688px] flex-col gap-2 px-6 pb-3.5">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-semibold text-[#183A6E]">Passo {stepNum} de 3</span>
              <span className="font-medium text-slate-500">{step === "analyzing" ? "Analisando…" : step === "review" ? "Em apreciação" : LABELS[stepNum - 1]}</span>
            </div>
            <div role="progressbar" aria-label="Progresso" aria-valuemin={1} aria-valuemax={3} aria-valuenow={stepNum} className="flex gap-1.5">
              {[1, 2, 3].map((i) => (
                <span key={i} className={cx("h-1 flex-1 rounded-full transition-colors duration-300", i < stepNum || (i === stepNum && step !== "review") ? "bg-[#183A6E]" : i === stepNum ? "bg-[#7A9FD6]" : "bg-slate-200")} />
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[688px] px-6 pb-40 pt-14">
        {signedOut ? (
          <Fade className="flex flex-col items-center gap-5 pt-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-[#EEF3FB] text-[#183A6E]"><Lock className="h-7 w-7" aria-hidden /></span>
            <h1 className="text-[26px] font-semibold tracking-[-.02em]">Você saiu com segurança</h1>
            <p className="max-w-[44ch] text-base leading-relaxed text-slate-600">Seu caso continua salvo e protegido. Entre novamente para continuar de onde parou.</p>
            <Button onClick={() => setSignedOut(false)} className="h-12 rounded-[10px] px-6 text-[15px] font-semibold">Entrar novamente</Button>
          </Fade>
        ) : step === 1 ? (
          <StepSubmit text={text} setText={setText} files={files} setFiles={setFiles} onAnalyze={() => { setAIdx(0); setStep("analyzing"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        ) : step === "analyzing" ? (
          <StepAnalyzing idx={aIdx} />
        ) : step === "review" ? (
          <StepReview />
        ) : step === 2 ? (
          <StepAnonymize text={text} files={files} onConfirm={() => go("review")} onBack={() => go(1)} />
        ) : (
          <StepResult score={score} text={text} files={files} />
        )}
      </main>

      {exitOpen && (
        <div onClick={() => setExitOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="exit-title" onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[400px] flex-col gap-3 rounded-2xl bg-white p-6 shadow-[0_20px_48px_rgba(15,23,42,.24)] animate-[fadeUp_220ms_cubic-bezier(.2,0,0,1)]">
            <h2 id="exit-title" className="text-lg font-semibold">Sair agora?</h2>
            <p className="text-[15px] leading-relaxed text-slate-600">Seu progresso fica salvo e protegido. Você pode continuar depois, de qualquer aparelho.</p>
            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <Button variant="outline" autoFocus onClick={() => setExitOpen(false)} className="h-11 rounded-lg px-4 text-sm">Continuar aqui</Button>
              <Button onClick={() => { setExitOpen(false); setSignedOut(true); }} className="h-11 rounded-lg px-4 text-sm">Sair</Button>
            </div>
          </div>
        </div>
      )}

      {/* Navegação de teste do fluxo */}
      <nav aria-label="Simular estado do wizard" className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-900 p-1.5 shadow-[0_8px_24px_rgba(15,23,42,.25)]">
        <span className="pl-2 pr-2.5 text-xs font-medium text-slate-400">Simular</span>
        {[[1, "1 · Relato"], [2, "2 · Privacidade"], ["review", "Em apreciação"], [3, "3 · Resultado"]].map(([i, label]) => {
          const cur = !signedOut && step === i;
          return (
            <button key={i} type="button" onClick={() => go(i)} aria-current={cur ? "step" : undefined}
              className={cx("h-8 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0]",
                cur ? "bg-white text-slate-900" : "text-slate-300 hover:bg-white/10 hover:text-white")}>
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
