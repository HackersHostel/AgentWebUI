// Logos for agents, model makers and providers (static/logos). Single-color ones take the text color, so they suit
// every theme; anything without a logo keeps the gradient or icon it had before.
import { html } from './lib.js';
import { Icon } from './icons.js';

const FILES = {
  'claude-code': 'claude-code.svg', claude: 'claude.png', codex: 'codex.svg', hermes: 'hermes.svg', opencode: 'opencode.svg',
  'gemini-cli': 'gemini-cli.svg', gemini: 'gemini.png', openai: 'openai.svg', mistral: 'mistral.png', kimi: 'kimi.png',
  moonshot: 'moonshot.svg', minimax: 'minimax.svg', qwen: 'qwen.svg', deepseek: 'deepseek.svg', xai: 'xai.svg',
  meta: 'meta.svg', zai: 'zai.svg', ollama: 'ollama.svg', openrouter: 'openrouter.svg', grok: 'grok.svg', nvidia: 'nvidia.svg',
  google: 'google.svg', azure: 'azure.svg', aws: 'aws.svg',
};
const MONO = new Set(['hermes', 'opencode', 'openai', 'moonshot', 'xai', 'zai', 'ollama', 'grok', 'aws']);
// A colored part drawn over a single-color logo (the AWS smile).
const ACCENTS = { aws: 'aws-smile.svg' };

// Matched against an agent's id, name and command.
const AGENTS = [[/claude/, 'claude-code'], [/codex/, 'codex'], [/hermes/, 'hermes'], [/opencode/, 'opencode'],
  [/gemini/, 'gemini-cli'], [/qwen/, 'qwen'], [/kimi/, 'kimi']];
// Matched against a model's name: who made it, whoever serves it.
const MAKERS = [[/claude|anthropic|opus|sonnet|haiku|fable/, 'claude'], [/gpt|openai|chatgpt|codex|\bo[1-4]\b/, 'openai'],
  [/gemini|gemma/, 'gemini'], [/mistral|mixtral|codestral|devstral|magistral|ministral|pixtral/, 'mistral'], [/kimi/, 'kimi'],
  [/moonshot/, 'moonshot'], [/minimax/, 'minimax'], [/qwen|qwq/, 'qwen'], [/deepseek/, 'deepseek'], [/grok/, 'grok'], [/x-ai|\bxai\b/, 'xai'],
  [/llama|\bmeta\b/, 'meta'], [/glm|z-ai|\bzai\b|zhipu/, 'zai'], [/nemotron|nvidia/, 'nvidia'], [/amazon|\btitan\b/, 'aws']];
// Matched against a provider's id and address.
const PROVIDERS = [[/azure/, 'azure'], [/amazonaws|bedrock|^aws\b/, 'aws'], [/nvidia/, 'nvidia'],
  [/openrouter/, 'openrouter'], [/ollama|:11434/, 'ollama'], [/api\.openai\.com|^openai\b/, 'openai'],
  [/anthropic/, 'claude'], [/moonshot/, 'moonshot'], [/deepseek/, 'deepseek'], [/mistral/, 'mistral'], [/x\.ai\b|^xai\b/, 'xai'],
  [/z\.ai\b|bigmodel|^zai\b/, 'zai'], [/minimax/, 'minimax'], [/generativelanguage|aiplatform|vertex|^google|^gemini/, 'google'], [/dashscope|^qwen/, 'qwen']];

const find = (rules, text) => rules.find(([re]) => re.test(String(text || '').toLowerCase()))?.[1] || null;

export const agentLogo = (agent) => agent && find(AGENTS, `${agent.id} ${agent.name} ${agent.command || ''}`);
export const modelLogo = (name) => find(MAKERS, name);
export const providerLogo = (provider) => provider && find(PROVIDERS, `${provider.id} ${provider.url || provider.host || ''}`);

// The logo for "agent:<id>" or "model:<provider>/<model>".
export function targetLogo(value, config) {
  if (!value || !config) return null;
  const rest = value.slice(value.indexOf(':') + 1);
  if (value.startsWith('agent:')) return agentLogo(config.agents.find((a) => a.id === rest));
  const model = config.models.find((m) => m.id === rest);
  const providerId = model ? model.provider : rest.split('/')[0];
  return modelLogo(model ? model.model : rest.slice(rest.indexOf('/') + 1)) || providerLogo(config.providers.find((p) => p.id === providerId));
}

const src = (file) => new URL(`../logos/${file}`, import.meta.url).href;

function Glyph({ name, size }) {
  if (MONO.has(name)) {
    const url = src(FILES[name]);
    const mono = html`<span class="logo-glyph" aria-hidden="true" style=${`width: ${size}px; height: ${size}px; background: currentColor; -webkit-mask: url(${url}) center / contain no-repeat; mask: url(${url}) center / contain no-repeat`}></span>`;
    if (!ACCENTS[name]) return mono;
    return html`<span class="logo-glyph" style=${`position: relative; width: ${size}px; height: ${size}px`}>${mono}
      <img src=${src(ACCENTS[name])} alt="" width=${size} height=${size} style="position: absolute; inset: 0" /></span>`;
  }
  return html`<img class="logo-glyph" src=${src(FILES[name])} alt="" width=${size} height=${size} />`;
}

// A logo on its own (size = the glyph), or in a rounded tile (size = the tile). Without a logo: the fallback
// gradient tile with an optional icon, or just the icon.
export function Logo({ name, size = 16, tile = false, fallback, icon, iconSize, radius }) {
  const round = `border-radius: ${radius ?? Math.round(size * 0.28)}px`;
  if (name && FILES[name]) {
    if (!tile) return html`<${Glyph} name=${name} size=${size} />`;
    return html`<span class="logo-tile" style=${`width: ${size}px; height: ${size}px; ${round}`}><${Glyph} name=${name} size=${Math.round(size * 0.62)} /></span>`;
  }
  if (fallback) {
    return html`<span class="logo-tile plain" style=${`width: ${size}px; height: ${size}px; ${round}; background: ${fallback}`}>
      ${icon && html`<${Icon} name=${icon} size=${iconSize || Math.round(size * 0.58)} />`}</span>`;
  }
  return icon ? html`<${Icon} name=${icon} size=${iconSize || size} />` : null;
}
