import * as vscode from 'vscode';

// =========================
// Types & Public Interfaces
// =========================
interface BulletProfileEntry { name?: string; bullets: string[]; }
interface ExternalConfigFile {
  profiles?: Record<string, BulletProfileEntry | string[]>;
  active?: string;
}

export interface BulletFlowConfig {
  bulletSet: string[];
  removeExisting: boolean;
  indentSizeFallback: number;
}

// ===============
// Internal State
// ===============
let cachedProfiles: Record<string, BulletProfileEntry> | null = null;
let cachedActiveProfile: string | null = null;
let watcher: vscode.FileSystemWatcher | null = null;
let statusItem: vscode.StatusBarItem | null = null;

// ==================
// Workspace Helpers
// ==================
function getWorkspaceRoot(): vscode.Uri | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri : null;
}

async function readExternalConfig(): Promise<ExternalConfigFile | null> {
  const root = getWorkspaceRoot();
  if (!root) return null;
  const file = vscode.Uri.joinPath(root, '.bulletflow.json');
  try {
    const data = await vscode.workspace.fs.readFile(file);
    const text = Buffer.from(data).toString('utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// =====================
// Profile Normalization
// =====================
function normalizeProfiles(raw: Record<string, BulletProfileEntry | string[]>): Record<string, BulletProfileEntry> {
  const result: Record<string, BulletProfileEntry> = {};
  for (const [key, val] of Object.entries(raw || {})) {
    if (Array.isArray(val)) {
      result[key] = { name: key, bullets: val };
    } else if (val && Array.isArray((val as any).bullets)) {
      const entry = val as BulletProfileEntry;
      result[key] = { name: entry.name || key, bullets: entry.bullets };
    }
  }
  return result;
}

function mergeProfiles(intProfiles: Record<string, BulletProfileEntry>, fileProfiles?: Record<string, BulletProfileEntry | string[]>): Record<string, BulletProfileEntry> {
  const merged: Record<string, BulletProfileEntry> = { ...intProfiles };
  if (fileProfiles) {
    const norm = normalizeProfiles(fileProfiles as any);
    Object.assign(merged, norm);
  }
  return merged;
}

function getIntegratedProfiles(): Record<string, BulletProfileEntry> {
  const cfg = vscode.workspace.getConfiguration();
  const raw = cfg.get<Record<string, BulletProfileEntry | string[]>>('bulletFlow.bulletSetProfiles', {
    default: { name: 'Default', bullets: ['•', '◦', '·', '>'] },
    circle: { name: 'Circle', bullets: ['•', '◦', '·', '>'] },
    circleNoTop: { name: 'Circle (no top)', bullets: ['', '•', '◦', '·', '>'] },
    simple: { name: 'Simple', bullets: ['-', '•', '◦', '·', '>'] },
    simpleNoTop: { name: 'Simple (no top)', bullets: ['', '-', '•', '◦', '·', '>'] },
    rectangle: { name: 'Rectangle', bullets: ['■', '□', '▪', '▫'] },
    rectangleNoTop: { name: 'Rectangle (no top)', bullets: ['', '■', '□', '▪', '▫'] },
    korean: { name: 'Korean', bullets: ['*', 'ᆫ', ':'] },
    koreanNoTop: { name: 'Korean (no top)', bullets: ['', '*', 'ᆫ', ':'] }
  });
  return normalizeProfiles(raw);
}

// ==============
// UI Integration
// ==============
function updateStatusBar() {
  if (!statusItem) return;
  statusItem.text = !cachedProfiles ? 'BulletFlow: (direct)' : `BulletFlow: ${cachedActiveProfile}`;
  statusItem.show();
}

// ===================
// Resolution Helpers
// ===================
export function resolveBulletSet(): string[] {
  const cfg = vscode.workspace.getConfiguration();
  const direct = cfg.get<string[]>('bulletFlow.bulletSet');
  if (!cachedProfiles) return direct || ['•', '◦', '·', '>'];
  const active = cachedActiveProfile || cfg.get<string>('bulletFlow.activeProfile', 'default');
  const entry = cachedProfiles[active];
  return (entry?.bullets || direct || ['•', '◦', '·', '>']).slice();
}

export function getBulletFlowConfig(): BulletFlowConfig {
  const cfg = vscode.workspace.getConfiguration();
  return {
    bulletSet: resolveBulletSet(),
    removeExisting: cfg.get<boolean>('bulletFlow.removeExisting', true),
    indentSizeFallback: cfg.get<number>('bulletFlow.indentSizeFallback', 2)
  };
}

// ==================
// Loading & Watching
// ==================
export async function loadProfilesFromSources() {
  const settings = vscode.workspace.getConfiguration();
  const enableFile = settings.get<boolean>('bulletFlow.configFileEnabled', true);
  const integrated = getIntegratedProfiles();
  const fileCfg = enableFile ? await readExternalConfig() : null;
  cachedProfiles = mergeProfiles(integrated, fileCfg?.profiles as any);
  cachedActiveProfile = fileCfg?.active || settings.get<string>('bulletFlow.activeProfile', 'default');
  updateStatusBar();
}

async function ensureWatcher(context: vscode.ExtensionContext) {
  if (watcher) return;
  const root = getWorkspaceRoot();
  if (!root) return;
  const pattern = new vscode.RelativePattern(root, '.bulletflow.json');
  watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const reload = () => { loadProfilesFromSources(); };
  watcher.onDidChange(reload, null, context.subscriptions);
  watcher.onDidCreate(reload, null, context.subscriptions);
  watcher.onDidDelete(() => { cachedProfiles = null; cachedActiveProfile = null; updateStatusBar(); }, null, context.subscriptions);
  context.subscriptions.push(watcher);
}

// =============
// User Actions
// =============
export async function selectProfile() {
  if (!cachedProfiles) await loadProfilesFromSources();
  if (!cachedProfiles) {
    vscode.window.showWarningMessage('BulletFlow: 프로필이 로드되지 않았습니다. 설정 또는 .bulletflow.json 확인.');
    return;
  }
  const items = Object.entries(cachedProfiles)
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([key, entry]) => ({
      label: entry.name || key,
      description: entry.bullets.join(' '),
      picked: key === cachedActiveProfile,
      key
    }));
  const pickedItem = await vscode.window.showQuickPick(items, { placeHolder: 'Select BulletFlow profile' });
  if (!pickedItem) return;
  const picked = (pickedItem as any).key as string;
  if (!picked) return;
  cachedActiveProfile = picked;
  updateStatusBar();
  vscode.window.setStatusBarMessage(`BulletFlow: active profile -> ${picked}`, 2500);
}

export async function openOrCreateConfigFile() {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('BulletFlow: 워크스페이스 폴더가 없습니다.');
    return;
  }
  const file = vscode.Uri.joinPath(root, '.bulletflow.json');
  try {
    await vscode.workspace.fs.stat(file);
  } catch {
    const integrated = getIntegratedProfiles();
    const profiles: Record<string, BulletProfileEntry> = {};
    for (const [k, v] of Object.entries(integrated)) {
      profiles[k] = { name: v.name || k, bullets: v.bullets.slice() };
    }
    const skeleton: ExternalConfigFile = { profiles, active: 'default' };
    await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(skeleton, null, 2), 'utf8'));
  }
  const doc = await vscode.workspace.openTextDocument(file);
  vscode.window.showTextDocument(doc);
}

// ==========
// Lifecycle
// ==========
export async function initConfig(context: vscode.ExtensionContext) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusItem);
  await loadProfilesFromSources();
  await ensureWatcher(context);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('bulletFlow')) {
      loadProfilesFromSources();
    }
  }));
}
