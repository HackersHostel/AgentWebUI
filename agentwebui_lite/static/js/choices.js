// The question card (AgentAsk and AskTypes boards). A model or agent asks with a ```choices block holding JSON;
// the answer goes back as the person's next message, so it works with any model and any ACP agent.
import { html, useState, useEffect, useRef, useMemo, cx } from './lib.js';
import { Icon } from './icons.js';

const LABEL = { single: 'Pick one', multi: 'Pick any', text: 'Your words', confirm: 'Confirm', scale: 'Scale', number: 'Number',
  date: 'Date', select: 'Search', rank: 'Order' };

// -> { questions: [...] } or null when the block isn't a usable question.
export function parseChoices(source) {
  let spec;
  try { spec = JSON.parse(source); } catch { return null; }
  const list = Array.isArray(spec?.questions) ? spec.questions : Array.isArray(spec) ? spec : [spec];
  const questions = list.filter((q) => q && typeof q === 'object' && (q.question || q.title)).map((q, i) => {
    const options = (Array.isArray(q.options) ? q.options : Array.isArray(q.choices) ? q.choices : []).map((o) => (typeof o === 'object' && o
      ? { label: String(o.label ?? o.name ?? o.value), value: String(o.value ?? o.label ?? o.name), description: o.description ? String(o.description) : '', recommended: !!o.recommended, danger: !!o.danger }
      : { label: String(o), value: String(o), description: '', recommended: false, danger: false }));
    let type = String(q.type || '').toLowerCase();
    if (!LABEL[type]) type = options.length ? (q.multiple ? 'multi' : 'single') : 'text';
    if (type === 'single' && options.length > 8) type = 'select';
    if (type === 'confirm' && !options.length) options.push({ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' });
    return { id: q.id || `q${i + 1}`, key: String(q.header || q.key || q.id || ''), question: String(q.question || q.title), type, options,
      min: q.min, max: q.max, step: q.step, unit: q.unit || '', labels: Array.isArray(q.labels) ? q.labels : [], placeholder: q.placeholder || '',
      optional: q.optional !== false && q.required !== true, default: q.default };
  });
  return questions.length ? { questions } : null;
}

function show(value) {
  if (value == null || value === '') return 'Skipped';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function answerText(questions, answers) {
  if (questions.length === 1) return show(answers[0]);
  return questions.map((q, i) => `- ${q.question} ${show(answers[i])}`).join('\n');
}

export function Choices({ source, onAnswer, answered, disabled }) {
  const spec = useMemo(() => parseChoices(source), [source]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(() => (spec ? spec.questions.map((q) => initial(q)) : []));
  const [done, setDone] = useState(false);
  if (!spec) return null;
  const { questions } = spec;
  if (answered || done) {
    const count = answers.filter((a) => a != null && a !== '' && !(Array.isArray(a) && !a.length)).length;
    return html`<div class="blk"><div class="bh">
      <span class="st ok"><${Icon} name="check" /></span>
      <span class="g" style="color: var(--tx-2)">${questions.length > 1 ? `Answered ${done ? count : questions.length} of ${questions.length}` : questions[0].question}
        ${done && questions.length === 1 ? html`<span class="mono" style="font-size: 12px; color: var(--tx-3)"> → “${show(answers[0])}”</span>` : ''}</span>
    </div></div>`;
  }
  const review = step >= questions.length;
  const set = (value) => setAnswers((a) => { const next = a.slice(); next[step] = value; return next; });
  const finish = (final = answers) => { setDone(true); onAnswer(answerText(questions, final)); };
  const next = (final) => {
    if (questions.length === 1) finish(final);
    else setStep(step + 1);
  };
  if (review) {
    return html`<div class="ask" role="group" aria-label="Review your answers">
      <div class="ask-top"><span class="ask-tag">Review</span><span class="ask-count">${questions.length} of ${questions.length}</span></div>
      <div class="ask-q">Check your answers before they go back.</div>
      <div class="ask-review">${questions.map((q, i) => html`<div key=${q.id}>
        <span class="k">${q.key || q.question}</span><span class="v">${show(answers[i])}</span>
        <button class="btn btn-g btn-sm" onClick=${() => setStep(i)}>Edit</button></div>`)}</div>
      <div class="ask-foot"><button class="btn btn-g" onClick=${() => setStep(questions.length - 1)}>Back</button><span style="flex: 1"></span>
        <button class="btn btn-p" disabled=${disabled} onClick=${() => finish()}>Send answers<span class="kbd" style="border-color: rgba(255,255,255,.35); color: #fff">↵</span></button></div>
    </div>`;
  }
  const q = questions[step];
  return html`<${Question} key=${q.id} q=${q} index=${step} total=${questions.length} value=${answers[step]} onChange=${set} disabled=${disabled}
    onBack=${step > 0 ? () => setStep(step - 1) : null}
    onNext=${(value) => { const final = answers.slice(); final[step] = value; setAnswers(final); next(final); }}
    onSkip=${q.optional ? () => { const final = answers.slice(); final[step] = null; setAnswers(final); next(final); } : null} />`;
}

function initial(q) {
  if (q.default != null) return q.default;
  if (q.type === 'multi') return [];
  if (q.type === 'rank') return q.options.map((o) => o.label);
  if (q.type === 'scale') return null;
  if (q.type === 'number') return q.min ?? 0;
  return null;
}

function Question({ q, index, total, value, onChange, onNext, onBack, onSkip, disabled }) {
  const ref = useRef(null);
  const [own, setOwn] = useState('');
  const [find, setFind] = useState('');
  const multi = q.type === 'multi';
  const picked = multi ? value || [] : value;
  const min = q.min ?? (multi ? 1 : undefined);
  const ready = multi ? picked.length >= (min || 0) && (q.max == null || picked.length <= q.max) && picked.length > 0
    : q.type === 'rank' || q.type === 'number' ? true : value != null && value !== '';
  const choose = (option) => {
    if (multi) {
      const has = picked.includes(option.label);
      const next = has ? picked.filter((v) => v !== option.label) : (q.max && picked.length >= q.max ? picked : [...picked, option.label]);
      onChange(next);
    } else {
      onChange(option.label);
      if (q.type === 'single' || q.type === 'confirm' || q.type === 'select') onNext(option.label);
    }
  };
  useEffect(() => {
    if (index === 0 && total === 1) return;
    ref.current?.querySelector('button, input, textarea')?.focus({ preventScroll: true });
  }, []);
  const onKey = (e) => {
    if (e.target.tagName === 'TEXTAREA' && !(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return;
    if (/^[1-9]$/.test(e.key) && e.target.tagName !== 'INPUT' && q.options[+e.key - 1] && q.type !== 'rank') { e.preventDefault(); choose(q.options[+e.key - 1]); }
    if (e.key === 'Enter' && ready && e.target.tagName !== 'BUTTON') { e.preventDefault(); onNext(value); }
  };
  const visible = q.type === 'select' ? q.options.filter((o) => o.label.toLowerCase().includes(find.toLowerCase())) : q.options;
  return html`<div class="ask" role="group" aria-labelledby=${`ask-${q.id}`} ref=${ref} onKeyDown=${onKey}>
    <div class="ask-top"><span class="ask-tag">Question</span><span class="ask-type">${LABEL[q.type]}</span>
      ${total > 1 && html`<span class="ask-count">${index + 1} of ${total}</span>`}</div>
    ${total > 1 && html`<div class="ask-progress"><span style=${`width: ${(index / total) * 100}%`}></span></div>`}
    <div class="ask-q" id=${`ask-${q.id}`}>${q.question}</div>
    ${(q.type === 'single' || q.type === 'multi') && html`<div class="ask-opts">
      ${q.options.map((o, i) => {
        const on = multi ? picked.includes(o.label) : value === o.label;
        return html`<button key=${o.value} class=${cx('ask-opt', on && 'on')} role=${multi ? 'checkbox' : 'radio'} aria-checked=${on} disabled=${disabled} onClick=${() => choose(o)}>
          ${multi ? html`<span class=${cx('cb', on && 'on')}>${on && html`<${Icon} name="check" />`}</span>` : html`<span class="ask-n">${i + 1}</span>`}
          <span class="ask-l"><span>${o.label}</span>${o.description && html`<span class="ask-d">${o.description}</span>`}</span>
          ${o.recommended && html`<span class="pill ac">Recommended</span>`}
        </button>`;
      })}
    </div>`}
    ${q.type === 'confirm' && html`<div class="ask-confirm">${q.options.map((o, i) => html`<button key=${o.value} disabled=${disabled}
      class=${cx('ask-opt', i === 0 && (o.danger ? 'danger' : 'primary'))} onClick=${() => choose(o)}>
      <span class="ask-l"><span>${o.label}</span>${o.description && html`<span class="ask-d">${o.description}</span>`}</span></button>`)}</div>`}
    ${q.type === 'select' && html`<div class="ask-select">
      <div class="ask-find"><${Icon} name="search" size=${14} /><label class="sr" for=${`f-${q.id}`}>Search the choices</label>
        <input id=${`f-${q.id}`} class="bare" value=${find} placeholder="Search" onInput=${(e) => setFind(e.target.value)} /><span class="meta">${visible.length} of ${q.options.length}</span></div>
      <div class="ask-list">${visible.slice(0, 200).map((o) => html`<button key=${o.value} class=${cx('mi', value === o.label && 'hot')} disabled=${disabled} onClick=${() => choose(o)}>
        <span style="flex: 1">${o.label}</span>${value === o.label && html`<${Icon} name="check" style="color: var(--ac-tx)" />`}</button>`)}</div>
    </div>`}
    ${q.type === 'text' && html`<textarea class="inp ask-text" rows="3" placeholder=${q.placeholder || 'Type your answer'} value=${value || ''} disabled=${disabled}
      onInput=${(e) => onChange(e.target.value)} aria-labelledby=${`ask-${q.id}`}></textarea>`}
    ${q.type === 'scale' && html`<div class="ask-scale">
      <div class="ask-scale-row">${range(q.min ?? 1, q.max ?? 5).map((n) => html`<button key=${n} class=${cx('ask-num', value === n && 'on')} disabled=${disabled} onClick=${() => onChange(n)} aria-pressed=${value === n}>${n}</button>`)}</div>
      ${q.labels.length > 0 && html`<div class="ask-scale-ends"><span>${q.labels[0]}</span><span>${q.labels[q.labels.length - 1]}</span></div>`}
    </div>`}
    ${q.type === 'number' && html`<div class="ask-number">
      <input type="range" min=${q.min ?? 0} max=${q.max ?? 100} step=${q.step ?? 1} value=${value} disabled=${disabled} onInput=${(e) => onChange(+e.target.value)} aria-labelledby=${`ask-${q.id}`} />
      <label class="sr" for=${`n-${q.id}`}>Value</label>
      <input id=${`n-${q.id}`} class="inp mono" type="number" min=${q.min} max=${q.max} step=${q.step ?? 1} value=${value} disabled=${disabled} onInput=${(e) => onChange(e.target.value === '' ? null : +e.target.value)} style="width: 110px" />
      ${q.unit && html`<span class="meta">${q.unit}</span>`}
    </div>`}
    ${q.type === 'date' && html`<div class="ask-date">
      ${[['Today', 0], ['Tomorrow', 1], ['Next Monday', ((8 - new Date().getDay()) % 7) || 7]].map(([label, days]) => {
        const d = new Date(); d.setDate(d.getDate() + days);
        const iso = d.toISOString().slice(0, 10);
        return html`<button key=${label} class=${cx('chip', value === iso && 'on')} disabled=${disabled} onClick=${() => onChange(iso)}>${label}</button>`;
      })}
      <label class="sr" for=${`d-${q.id}`}>Date</label>
      <input id=${`d-${q.id}`} class="inp" type="date" value=${value || ''} disabled=${disabled} onInput=${(e) => onChange(e.target.value)} style="width: 170px" />
    </div>`}
    ${q.type === 'rank' && html`<ol class="ask-rank">${(value || []).map((label, i) => html`<li key=${label}>
      <span class="ask-n">${i + 1}</span><span style="flex: 1">${label}</span>
      <button class="ib" aria-label=${`Move ${label} up`} disabled=${disabled || i === 0} onClick=${() => onChange(move(value, i, -1))}><${Icon} name="arrow-up" size=${14} /></button>
      <button class="ib" aria-label=${`Move ${label} down`} disabled=${disabled || i === value.length - 1} onClick=${() => onChange(move(value, i, 1))}><${Icon} name="arrow-down" size=${14} /></button>
    </li>`)}</ol>`}
    ${(q.type === 'single' || q.type === 'multi') && html`<div class="ask-own">
      <label class="sr" for=${`o-${q.id}`}>Or answer in your own words</label>
      <input id=${`o-${q.id}`} class="bare" placeholder="Or type your own answer…" value=${own} disabled=${disabled}
        onInput=${(e) => setOwn(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && own.trim()) { e.preventDefault(); e.stopPropagation(); onNext(multi ? [...picked, own.trim()] : own.trim()); } }} />
    </div>`}
    <div class="ask-foot">
      ${multi && html`<span class="meta">${picked.length} selected${q.min || q.max ? ` · pick ${q.min && q.max ? `${q.min}–${q.max}` : q.max ? `up to ${q.max}` : `at least ${q.min}`}` : ''}</span>`}
      <span style="flex: 1"></span>
      ${onBack && html`<button class="btn btn-g" onClick=${onBack}>Back</button>`}
      ${onSkip && html`<button class="btn btn-g" disabled=${disabled} onClick=${onSkip}>Skip</button>`}
      ${(q.type !== 'single' && q.type !== 'confirm' && q.type !== 'select') || total > 1 ? html`<button class="btn btn-p" disabled=${disabled || !ready} onClick=${() => onNext(value)}>${total > 1 && index < total - 1 ? 'Continue' : total > 1 ? 'Review' : 'Send'}</button>` : ''}
    </div>
  </div>`;
}

function range(a, b) { const out = []; for (let n = a; n <= b && out.length < 11; n++) out.push(n); return out; }
function move(list, i, by) { const next = list.slice(); const [item] = next.splice(i, 1); next.splice(i + by, 0, item); return next; }
