// App states (System states board): not found, page error, offline banner, loading, and sign in.
import { html, useState, store, useStore, api, copyText } from './lib.js';

const brandName = () => document.title || 'AgentWebUI';
import { Icon } from './icons.js';
import { newChat, openPalette } from './actions.js';

export function SystemState({ kind, detail }) {
  if (kind === 'missing') {
    return html`<div class="state-center">
      <span class="mono" style="font-size: 13px; color: var(--tx-3)">404</span>
      <div class="big">This chat doesn’t exist</div>
      <div class="sub">It may have been deleted, or the link is mistyped.</div>
      <div style="display: flex; gap: 8px"><button class="btn btn-p" onClick=${() => newChat()}>New chat</button><button class="btn" onClick=${openPalette}>Search chats</button></div>
    </div>`;
  }
  return html`<div class="state-center">
    <span class="ico" style="width: 44px; height: 44px; border-radius: 12px; background: var(--bad-soft); color: var(--bad)"><${Icon} name="error" size=${20} /></span>
    <div class="big">This page hit an error</div>
    <div class="sub">Your chats are safe. Reload to try again.</div>
    <div style="display: flex; gap: 8px"><button class="btn btn-p" onClick=${() => location.reload()}>Reload</button>
      ${detail && html`<button class="btn" onClick=${() => copyText(String(detail))}>Copy error details</button>`}</div>
  </div>`;
}

export function OfflineBanner() {
  const offline = useStore((s) => s.offline);
  if (!offline) return null;
  return html`<div role="status" class="banner warn"><${Icon} name="offline" /><span>You’re offline or the server stopped. Sending waits until it answers again.</span></div>`;
}

export function Loading() {
  return html`<div class="boot" aria-busy="true"><div class="skeleton" style="max-width: 760px; width: 100%">
    <span style="align-self: flex-end; height: 36px; width: 46%; border-radius: 16px"></span>
    <span></span><span></span><span style="width: 60%"></span><span style="height: 80px; border-radius: 10px"></span>
  </div></div>`;
}

export function SignIn() {
  const emailRequired = useStore((s) => s.emailRequired);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/login', { method: 'POST', body: emailRequired ? { email, password } : { password } });
      store.set({ signedIn: true });
      window.dispatchEvent(new Event('awl:signed-in'));
    } catch (err) {
      setError(err.status !== 401 ? err.message
        : emailRequired ? 'That email or password isn’t right. Use the ones your dashboard shows for this server.'
          : 'That password isn’t right. It is the PASSWORD set in the server’s .env file.');
    } finally { setBusy(false); }
  };
  return html`<div class="signin">
    <main class="signin-main">
      <div class="signin-brand"><img src="/brand/logo" alt="" width="26" height="26" style="border-radius: 8px" /><span>${brandName()}</span></div>
      <div class="signin-center">
        <div class="signin-form">
          <div><h1>Welcome back</h1><p>Sign in to your ${brandName()} server.</p></div>
          <form onSubmit=${submit} style="display: flex; flex-direction: column; gap: 14px">
            ${emailRequired && html`<div class="f"><label for="em">Email</label>
              <input id="em" class=${error ? 'inp err' : 'inp'} type="email" autocomplete="username" value=${email}
                onInput=${(e) => setEmail(e.target.value)} autofocus aria-invalid=${!!error} /></div>`}
            <div class="f"><label for="pw">Password</label>
              <input id="pw" class=${error ? 'inp err' : 'inp'} type="password" autocomplete="current-password" value=${password}
                onInput=${(e) => setPassword(e.target.value)} autofocus=${!emailRequired} aria-invalid=${!!error} aria-describedby=${error ? 'pw-err' : undefined} />
              ${error && html`<small id="pw-err" role="alert" style="color: var(--bad)">${error}</small>`}</div>
            <button class="btn btn-p btn-lg" type="submit" disabled=${busy || !password || (emailRequired && !email)} style="margin-top: 4px">${busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p style="margin: 0; text-align: center; font-size: 13px; color: var(--tx-3)">${emailRequired
            ? 'Forgot them? Your dashboard shows the email and password for this server.'
            : 'Forgot it? Whoever runs this server can change PASSWORD in .env.'}</p>
        </div>
      </div>
      <div class="signin-foot"><span>${location.host}</span><span style="margin-left: auto">Self-hosted · your chats stay on this server</span></div>
    </main>
    <aside class="brandside" aria-hidden="true">
      <div class="preview">
        <div class="pv-side"><div style="display: flex; align-items: center; gap: 6px"><img src="/brand/logo" alt="" width="14" height="14" style="border-radius: 4px" /><span class="ln" style="width: 60px"></span></div>
          <span class="ln" style="width: 80%; margin-top: 14px"></span><span style="height: 22px; border-radius: 6px; background: var(--bg-active)"></span>
          <span class="ln faint" style="width: 70%"></span><span class="ln faint" style="width: 85%"></span><span class="ln faint" style="width: 60%"></span></div>
        <div class="pv-main"><span style="align-self: flex-end; height: 30px; width: 46%; border-radius: 14px; background: var(--bg-active)"></span>
          <span class="ln" style="width: 82%; height: 8px"></span><span class="ln" style="width: 74%; height: 8px"></span><span class="ln" style="width: 60%; height: 8px"></span>
          <span style="height: 96px; width: 88%; border-radius: 10px; background: var(--bg-side); border: 1px solid var(--line)"></span>
          <span class="pv-comp"><span></span></span></div>
      </div>
      <div style="position: relative; max-width: 440px">
        <div style="font-size: 26px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.2">Every model you use, in one place you own.</div>
        <div class="brand-points">
          <span><${Icon} name="model" />Cloud and local models side by side</span>
          <span><${Icon} name="agent" />Claude Code, Codex, Hermes and other agents in the same chat</span>
          <span><${Icon} name="locked" />Runs on your machine, set up in one .env file</span>
        </div>
      </div>
    </aside>
  </div>`;
}
