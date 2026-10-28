// Projects (Project board): a folder on the server, a default agent or model, and standing
// instructions. Chats are grouped under their project in the sidebar.
import { html, useState, store, useStore, cx, basename } from './lib.js';
import { Icon } from './icons.js';
import { Dialog, confirm } from './ui.js';
import { saveProject, deleteProject, moveToProject, targets, newChat } from './actions.js';

export function ProjectDialog({ project, moveChat, onClose }) {
  const config = useStore((s) => s.config);
  const [name, setName] = useState(project?.name || '');
  const [folder, setFolder] = useState(project?.folder || '');
  const [target, setTarget] = useState(project?.target || '');
  const [instructions, setInstructions] = useState(project?.instructions || '');
  const [busy, setBusy] = useState(false);
  const all = targets(config);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const saved = await saveProject(project?.id, { name: name.trim(), folder: folder.trim(), target, instructions });
    setBusy(false);
    if (!saved) return;
    onClose();
    if (moveChat) moveToProject(moveChat, saved.id);
    else if (!project) store.set({ draftProject: saved.id });
  };
  // The picker replaces this dialog; it comes back with what was typed, and the chosen folder when there is one.
  const draft = () => ({ type: 'project', project: { ...(project || {}), name, folder, target, instructions }, moveChat });
  const browse = () => store.set({ overlay: { type: 'files', mode: 'folder', start: folder, title: 'The project’s folder', back: draft(),
    onPick: (path) => store.set({ overlay: { ...draft(), project: { ...draft().project, folder: path } } }) } });
  return html`<${Dialog} onClose=${onClose} label=${project?.id ? 'Edit project' : 'New project'} width=${520}>
    <div class="dh"><span class="ico"><${Icon} name="layers" /></span><div><h3>${project?.id ? 'Edit project' : 'New project'}</h3>
      <p>Chats in a project start in its folder, with its agent or model and its instructions.</p></div></div>
    <div class="db">
      <div class="f"><label for="pj-name">Name</label><input id="pj-name" class="inp" value=${name} onInput=${(e) => setName(e.target.value)} data-autofocus placeholder="Website redesign" /></div>
      ${!config?.lock_folder && html`<div class="f"><label for="pj-folder">Folder on the server</label>
        <div style="display: flex; gap: 8px"><input id="pj-folder" class="inp mono" value=${folder} onInput=${(e) => setFolder(e.target.value)} placeholder="~/code/site" />
          ${config?.roots?.length > 0 && html`<button class="btn" onClick=${browse}>Browse…</button>`}</div>
        <small>Where agents work. Optional for model chats.</small></div>`}
      <div class="f"><label for="pj-target">Starts with</label>
        <select id="pj-target" class="sel" value=${target} onChange=${(e) => setTarget(e.target.value)}>
          <option value="">Whatever is chosen on the home screen</option>
          ${all.map((t) => html`<option value=${t.value}>${t.kind === 'agent' ? `Agent · ${t.name}` : `${t.model.provider_name} · ${t.name}`}</option>`)}
        </select></div>
      <div class="f"><label for="pj-ins">Instructions</label>
        <textarea id="pj-ins" class="inp" rows="4" style="height: auto; padding: 8px 12px; resize: vertical" value=${instructions} onInput=${(e) => setInstructions(e.target.value)}
          placeholder="What every chat in this project should know."></textarea><small>Sent with each model reply, and to an agent when its session starts.</small></div>
    </div>
    <div class="df">
      ${project?.id && html`<button class="btn btn-g" style="margin-right: auto; color: var(--bad)" onClick=${() => confirm({ title: `Delete ${project.name}?`, danger: true, action: 'Delete project',
        body: 'The project goes; its chats stay, outside any project.', onConfirm: () => { onClose(); deleteProject(project.id); } })}>Delete</button>`}
      <button class="btn btn-g" onClick=${onClose}>Cancel</button>
      <button class="btn btn-p" disabled=${busy || !name.trim()} onClick=${save}>${project?.id ? 'Save' : 'Create project'}</button>
    </div>
  <//>`;
}

export function MoveDialog({ chat, onClose }) {
  const projects = useStore((s) => s.projects);
  const pick = (id) => { onClose(); moveToProject(chat.id, id); };
  return html`<${Dialog} onClose=${onClose} label="Move to project" width=${400}>
    <div class="dh"><span class="ico"><${Icon} name="layers" /></span><div style="min-width: 0"><h3>Move to project</h3><p>${chat.title || 'New chat'}</p></div></div>
    <div class="db" style="gap: 2px">
      <button class=${cx('fm-row', !chat.project_id && 'on')} onClick=${() => pick('')}><${Icon} name="close" size=${15} /><span class="t">No project</span></button>
      ${projects.map((p) => html`<button key=${p.id} class=${cx('fm-row', chat.project_id === p.id && 'on')} onClick=${() => pick(p.id)}>
        <${Icon} name="layers" size=${15} /><span class="t">${p.name}</span><span class="meta">${p.folder ? basename(p.folder) : ''}</span></button>`)}
      ${!projects.length && html`<div class="side-empty" style="padding: 20px">No projects yet.</div>`}
    </div>
    <div class="df"><button class="btn btn-g" style="margin-right: auto" onClick=${() => store.set({ overlay: { type: 'project', moveChat: chat.id } })}><${Icon} name="plus" />New project</button>
      <button class="btn" onClick=${onClose}>Cancel</button></div>
  <//>`;
}

export function startInProject(project) {
  newChat(project.target || undefined, { project: project.id });
}
