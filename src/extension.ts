/*
 * BulletFlow Extension (simplified)
 * - existingBulletPattern 제거: 활성 bulletSet 토큰만으로 기존 bullet 감지/제거
 * - 손상된 이전 중복 구현을 완전 정리 후 재작성
 */

import * as vscode from 'vscode';
import { getBulletFlowConfig, BulletFlowConfig, selectProfile, openOrCreateConfigFile, initConfig } from './configManager';

function detectIndentSize(lines: string[], fallback: number): number {
  const counts: number[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = l.match(/^( +)/); // 선행 공백 블록
    if (m) counts.push(m[1].length);
  }
  if (!counts.length) return fallback;
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  let g = counts[0];
  for (let i = 1; i < counts.length; i++) g = gcd(g, counts[i]);
  if (g <= 1) return fallback; // 의미 없는 1 혹은 0 은 fallback
  return g;
}

function computeLevel(line: string, indentUnit: number): { level: number; rawIndent: string } {
  const m = line.match(/^[ \t]*/);
  const rawIndent = m ? m[0] : '';
  let level = 0;
  let spacesRun = 0;
  for (const ch of rawIndent) {
    if (ch === '\t') level++;
    else if (ch === ' ') {
      spacesRun++;
      if (spacesRun >= indentUnit) { level++; spacesRun = 0; }
    }
  }
  if (spacesRun > 0) level++; // 남은 잔여 공백
  return { level, rawIndent };
}

function stripExistingBullet(afterIndent: string, bullets: string[]): { stripped: string; removed: string | null } {
  const candidates = bullets.slice().sort((a, b) => b.length - a.length).filter(b => b);
  const work = afterIndent; // 원문 유지
  for (const token of candidates) {
    const variants = new Set<string>([token, token.endsWith(' ') ? token.slice(0, -1) : token + ' ']);
    for (const v of variants) {
      if (work.startsWith(v)) {
        return { stripped: work.slice(v.length), removed: token };
      }
    }
  }
  return { stripped: work, removed: null };
}

function applyBulletToLine(original: string, level: number, indent: string, cfg: BulletFlowConfig): string {
  if (!original.trim()) return original; // 빈 줄 유지
  const bullet = cfg.bulletSet[Math.min(level, cfg.bulletSet.length - 1)] || '';
  let bulletTxt = bullet;
  if (bulletTxt && !/[ \t]$/.test(bulletTxt)) bulletTxt += ' ';
  const content = original.slice(indent.length).trimStart();
  return indent + bulletTxt + content;
}

function removeBulletsOnLines(editor: vscode.TextEditor, lineIndexes: number[], bullets: string[]) {
  const doc = editor.document;
  const edits: { range: vscode.Range; newText: string }[] = [];
  const tokens = bullets.slice().sort((a, b) => b.length - a.length).filter(t => t);
  for (const i of lineIndexes) {
    const line = doc.lineAt(i);
    const text = line.text;
    if (!text.trim()) continue;
    const m = text.match(/^([ \t]*)/);
    const indent = m ? m[1] : '';
    const body = text.slice(indent.length);
    let changed = false;
    for (const token of tokens) {
      const variants = new Set<string>([token, token.endsWith(' ') ? token.slice(0, -1) : token + ' ']);
      for (const v of variants) {
        if (body.startsWith(v)) {
          const replacement = indent + body.slice(v.length).trimStart();
          if (replacement !== text) edits.push({ range: line.range, newText: replacement });
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  if (!edits.length) {
    vscode.window.setStatusBarMessage('BulletFlow: 제거할 bullet 없음', 2000);
    return;
  }
  editor.edit(eb => edits.forEach(e => eb.replace(e.range, e.newText))).then(ok => {
    if (ok) vscode.window.setStatusBarMessage(`BulletFlow: bullet 제거 ${edits.length} line(s)`, 3000);
  });
}

function removeBulletsDocument(editor: vscode.TextEditor) {
  const cfg = getBulletFlowConfig();
  const lines = Array.from({ length: editor.document.lineCount }, (_, i) => i);
  removeBulletsOnLines(editor, lines, cfg.bulletSet);
}

function removeBulletsSelection(editor: vscode.TextEditor) {
  const cfg = getBulletFlowConfig();
  if (!editor.selections.length) { removeBulletsDocument(editor); return; }
  const set = new Set<number>();
  for (const sel of editor.selections) {
    const start = sel.start.line;
    const end = sel.end.line + (sel.end.character === 0 && sel.end.line > sel.start.line ? -1 : 0);
    for (let l = start; l <= end; l++) set.add(l);
  }
  const indexes = Array.from(set).sort((a, b) => a - b);
  removeBulletsOnLines(editor, indexes, cfg.bulletSet);
}

function applyBulletsToDocument(editor: vscode.TextEditor, cfg: BulletFlowConfig) {
  const doc = editor.document;
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  const indentSize = detectIndentSize(lines, cfg.indentSizeFallback);
  const edits: { range: vscode.Range; newText: string }[] = [];
  lines.forEach((text, idx) => {
    if (!text.trim()) return; // blank
    let working = text;
    const { level, rawIndent } = computeLevel(working, indentSize);
    if (cfg.removeExisting) {
      const afterIndent = working.slice(rawIndent.length);
      const { stripped } = stripExistingBullet(afterIndent, cfg.bulletSet);
      working = rawIndent + stripped.trimStart();
    }
    const newLine = applyBulletToLine(working, level, rawIndent, cfg);
    if (newLine !== text) edits.push({ range: doc.lineAt(idx).range, newText: newLine });
  });
  if (!edits.length) { vscode.window.setStatusBarMessage('BulletFlow: 변경 없음', 2000); return; }
  editor.edit(eb => edits.forEach(e => eb.replace(e.range, e.newText))).then(ok => {
    if (ok) vscode.window.setStatusBarMessage(`BulletFlow: ${edits.length} line(s) updated`, 3000);
  });
}

function collectSelectedLineIndexes(editor: vscode.TextEditor): number[] {
  const set = new Set<number>();
  for (const sel of editor.selections) {
    const start = sel.start.line;
    const end = sel.end.line + (sel.end.character === 0 && sel.end.line > sel.start.line ? -1 : 0);
    for (let l = start; l <= end; l++) set.add(l);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function applyBulletsToSelection(editor: vscode.TextEditor, cfg: BulletFlowConfig) {
  if (!editor.selections.length) { applyBulletsToDocument(editor, cfg); return; }
  const doc = editor.document;
  const indexes = collectSelectedLineIndexes(editor);
  const lines = indexes.map(i => doc.lineAt(i).text);
  const indentSize = detectIndentSize(lines, cfg.indentSizeFallback);
  const edits: { range: vscode.Range; newText: string }[] = [];
  indexes.forEach(idx => {
    const text = doc.lineAt(idx).text;
    if (!text.trim()) return;
    let working = text;
    const { level, rawIndent } = computeLevel(working, indentSize);
    if (cfg.removeExisting) {
      const afterIndent = working.slice(rawIndent.length);
      const { stripped } = stripExistingBullet(afterIndent, cfg.bulletSet);
      working = rawIndent + stripped.trimStart();
    }
    const newLine = applyBulletToLine(working, level, rawIndent, cfg);
    if (newLine !== text) edits.push({ range: doc.lineAt(idx).range, newText: newLine });
  });
  if (!edits.length) { vscode.window.setStatusBarMessage('BulletFlow: 선택 변경 없음', 2000); return; }
  editor.edit(eb => edits.forEach(e => eb.replace(e.range, e.newText))).then(ok => {
    if (ok) vscode.window.setStatusBarMessage(`BulletFlow: 선택 ${edits.length} line(s)`, 3000);
  });
}

function applyBulletsToSelectionRelative(editor: vscode.TextEditor, cfg: BulletFlowConfig) {
  if (!editor.selections.length) { applyBulletsToDocument(editor, cfg); return; }
  const doc = editor.document;
  const indexes = collectSelectedLineIndexes(editor);
  const lines = indexes.map(i => doc.lineAt(i).text);
  const indentSize = detectIndentSize(lines, cfg.indentSizeFallback);
  const meta: { idx: number; level: number; rawIndent: string; text: string; working: string }[] = [];
  for (const idx of indexes) {
    const text = doc.lineAt(idx).text;
    if (!text.trim()) continue;
    let working = text;
    const { level, rawIndent } = computeLevel(working, indentSize);
    if (cfg.removeExisting) {
      const afterIndent = working.slice(rawIndent.length);
      const { stripped } = stripExistingBullet(afterIndent, cfg.bulletSet);
      working = rawIndent + stripped.trimStart();
    }
    meta.push({ idx, level, rawIndent, text, working });
  }
  if (!meta.length) { vscode.window.setStatusBarMessage('BulletFlow: 선택(상대) 대상 없음', 2000); return; }
  const minLevel = Math.min(...meta.map(m => m.level));
  const edits: { range: vscode.Range; newText: string }[] = [];
  for (const m of meta) {
    const rel = Math.max(0, m.level - minLevel);
    const newLine = applyBulletToLine(m.working, rel, m.rawIndent, cfg);
    if (newLine !== m.text) edits.push({ range: doc.lineAt(m.idx).range, newText: newLine });
  }
  if (!edits.length) { vscode.window.setStatusBarMessage('BulletFlow: 선택(상대) 변경 없음', 2000); return; }
  editor.edit(eb => edits.forEach(e => eb.replace(e.range, e.newText))).then(ok => {
    if (ok) vscode.window.setStatusBarMessage(`BulletFlow: 선택(상대) ${edits.length} line(s)`, 3000);
  });
}

export function activate(context: vscode.ExtensionContext) {
  initConfig(context);
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('bulletFlow.applyBullets', editor => {
  const cfg = getBulletFlowConfig();
      applyBulletsToDocument(editor, cfg);
    }),
    vscode.commands.registerTextEditorCommand('bulletFlow.applyBulletsSelection', editor => {
  const cfg = getBulletFlowConfig();
      applyBulletsToSelection(editor, cfg);
    }),
    vscode.commands.registerTextEditorCommand('bulletFlow.applyBulletsSelectionRelative', editor => {
  const cfg = getBulletFlowConfig();
      applyBulletsToSelectionRelative(editor, cfg);
    }),
    vscode.commands.registerTextEditorCommand('bulletFlow.removeBullets', editor => {
      removeBulletsDocument(editor);
    }),
    vscode.commands.registerTextEditorCommand('bulletFlow.removeBulletsSelection', editor => {
      removeBulletsSelection(editor);
    }),
    vscode.commands.registerCommand('bulletFlow.selectBulletSet', async () => { await selectProfile(); }),
    vscode.commands.registerCommand('bulletFlow.openConfigFile', async () => { await openOrCreateConfigFile(); }),
  );
}

export function deactivate() { /* no-op */ }
