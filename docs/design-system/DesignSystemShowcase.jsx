import React, { useEffect, useRef, useState } from "react";
import {
  Scale, ShieldCheck, Lock, Upload, FileText, Check, Clock, EyeOff, ArrowRight,
  Plus, Trash2, X, Info, Loader2, AlertTriangle, TrendingUp, TrendingDown,
  User, Gavel, Kanban,
} from "lucide-react";

/* ---------- Tokens ---------- */
const PALETTE = [
  { name: "Primária · Safira", tw: "primary", role: "Autoridade e confiança. Ações principais, navegação e links.",
    steps: { 50: "#EEF3FB", 100: "#D5E1F4", 200: "#ABC3E8", 300: "#7A9FD6", 400: "#4A78C0", 500: "#2B5BA6", 600: "#1F4787", 700: "#183A6E", 800: "#132D56", 900: "#0E2140", 950: "#091629" } },
  { name: "Secundária · Sálvia", tw: "sage", role: "Sucesso e acordo. Confirmações, score alto, casos prontos.",
    steps: { 50: "#F1F6F2", 100: "#DDEBE0", 200: "#BFD8C5", 300: "#9DC2A6", 400: "#79A784", 500: "#5E8F6B", 600: "#4A7556", 700: "#3B5E45", 800: "#2F4A37", 900: "#243829" } },
  { name: "Erro · Carmim contido", tw: "danger", role: "Alertas e ações destrutivas. Usado com parcimônia.",
    steps: { 50: "#FBF1F0", 100: "#F5DCDA", 200: "#EBBAB6", 300: "#DC918B", 400: "#C9665F", 500: "#B54740", 600: "#9A3A34", 700: "#7E302B", 800: "#632723", 900: "#4A1E1B" } },
  { name: "Aviso · Âmbar", tw: "warning", role: "Espera e atenção. Prazos, score médio, casos aguardando juiz.",
    steps: { 50: "#FBF6EA", 100: "#F4E6C2", 200: "#EACF8C", 300: "#DDB45A", 400: "#CC9C3A", 500: "#B7862A", 600: "#946A1E", 700: "#75531A", 800: "#5A4016", 900: "#422F11" } },
  { name: "Neutra · Slate", tw: "slate", role: "Fundos, superfícies, bordas e texto. Escala padrão do Tailwind.",
    steps: { 50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1", 400: "#94A3B8", 500: "#64748B", 600: "#475569", 700: "#334155", 800: "#1E293B", 900: "#0F172A", 950: "#020617" } },
];

const SEMANTIC = [
  ["--background", "slate-50", "#F8FAFC"], ["--foreground", "slate-900", "#0F172A"], ["--card", "white", "#FFFFFF"],
  ["--primary", "primary-700", "#183A6E"], ["--ring", "primary-400", "#4A78C0"], ["--border", "slate-200", "#E2E8F0"],
  ["--muted-foreground", "slate-600", "#475569"], ["--success", "sage-600", "#4A7556"], ["--warning", "warning-600", "#946A1E"],
  ["--destructive", "danger-600", "#9A3A34"],
];

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const cx = (...c) => c.filter(Boolean).join(" ");

/* ---------- Primitives (shadcn-like) ---------- */
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium font-['Inter'] transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0] focus-visible:ring-offset-2 focus-visible:ring-offset-white " +
  "active:scale-[.98] disabled:pointer-events-none disabled:opacity-45";

const BTN_VARIANT = {
  primary: "bg-[#183A6E] text-white border border-[#183A6E] shadow-sm hover:bg-[#132D56] hover:border-[#132D56] hover:shadow-md",
  secondary: "bg-[#4A7556] text-white border border-[#4A7556] shadow-sm hover:bg-[#3B5E45] hover:border-[#3B5E45] focus-visible:ring-[#79A784]",
  outline: "bg-white text-slate-900 border border-slate-300 shadow-sm hover:bg-slate-50 hover:border-slate-400",
  ghost: "bg-transparent text-slate-700 border border-transparent hover:bg-slate-100 hover:text-slate-900",
  destructive: "bg-[#9A3A34] text-white border border-[#9A3A34] shadow-sm hover:bg-[#7E302B] hover:border-[#7E302B] focus-visible:ring-[#C9665F]",
};
const BTN_SIZE = {
  sm: "h-8 px-3 text-[13px] rounded-md",
  md: "h-10 px-4 text-sm rounded-lg",
  lg: "h-12 px-6 text-base rounded-lg",
  icon: "h-10 w-10 rounded-lg",
};

function Button({ variant = "primary", size = "md", className, children, ...props }) {
  return (
    <button type="button" className={cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)} {...props}>
      {children}
    </button>
  );
}

const BADGE = {
  waiting: { subtle: "bg-[#FBF6EA] text-[#75531A] border-[#F4E6C2]", solid: "bg-[#946A1E] text-white border-[#946A1E]", icon: Clock, label: "Aguardando Juiz" },
  ready: { subtle: "bg-[#F1F6F2] text-[#2F4A37] border-[#DDEBE0]", solid: "bg-[#3B5E45] text-white border-[#3B5E45] shadow-[0_2px_8px_rgba(59,94,69,.25)]", icon: Check, label: "Pronto para Acordo" },
  anon: { subtle: "bg-[#EEF3FB] text-[#132D56] border-[#D5E1F4]", solid: "bg-[#132D56] text-white border-[#132D56]", icon: EyeOff, solidIcon: ShieldCheck, label: "Anonimizado" },
};

function StatusBadge({ status, tone = "subtle", size = "md" }) {
  const b = BADGE[status];
  const Icon = tone === "solid" && b.solidIcon ? b.solidIcon : b.icon;
  return (
    <span className={cx(
      "inline-flex items-center gap-1.5 rounded-full border font-medium font-['Inter']",
      size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]",
      b[tone]
    )}>
      <Icon aria-hidden className={size === "sm" ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} strokeWidth={2} />
      {b.label}
    </span>
  );
}

const Card = ({ className, children }) => (
  <div className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>{children}</div>
);

const SectionHeader = ({ eyebrow, title, desc, id }) => (
  <div id={id} className="flex max-w-[68ch] scroll-mt-24 flex-col gap-2">
    <span className="text-xs font-semibold uppercase tracking-[.08em] text-slate-500">{eyebrow}</span>
    <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
    {desc && <p className="text-[15px] leading-relaxed text-slate-600">{desc}</p>}
  </div>
);

/* ---------- Sections ---------- */
function ColorTokens() {
  const [copied, setCopied] = useState(null);
  const copy = (hex, key) => {
    navigator.clipboard?.writeText(hex).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader id="cores" eyebrow="01 · Tokens" title="Paleta de cores"
        desc="Clique em qualquer cor para copiar o HEX. A razão indica o contraste da cor como texto sobre branco." />
      {PALETTE.map((g) => (
        <Card key={g.tw} className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold text-slate-900">{g.name}</span>
              <span className="text-[13px] text-slate-500">{g.role}</span>
            </div>
            <code className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {g.tw === "slate" ? "slate-* (padrão)" : `${g.tw}-*`}
            </code>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2.5">
            {Object.entries(g.steps).map(([step, hex]) => {
              const key = g.tw + step;
              const r = contrast(hex, "#FFFFFF");
              const lvl = r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA grande" : "—";
              const ink = r > contrast(hex, "#0F172A") ? "text-white" : "text-slate-900";
              return (
                <button key={key} type="button" onClick={() => copy(hex, key)} aria-label={`Copiar ${hex} (${g.tw}-${step})`}
                  className="group flex flex-col gap-1.5 rounded-lg text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0] focus-visible:ring-offset-2">
                  <span className={cx("flex h-16 items-start rounded-lg border border-slate-900/5 p-2 text-xs font-semibold", ink)} style={{ background: hex }}>{step}</span>
                  <span className="font-mono text-[11px] text-slate-700">{copied === key ? "Copiado" : hex}</span>
                  <span className="text-[11px] text-slate-500">{r.toFixed(1).replace(".", ",")}:1 {lvl}</span>
                </button>
              );
            })}
          </div>
        </Card>
      ))}
      <Card className="flex flex-col gap-3.5 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold text-slate-900">Tokens semânticos</span>
          <span className="text-[13px] text-slate-500">Mapeamento para as variáveis CSS do shadcn/ui.</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-2">
          {SEMANTIC.map(([name, ref, hex]) => (
            <div key={name} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-2.5 py-2">
              <span className="h-5 w-5 flex-none rounded-md border border-slate-900/10" style={{ background: hex }} />
              <code className="flex-1 text-xs text-slate-900">{name}</code>
              <code className="text-xs text-slate-500">{ref}</code>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function TypeRow({ spec, children }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-t border-slate-100 pt-4">
      <span className="w-[120px] flex-none font-mono text-[11px] text-slate-500">{spec}</span>
      <div className="min-w-[220px] flex-1">{children}</div>
    </div>
  );
}

function Typography() {
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader id="tipografia" eyebrow="02 · Tokens" title="Tipografia"
        desc="Inter para interface. Lora para pareceres, documentos e toda leitura longa da visão do juiz." />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-4">
        <Card className="flex flex-col gap-5 p-6 shadow-none">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">Inter · Interface</span>
            <code className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">font-sans</code>
          </div>
          <TypeRow spec="H1 · 36/44 · 600"><h1 className="text-[36px] font-semibold leading-[44px] tracking-[-.02em]">Resolva sem ir ao tribunal</h1></TypeRow>
          <TypeRow spec="H2 · 24/32 · 600"><h2 className="text-2xl font-semibold leading-8 tracking-tight">Revise as informações do caso</h2></TypeRow>
          <TypeRow spec="Body · 16/24 · 400"><p className="text-base leading-6 text-slate-700">Avisaremos quando o mediador aceitar seu caso. O prazo médio é de 2 dias úteis.</p></TypeRow>
          <TypeRow spec="Caption · 12/16 · 500"><span className="text-xs font-medium text-slate-500">Última atualização há 3 minutos</span></TypeRow>
        </Card>
        <Card className="flex flex-col gap-5 p-6 shadow-none">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">Lora · Leitura do juiz</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#DDEBE0] bg-[#F1F6F2] px-2.5 py-1 text-xs font-medium text-[#2F4A37]">
              <Check className="h-3.5 w-3.5" aria-hidden /> 17,9:1 · AAA
            </span>
          </div>
          <article className="flex flex-col gap-3.5 border-t border-slate-100 pt-5">
            <span className="text-xs font-medium uppercase tracking-[.06em] text-slate-600">Caso nº 2026-0418 · Parecer</span>
            <h3 className="font-['Lora'] text-[30px] font-semibold leading-[38px] text-slate-900">Rescisão de contrato de prestação de serviços</h3>
            <p className="max-w-[62ch] font-['Lora'] text-[19px] leading-8 text-slate-900">
              Considerando os documentos apresentados pelas partes, verifica-se que o contrato foi rescindido sem a notificação
              prévia de trinta dias prevista na cláusula 7ª. A ausência de aviso, por si só, não afasta o direito ao pagamento dos serviços já prestados.
            </p>
            <span className="font-['Lora'] text-[15px] italic text-slate-700">Body 19/32 · Lora 400 · máx. 62 caracteres por linha</span>
          </article>
        </Card>
      </div>
    </section>
  );
}

function ButtonRow({ label, children, last }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-6 gap-y-3 py-5", !last && "border-b border-slate-100")}>
      <span className="w-[120px] flex-none text-xs font-medium text-slate-500">{label}</span>
      <div className="flex min-w-[260px] flex-1 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Buttons() {
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader id="botoes" eyebrow="03 · Componentes" title="Botões"
        desc="Use Tab para ver o anel de foco. Altura mínima de 40px; 48px no wizard do cliente." />
      <Card className="px-6 py-2 shadow-none">
        <ButtonRow label="Variantes">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </ButtonRow>
        <ButtonRow label="Tamanhos">
          <Button size="sm">Small · 32</Button>
          <Button size="md">Medium · 40</Button>
          <Button size="lg">Large · 48</Button>
        </ButtonRow>
        <ButtonRow label="Com ícone">
          <Button><Upload className="h-4 w-4" aria-hidden />Enviar documentos</Button>
          <Button variant="secondary"><Check className="h-4 w-4" aria-hidden />Aceitar acordo</Button>
          <Button variant="outline">Continuar<ArrowRight className="h-4 w-4" aria-hidden /></Button>
          <Button variant="outline" size="icon" aria-label="Adicionar parte"><Plus className="h-[18px] w-[18px]" /></Button>
          <Button variant="ghost" size="icon" aria-label="Excluir documento" className="text-[#9A3A34] hover:bg-[#FBF1F0] hover:text-[#7E302B]"><Trash2 className="h-[18px] w-[18px]" /></Button>
        </ButtonRow>
        <ButtonRow label="Estados" last>
          <Button disabled>Primary disabled</Button>
          <Button variant="outline" disabled>Outline disabled</Button>
          <Button disabled aria-busy="true" className="disabled:opacity-85"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Analisando caso…</Button>
        </ButtonRow>
      </Card>
    </section>
  );
}

function StatusBadges() {
  const cases = [
    { id: "#2026-0418", title: "Rescisão contratual", meta: "R$ 18.400 · atualizado hoje", status: "ready" },
    { id: "#2026-0392", title: "Cobrança indevida", meta: "R$ 4.250 · há 2 dias", status: "waiting" },
    { id: "#2026-0377", title: "Vício de produto", meta: "R$ 2.980 · há 5 dias", status: "anon" },
  ];
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader id="status" eyebrow="04 · Componentes" title="Status do caso"
        desc="Cor nunca carrega o significado sozinha: todo status tem ícone e rótulo." />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-4">
        <Card className="flex flex-col gap-5 p-6 shadow-none">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-slate-500">Sutil · padrão</span>
            <div className="flex flex-wrap gap-2.5">{["waiting", "ready", "anon"].map((s) => <StatusBadge key={s} status={s} />)}</div>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-5">
            <span className="text-xs font-medium text-slate-500">Sólido · destaque</span>
            <div className="flex flex-wrap gap-2.5">{["waiting", "ready", "anon"].map((s) => <StatusBadge key={s} status={s} tone="solid" />)}</div>
          </div>
        </Card>
        <Card className="flex flex-col gap-3 p-6 shadow-none">
          <span className="text-xs font-medium text-slate-500">Em contexto · card do Kanban</span>
          <ul className="flex flex-col gap-2">
            {cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3.5 py-3 transition hover:border-slate-300 hover:shadow-md">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-slate-900">{c.id} · {c.title}</span>
                  <span className="text-xs text-slate-500">{c.meta}</span>
                </div>
                <StatusBadge status={c.status} size="sm" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

const TIERS = {
  high: { main: "#4A7556", soft: "#F1F6F2", border: "#DDEBE0", text: "#2F4A37", label: "Alta",
    copy: "Casos com fatos e provas semelhantes tiveram decisão favorável na maioria das vezes. Um acordo agora tende a preservar valor e prazo." },
  mid: { main: "#B7862A", soft: "#FBF6EA", border: "#F4E6C2", text: "#75531A", label: "Média",
    copy: "O resultado depende de pontos ainda em aberto. Reforçar a prova documental pode mudar a estimativa." },
  low: { main: "#B54740", soft: "#FBF1F0", border: "#F5DCDA", text: "#7E302B", label: "Baixa",
    copy: "Decisões em casos semelhantes foram majoritariamente desfavoráveis. A mediação costuma ser o caminho de menor risco." },
};
const tierFor = (s) => (s >= 70 ? TIERS.high : s >= 40 ? TIERS.mid : TIERS.low);

function ProbabilityCard({ score }) {
  const t = tierFor(score);
  const R = 56, C = 2 * Math.PI * R;
  return (
    <Card className="flex flex-col gap-[22px] p-6 shadow-md shadow-slate-900/5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-[#EEF3FB] text-[#183A6E]"><Scale className="h-5 w-5" aria-hidden /></span>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[15px] font-semibold text-slate-900">Probabilidade de êxito</h3>
            <span className="text-xs text-slate-500">Caso nº 2026-0418 · Rescisão contratual</span>
          </div>
        </div>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-200"
          style={{ background: t.soft, color: t.text, borderColor: t.border }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.main }} />{t.label}
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-6">
        <div className="relative h-[132px] w-[132px] flex-none" role="img" aria-label={`Score ${score} por cento, probabilidade ${t.label.toLowerCase()}`}>
          <svg width="132" height="132" className="-rotate-90">
            <circle cx="66" cy="66" r={R} fill="none" stroke="#F1F5F9" strokeWidth="10" />
            <circle cx="66" cy="66" r={R} fill="none" stroke={t.main} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${(C * score) / 100} 999`} className="transition-all duration-300 ease-out" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-[34px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{score}%</span>
            <span className="text-[11px] font-medium uppercase tracking-[.06em]" style={{ color: t.text }}>{t.label}</span>
          </div>
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col gap-3.5">
          <p className="text-sm leading-relaxed text-slate-700">{t.copy}</p>
          <div className="flex flex-col gap-1.5">
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${score}%`, background: t.main }} />
              <span className="absolute inset-y-0 left-[40%] w-0.5 bg-white" />
              <span className="absolute inset-y-0 left-[70%] w-0.5 bg-white" />
            </div>
            <div className="grid grid-cols-[40fr_30fr_30fr] text-[11px] font-medium text-slate-500"><span>Baixa</span><span>Média</span><span>Alta</span></div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-[18px]">
        <span className="text-xs font-medium text-slate-500">Fatores considerados</span>
        {[
          [TrendingUp, "#4A7556", "Jurisprudência favorável em casos semelhantes"],
          [TrendingUp, "#4A7556", "Contrato e comprovantes de pagamento anexados"],
          [TrendingDown, "#9A3A34", "Ausência de notificação formal por escrito"],
        ].map(([Icon, color, label]) => (
          <div key={label} className="flex items-center gap-2.5 text-[13px] text-slate-700">
            <Icon className="h-[15px] w-[15px] flex-none" style={{ color }} aria-hidden />{label}
          </div>
        ))}
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-normal text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
        Estimativa estatística baseada em decisões similares. Não constitui decisão judicial.
      </p>
    </Card>
  );
}

function ScoreSection() {
  const [score, setScore] = useState(85);
  const t = tierFor(score);
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader id="score" eyebrow="05 · Padrões" title="Probabilidade de êxito" />
      <ProbabilityCard score={score} />
      <div className="flex flex-col gap-3 rounded-xl bg-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="score-sim" className="text-[13px] font-medium text-slate-700">Simular score</label>
          <div className="flex gap-1.5">
            {[85, 58, 24].map((v) => (
              <button key={v} type="button" onClick={() => setScore(v)} aria-pressed={score === v}
                className={cx("h-7 rounded-md border border-slate-300 px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0] focus-visible:ring-offset-2",
                  score === v ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50")}>{v}%</button>
            ))}
          </div>
        </div>
        <input id="score-sim" type="range" min="0" max="100" value={score} onChange={(e) => setScore(Number(e.target.value))}
          className="w-full cursor-pointer" style={{ accentColor: t.main }} />
      </div>
    </section>
  );
}

const ACCEPT = ["application/pdf", "image/jpeg", "image/png"];
const MAX = 25 * 1024 * 1024;
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function SecureUpload() {
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState([{ id: 1, name: "contrato-prestacao-servicos.pdf", size: 842000, progress: 100, error: null }]);
  const depth = useRef(0);
  const nid = useRef(2);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => {
      setFiles((fs) => fs.some((f) => !f.error && f.progress < 100)
        ? fs.map((f) => (!f.error && f.progress < 100 ? { ...f, progress: Math.min(100, f.progress + 3 + Math.random() * 5) } : f))
        : fs);
    }, 120);
    return () => clearInterval(t);
  }, []);

  const add = (list) => {
    const next = Array.from(list || []).map((f) => ({
      id: nid.current++, name: f.name, size: f.size, progress: 0,
      error: !ACCEPT.includes(f.type) && !/\.(pdf|jpe?g|png)$/i.test(f.name)
        ? "Formato não aceito. Envie PDF, JPG ou PNG."
        : f.size > MAX ? "Arquivo acima de 25 MB." : null,
    }));
    if (next.length) setFiles((fs) => [...next, ...fs]);
  };

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader id="upload" eyebrow="06 · Padrões" title="Upload seguro" />
      <Card className="flex flex-col gap-4 p-6 shadow-md shadow-slate-900/5">
        <label
          onDragEnter={(e) => { e.preventDefault(); depth.current++; setDrag(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDrag(false); }}
          onDrop={(e) => { e.preventDefault(); depth.current = 0; setDrag(false); add(e.dataTransfer.files); }}
          className={cx(
            "relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-5 py-9 text-center transition-colors duration-150",
            "focus-within:ring-2 focus-within:ring-[#4A78C0] focus-within:ring-offset-2",
            drag ? "border-[#2B5BA6] bg-[#EEF3FB]" : "border-slate-300 bg-slate-50 hover:border-[#4A78C0] hover:bg-[#F5F8FD]"
          )}>
          <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
            onChange={(e) => { add(e.target.files); e.target.value = ""; }} aria-label="Selecionar arquivos" />
          <span className={cx("flex h-14 w-14 items-center justify-center rounded-[14px] transition-colors duration-200",
            drag ? "bg-[#183A6E] text-white" : "bg-[#EEF3FB] text-[#183A6E]")}>
            <ShieldCheck className="h-[26px] w-[26px]" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold text-slate-900">{drag ? "Solte para enviar com segurança" : "Arraste PDFs ou provas para cá"}</span>
          <span className="text-sm text-slate-600">ou <span className="font-medium text-[#1F4787] underline underline-offset-[3px]">selecione do computador</span></span>
          <span className="text-xs text-slate-500">PDF, JPG ou PNG · até 25 MB por arquivo</span>
        </label>

        <p className="flex items-start gap-2.5 rounded-lg bg-[#EEF3FB] px-3.5 py-3 text-[13px] leading-normal text-[#132D56]">
          <Lock className="mt-px h-4 w-4 flex-none" aria-hidden />
          Seus documentos estão protegidos por criptografia de ponta a ponta e anonimizados por IA.
        </p>

        {files.length > 0 && (
          <ul className="flex flex-col gap-2" aria-live="polite">
            {files.map((f) => {
              const pct = Math.round(f.progress);
              const done = !f.error && pct >= 100;
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
                      {f.error ?? (done ? "Criptografado · dados pessoais anonimizados" : `${pct < 55 ? "Criptografando…" : "Anonimizando dados pessoais…"} ${pct}%`)}
                    </span>
                  </div>
                  <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0]">
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

/* ---------- Page ---------- */
const VISIONS = [
  { icon: User, title: "Cliente demandante", desc: "Wizard com uma decisão por tela e linguagem sem jargão.", spec: "Inter 16 · alvo 44px" },
  { icon: Gavel, title: "Juiz aposentado", desc: "Leitura longa em serifa, alto contraste, WCAG AAA.", spec: "Lora 18+ · contraste ≥ 7:1" },
  { icon: Kanban, title: "Advogado mediador", desc: "Kanban denso, status visíveis de relance.", spec: "Inter 14 · densidade alta" },
];
const NAV = [["cores", "Cores"], ["tipografia", "Tipografia"], ["botoes", "Botões"], ["status", "Status"], ["score", "Score"], ["upload", "Upload"]];

export default function DesignSystemShowcase() {
  return (
    <div className="min-h-screen bg-slate-50 font-['Inter'] text-slate-900 antialiased">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
        @media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}`}</style>

      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-[10px] border border-slate-200 bg-white">
              <img src="/assets/peacelaw-logo.jpeg" alt="PeaceLaw" className="h-[170%] w-[170%] max-w-none object-contain" />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-semibold leading-tight tracking-tight">PeaceLaw</span>
              <span className="text-xs leading-tight text-slate-500">Design System · Justiça Preditiva &amp; ODR · v0.1</span>
            </div>
          </div>
          <nav aria-label="Seções" className="flex flex-wrap gap-1 text-[13px] font-medium">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-md px-2.5 py-2 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A78C0]">{label}</a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1120px] flex-col gap-20 px-6 pb-24 pt-14">
        <section className="flex flex-col gap-7">
          <div className="flex max-w-[68ch] flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-[.08em] text-[#2B5BA6]">Fundação · Passo 1</span>
            <h1 className="text-4xl font-semibold leading-tight tracking-[-.02em]">Uma base visual para três formas de usar o mesmo caso</h1>
            <p className="text-base leading-relaxed text-slate-600">Tokens e componentes compartilhados entre o wizard do cliente, a leitura do juiz e o painel do mediador. Cada visão ajusta densidade e escala tipográfica, sem trocar de linguagem.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-4">
            {VISIONS.map(({ icon: Icon, title, desc, spec }) => (
              <Card key={title} className="flex flex-col gap-2.5 p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEF3FB] text-[#183A6E]"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                <span className="text-[15px] font-semibold">{title}</span>
                <span className="text-sm leading-normal text-slate-600">{desc}</span>
                <code className="text-xs text-slate-500">{spec}</code>
              </Card>
            ))}
          </div>
        </section>

        <ColorTokens />
        <Typography />
        <Buttons />
        <StatusBadges />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))] items-start gap-x-4 gap-y-6">
          <ScoreSection />
          <SecureUpload />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1120px] flex-wrap justify-between gap-3 px-6 py-6 text-xs text-slate-500">
          <span>Tokens prontos para tailwind.config e variáveis CSS do shadcn/ui.</span>
          <span>Contraste verificado conforme WCAG 2.1</span>
        </div>
      </footer>
    </div>
  );
}
