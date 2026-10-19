// Voice (Voice mode board, Settings › Voice, ChatMore dictation and read aloud): the browser's own speech
// recognition and speech synthesis. Nothing is sent to the server but the words; audio never leaves the browser.
import { html, useState, useEffect, useRef, store, useStore, cx, toast } from './lib.js';
import { Icon } from './icons.js';
import { answer, stop as stopReply } from './actions.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = !!Recognition;
export const canSpeak = 'speechSynthesis' in window;

const prefs = () => store.get().chatPrefs || {};
const language = () => prefs().voiceLang || navigator.language || 'en-US';

// Dictation into the message box: words appear as they are spoken; grey ones may still change.
export function useDictation(onText) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef(null);
  const start = () => {
    if (!Recognition) return;
    const r = new Recognition();
    r.lang = language();
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let done = '', pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) done += e.results[i][0].transcript;
        else pending += e.results[i][0].transcript;
      }
      if (done) onText(done.trim());
      setInterim(pending);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('The microphone is blocked. Allow it in the browser’s address bar, then try again.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(`Dictation stopped: ${e.error}.`);
    };
    r.onend = () => { setListening(false); setInterim(''); rec.current = null; };
    try { r.start(); rec.current = r; setListening(true); } catch { /* already started */ }
  };
  const stop = () => rec.current?.stop();
  useEffect(() => () => rec.current?.abort(), []);
  return { listening, interim, start, stop, toggle: () => (listening ? stop() : start()) };
}

// Markdown read as plain sentences: code is skipped, links read as their words.
export function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function voices() {
  return canSpeak ? speechSynthesis.getVoices() : [];
}

let speaking = null;
export function speak(text, { onEnd, onWord } = {}) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  const chosen = voices().find((v) => v.name === prefs().voiceName);
  if (chosen) u.voice = chosen;
  u.lang = chosen?.lang || language();
  u.rate = prefs().rate || 1;
  u.onend = () => { if (speaking === u) speaking = null; onEnd?.(); };
  u.onerror = () => { if (speaking === u) speaking = null; onEnd?.(); };
  u.onboundary = (e) => onWord?.(e.charIndex);
  speaking = u;
  speechSynthesis.speak(u);
}
export function stopSpeaking() { if (canSpeak) speechSynthesis.cancel(); speaking = null; }
export const isSpeaking = () => !!speaking;

// Read aloud for one reply, with a progress line (ChatMore board, "Read aloud").
export function ReadAloud({ text, onClose }) {
  const [at, setAt] = useState(0);
  const plain = speakable(text);
  useEffect(() => { speak(text, { onEnd: onClose, onWord: setAt }); return () => stopSpeaking(); }, []);
  const pct = plain.length ? Math.min(100, (at / plain.length) * 100) : 0;
  return html`<div class="read-aloud" role="status">
    <button class="ib" aria-label="Stop reading" onClick=${() => { stopSpeaking(); onClose(); }}><span class="stop-sq"></span></button>
    <div class="ra-track"><span style=${`width: ${pct}%`}></span></div>
    <span class="meta">Reading aloud</span>
  </div>`;
}

// Hands-free voice mode: listen → send → read the reply → listen. Works with any model or agent; a model that
// isn't realtime simply answers with a short delay.
export function VoiceMode({ onSend, target, onClose }) {
  const chat = useStore((s) => s.chat);
  const live = useStore((s) => (s.chat ? s.live[s.chat.id] : null));
  const [phase, setPhase] = useState('listening'); // listening | thinking | speaking | muted | blocked
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const [captions, setCaptions] = useState(true);
  const rec = useRef(null);
  const lastSpoken = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const listen = () => {
    if (!Recognition) { setPhase('unsupported'); return; }
    rec.current?.abort();
    const r = new Recognition();
    r.lang = language();
    r.interimResults = true;
    r.continuous = false;
    let final = '';
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) final = text;
      }
      setHeard(text);
    };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setPhase('blocked'); };
    r.onend = () => {
      rec.current = null;
      const text = final.trim();
      if (phaseRef.current !== 'listening') return;
      if (!text) { setTimeout(() => phaseRef.current === 'listening' && listen(), 250); return; }
      if (waitingPart() && /\b(allow|yes|approve|okay|ok)\b/i.test(text)) { approve(true); return; }
      if (waitingPart() && /\b(deny|no|reject|stop)\b/i.test(text)) { approve(false); return; }
      setPhase('thinking');
      setSaid('');
      onSend(text);
    };
    try { r.start(); rec.current = r; setHeard(''); } catch { /* already listening */ }
  };
  const waitingPart = () => {
    const l = store.get().chat ? store.get().live[store.get().chat.id] : null;
    return l?.parts?.find((p) => p.type === 'permission' && p.state === 'waiting');
  };
  const approve = (yes) => {
    const part = waitingPart();
    const c = store.get().chat;
    if (!part || !c) return;
    const option = part.options.find((o) => (yes ? o.kind === 'allow_once' : o.kind.startsWith('reject'))) || part.options[yes ? 0 : part.options.length - 1];
    answer(c.id, part.id, option.id);
    setPhase('thinking');
  };

  useEffect(() => {
    listen();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); rec.current?.abort(); stopSpeaking(); };
  }, []);
  const end = () => { phaseRef.current = 'ended'; rec.current?.abort(); stopSpeaking(); onClose(); };
  // When a reply finishes, read it, then listen again.
  useEffect(() => {
    const reply = live?.lastReply;
    if (!reply || live.running || lastSpoken.current === reply.id) return;
    lastSpoken.current = reply.id;
    setSaid(reply.content || '');
    if (!reply.content) { setPhase('listening'); listen(); return; }
    setPhase('speaking');
    speak(reply.content, { onEnd: () => { if (phaseRef.current === 'speaking') { setPhase('listening'); listen(); } } });
  }, [live?.lastReply?.id, live?.running]);
  useEffect(() => { if (live?.waiting && phase === 'thinking') { setPhase('listening'); listen(); } }, [live?.waiting]);

  const interrupt = () => {
    stopSpeaking();
    if (live?.running && chat) stopReply(chat.id);
    setPhase('listening');
    listen();
  };
  const mute = () => {
    if (phase === 'muted') { setPhase('listening'); listen(); }
    else { rec.current?.abort(); stopSpeaking(); setPhase('muted'); }
  };
  const tool = live?.running && [...(live.parts || [])].reverse().find((p) => p.type === 'tool' && (p.status === 'in_progress' || p.status === 'pending'));
  const waiting = live?.parts?.find((p) => p.type === 'permission' && p.state === 'waiting');
  const label = waiting ? 'Needs approval' : phase === 'listening' ? 'Listening' : phase === 'thinking' ? (tool ? 'Using a tool' : 'Thinking') : phase === 'speaking' ? 'Speaking' : phase === 'muted' ? 'Microphone off' : phase === 'blocked' ? 'Microphone blocked' : 'Voice isn’t available';
  const hint = waiting ? `${waiting.title}. Say “allow” or “deny”, or tap.`
    : phase === 'listening' ? 'Talk normally. Pause when you’re done.'
    : phase === 'thinking' ? (tool ? `${tool.title}…` : 'Speaking interrupts it.')
    : phase === 'speaking' ? 'Tap the pause button or start talking to interrupt.'
    : phase === 'muted' ? 'Tap the microphone to talk again.'
    : phase === 'blocked' ? 'Allow it in the browser’s address bar, then try again.'
    : 'This browser can’t recognise speech. Chrome, Edge and Safari can.';
  return html`<div class="voice" role="dialog" aria-modal="true" aria-label="Voice mode">
    <div class="voice-top">
      <span class="pill">${target || 'Voice'}</span>
      <span style="flex: 1"></span>
      <span class="voice-note hide-sm">Audio isn’t stored · the transcript saves to this chat</span>
    </div>
    <div class="voice-center">
      <div class=${cx('orb', phase === 'thinking' && 'dim', phase === 'speaking' && 'talk', (phase === 'muted' || phase === 'blocked') && 'off')} aria-hidden="true"></div>
      <div class="voice-state" aria-live="polite"><span>${label}</span><span class="sub">${hint}</span></div>
      ${waiting && html`<div style="display: flex; gap: 8px"><button class="btn btn-p" onClick=${() => approve(true)}>Allow once</button><button class="btn" onClick=${() => approve(false)}>Deny</button></div>`}
      ${phase === 'blocked' && html`<button class="btn" onClick=${() => { setPhase('listening'); listen(); }}>Try again</button>`}
    </div>
    ${captions && html`<div class="voice-captions">
      ${said && html`<div class="said"><b>Reply</b> — ${speakable(said).slice(0, 280)}${speakable(said).length > 280 ? '…' : ''}</div>`}
      ${heard && html`<div class="heard"><b>You</b> — ${heard}</div>`}
    </div>`}
    <div class="voice-controls">
      <button class=${cx('vb', phase === 'muted' && 'on')} aria-label=${phase === 'muted' ? 'Turn the microphone on' : 'Mute microphone'} onClick=${mute}><${Icon} name="mic" /></button>
      <button class=${cx('vb', captions && 'inv')} aria-label=${captions ? 'Hide captions' : 'Show captions'} aria-pressed=${captions} onClick=${() => setCaptions(!captions)}><${Icon} name="file-text" /></button>
      <button class="vb" aria-label="Interrupt" onClick=${interrupt}><${Icon} name="pause" /></button>
      <button class="vb end" aria-label="End voice mode" onClick=${end}><${Icon} name="close" size=${20} /></button>
    </div>
  </div>`;
}
