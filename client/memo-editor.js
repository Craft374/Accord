import { EditorView, basicSetup } from "codemirror";
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, keymap, placeholder } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

// basicSetup 의 defaultHighlightStyle 은 밝은 배경 전제(헤딩 밑줄, 마크문자 어두운 회색)라 다크 테마에서
// 안 보이거나(#404740 회색) 밑줄이 남는다(제목). 마크다운에 실제로 쓰이는 태그만 다시 정의해 완전히 대체한다.
const memoHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.processingInstruction, color: "var(--memo-color-marker, var(--warning))" },
]);

// "*" 를 괄호처럼 취급해 선택한 글자를 양쪽에서 감싸게 한다(closeBrackets 는 이미 basicSetup 에 포함됨,
// 여기선 대상 문자만 languageData 로 추가). 별 3개는 감싸기를 세 번 반복 적용해 자연히 얻어진다.
const memoCloseBrackets = EditorState.languageData.of(() => [
  { closeBrackets: { brackets: ["(", "[", "{", "'", '"', "*"] } },
]);

const setLiveMode = StateEffect.define();
const toggleFold = StateEffect.define();
const setRemoteCursors = StateEffect.define();
const externalChange = Annotation.define();

const liveModeField = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setLiveMode)) value = effect.value;
    return value;
  },
});

function foldState(folds) {
  return {
    folds,
    decorations: Decoration.set(folds.map((fold) => Decoration.replace({}).range(fold.from, fold.to)), true),
  };
}

const foldField = StateField.define({
  create: () => foldState([]),
  update(value, transaction) {
    let next = value.folds.map((fold) => ({
      key: transaction.changes.mapPos(fold.key, 1),
      from: transaction.changes.mapPos(fold.from, 1),
      to: transaction.changes.mapPos(fold.to, -1),
    })).filter((fold) => fold.from < fold.to);
    for (const effect of transaction.effects) {
      if (!effect.is(toggleFold)) continue;
      const found = next.findIndex((fold) => fold.key === effect.value.key);
      if (found >= 0) next.splice(found, 1);
      else next.push(effect.value);
    }
    return foldState(next);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const foldAtomicRanges = EditorView.atomicRanges.of((view) => view.state.field(foldField).decorations);

class RemoteCursorWidget extends WidgetType {
  constructor(cursor) {
    super();
    this.cursor = cursor;
  }
  eq(other) {
    return other.cursor.name === this.cursor.name && other.cursor.color === this.cursor.color;
  }
  toDOM() {
    const cursor = document.createElement("span");
    cursor.className = "cm-memo-remote-cursor";
    cursor.style.setProperty("--memo-cursor-color", this.cursor.color);
    const label = document.createElement("span");
    label.className = "cm-memo-remote-label";
    label.textContent = this.cursor.name;
    cursor.append(label);
    return cursor;
  }
  ignoreEvent() { return true; }
}

function remoteDecorations(state, cursors) {
  const ranges = [];
  for (const raw of cursors || []) {
    const pos = Math.max(0, Math.min(Number(raw.pos) || 0, state.doc.length));
    const sel = Math.max(0, Math.min(Number(raw.sel ?? raw.pos) || 0, state.doc.length));
    const color = /^#[0-9a-f]{3,8}$/i.test(raw.color || "") ? raw.color : "#f0b232";
    const cursor = { name: String(raw.name || "익명"), color };
    if (pos !== sel) {
      ranges.push(Decoration.mark({
        class: "cm-memo-remote-selection",
        attributes: { style: `--memo-cursor-color:${color}` },
      }).range(Math.min(pos, sel), Math.max(pos, sel)));
    }
    ranges.push(Decoration.widget({ widget: new RemoteCursorWidget(cursor), side: -1 }).range(pos));
  }
  return Decoration.set(ranges, true);
}

const remoteCursorField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setRemoteCursors)) value = remoteDecorations(transaction.state, effect.value);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class CheckboxWidget extends WidgetType {
  constructor(from, checked) {
    super();
    this.from = from;
    this.checked = checked;
  }
  eq(other) { return other.from === this.from && other.checked === this.checked; }
  toDOM(view) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-live-check";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "완료 취소" : "완료 표시");
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("click", (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      view.dispatch({ changes: { from: this.from, to: this.from + 3, insert: this.checked ? "[ ]" : "[x]" } });
      view.focus();
    });
    return input;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }
  eq(other) { return other.label === this.label; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = /^\d/.test(this.label) ? this.label : "•";
    return span;
  }
  ignoreEvent() { return true; }
}

class FoldWidget extends WidgetType {
  constructor(fold, collapsed) {
    super();
    this.fold = fold;
    this.collapsed = collapsed;
  }
  eq(other) { return other.fold.key === this.fold.key && other.collapsed === this.collapsed; }
  toDOM(view) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-live-fold${this.collapsed ? " collapsed" : ""}`;
    button.setAttribute("aria-label", this.collapsed ? "목록 펼치기" : "목록 접기");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ effects: toggleFold.of(this.fold), annotations: Transaction.addToHistory.of(false) });
      view.focus();
    });
    return button;
  }
  ignoreEvent() { return false; }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-live-rule";
    return rule;
  }
  ignoreEvent() { return true; }
}

function selectionTouches(state, from, to) {
  return state.selection.ranges.some((range) => range.empty
    ? range.head >= from && range.head <= to
    : range.from < to && range.to > from);
}

function childNodes(node, name) {
  const found = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!name || child.name === name) found.push(child);
  }
  return found;
}

// 번호목록 항목의 표시 번호 = 같은 OrderedList 안에서 실제로 몇 번째 항목인지(문서 순서).
// 사용자가 입력한 원문 숫자("1. 6. 8. 1.")는 무시 — 미리보기의 <ol> 이 그렇듯 항상 1부터 이어서 매긴다.
// 중첩된 하위 목록은 부모 OrderedList 의 카운터에 영향을 주지 않는다(parent.from 으로 목록별로 분리 카운트).
function listOrdinals(state) {
  const counters = new Map();
  const ordinals = new Map();
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== "ListItem") return;
      const parent = ref.node.parent;
      if (!parent || parent.name !== "OrderedList") return;
      const next = counters.get(parent.from) || 1;
      ordinals.set(ref.from, next);
      counters.set(parent.from, next + 1);
    },
  });
  return ordinals;
}

function lineDecorations(state, from, to, className, add) {
  let line = state.doc.lineAt(from);
  const last = state.doc.lineAt(Math.max(from, to - 1)).number;
  while (line.number <= last) {
    add(Decoration.line({ class: className }).range(line.from));
    if (line.number === last) break;
    line = state.doc.line(line.number + 1);
  }
}

function colorMatches(state, visibleRanges) {
  const matches = new Map();
  for (const visible of visibleRanges) {
    const scanFrom = Math.max(0, state.doc.lineAt(visible.from).from - 65536);
    const scanTo = Math.min(state.doc.length, state.doc.lineAt(visible.to).to + 65536);
    const windowText = state.doc.sliceString(scanFrom, scanTo);
    const localFrom = visible.from - scanFrom;
    const localTo = visible.to - scanFrom;
    const beforeOpen = windowText.lastIndexOf("{색:", localFrom);
    const beforeClose = windowText.lastIndexOf("{/색}", localFrom);
    const from = beforeOpen > beforeClose ? beforeOpen : state.doc.lineAt(visible.from).from - scanFrom;
    const afterClose = windowText.indexOf("{/색}", localTo);
    const to = afterClose >= 0 ? afterClose + 4 : state.doc.lineAt(visible.to).to - scanFrom;
    const slice = windowText.slice(from, to);
    const regexp = /\{색:(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})\}([\s\S]*?)\{\/색\}/g;
    for (let match; (match = regexp.exec(slice));) {
      const start = scanFrom + from + match.index;
      const openTo = start + match[0].indexOf("}") + 1;
      const end = start + match[0].length;
      const closeFrom = end - 4;
      if (end < visible.from || start > visible.to) continue;
      matches.set(`${start}:${end}`, { start, openTo, closeFrom, end, color: match[1] });
    }
  }
  return [...matches.values()];
}

function liveDecorations(view) {
  const state = view.state;
  if (!state.field(liveModeField)) return { decorations: Decoration.none, atomic: Decoration.none };
  const ranges = [];
  const atomic = [];
  const folds = state.field(foldField).folds;
  const seen = new Set();
  const markdownLinks = [];
  const add = (range) => ranges.push(range);
  const hide = (from, to) => {
    if (from >= to) return;
    const range = Decoration.replace({}).range(from, to);
    ranges.push(range);
    atomic.push(range);
  };
  const folded = (from, to) => folds.some((fold) => from >= fold.from && to <= fold.to);
  let ordinals = null;
  const getOrdinals = () => ordinals || (ordinals = listOrdinals(state));

  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(ref) {
        const node = ref.node;
        const key = `${node.name}:${node.from}:${node.to}`;
        if (seen.has(key) || folded(node.from, node.to)) return;
        seen.add(key);
        const active = selectionTouches(state, node.from, node.to);

        const heading = /^ATXHeading([1-6])$/.exec(node.name);
        if (heading) {
          lineDecorations(state, node.from, node.to, `cm-live-heading cm-live-h${heading[1]}`, add);
          if (!active) for (const mark of childNodes(node, "HeaderMark")) hide(mark.from, mark.to);
          return;
        }
        if (node.name === "StrongEmphasis" || node.name === "Emphasis" || node.name === "Strikethrough") {
          const cls = node.name === "StrongEmphasis" ? "cm-live-strong" : node.name === "Emphasis" ? "cm-live-em" : "cm-live-strike";
          add(Decoration.mark({ class: cls }).range(node.from, node.to));
          if (!active) {
            const marker = node.name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
            for (const mark of childNodes(node, marker)) hide(mark.from, mark.to);
          }
          return;
        }
        if (node.name === "InlineCode") {
          add(Decoration.mark({ class: "cm-live-inline-code" }).range(node.from, node.to));
          if (!active) for (const mark of childNodes(node, "CodeMark")) hide(mark.from, mark.to);
          return;
        }
        if (node.name === "Link") {
          markdownLinks.push([node.from, node.to]);
          const marks = childNodes(node, "LinkMark");
          const url = childNodes(node, "URL")[0];
          const labelFrom = marks[0]?.to ?? node.from;
          const labelTo = marks[1]?.from ?? url?.from ?? node.to;
          const href = url ? state.doc.sliceString(url.from, url.to) : "";
          if (labelFrom < labelTo) add(Decoration.mark({ class: "cm-live-link", attributes: { "data-href": href } }).range(labelFrom, labelTo));
          if (!active) {
            for (const mark of marks) hide(mark.from, mark.to);
            if (url) hide(url.from, url.to);
          }
          return;
        }
        if (node.name === "Blockquote") {
          lineDecorations(state, node.from, node.to, "cm-live-quote", add);
          return;
        }
        if (node.name === "QuoteMark") {
          let quote = node.parent;
          while (quote && quote.name !== "Blockquote") quote = quote.parent;
          if (!quote || !selectionTouches(state, quote.from, quote.to)) hide(node.from, node.to);
          return;
        }
        if (node.name === "ListItem") {
          const listMark = childNodes(node, "ListMark")[0];
          const task = childNodes(node, "Task")[0];
          const taskMarker = task ? childNodes(task, "TaskMarker")[0] : null;
          if (listMark && !active) {
            if (taskMarker) hide(listMark.from, listMark.to);
            else {
              const raw = state.doc.sliceString(listMark.from, listMark.to);
              const ordinal = node.parent?.name === "OrderedList" ? getOrdinals().get(node.from) : null;
              const label = ordinal != null ? `${ordinal}${/[.)]/.exec(raw)?.[0] || "."}` : raw;
              const range = Decoration.replace({ widget: new BulletWidget(label) }).range(listMark.from, listMark.to);
              ranges.push(range); atomic.push(range);
            }
          }
          if (taskMarker && !selectionTouches(state, task.from, task.to)) {
            const checked = /x/i.test(state.doc.sliceString(taskMarker.from, taskMarker.to));
            const range = Decoration.replace({ widget: new CheckboxWidget(taskMarker.from, checked) }).range(taskMarker.from, taskMarker.to);
            ranges.push(range); atomic.push(range);
            add(Decoration.mark({ class: checked ? "cm-live-task-done" : "" }).range(taskMarker.to, task.to));
          }
          const nested = childNodes(node).find((child) => child.name === "BulletList" || child.name === "OrderedList");
          if (listMark && nested) {
            const fold = { key: node.from, from: state.doc.lineAt(node.from).to, to: node.to };
            const collapsed = folds.some((entry) => entry.key === fold.key);
            add(Decoration.widget({ widget: new FoldWidget(fold, collapsed), side: 1 }).range(listMark.to));
          }
          return;
        }
        if (node.name === "HorizontalRule" && !active) {
          const range = Decoration.replace({ widget: new HorizontalRuleWidget() }).range(node.from, node.to);
          ranges.push(range); atomic.push(range);
          return;
        }
        if (node.name === "FencedCode") {
          lineDecorations(state, node.from, node.to, "cm-live-code-block", add);
          if (!active) {
            const marks = childNodes(node, "CodeMark");
            const firstLine = state.doc.lineAt(node.from);
            if (marks[0]) {
              hide(firstLine.from, firstLine.to);
              add(Decoration.line({ class: "cm-live-code-fence" }).range(firstLine.from));
            }
            if (marks.length > 1) {
              const lastLine = state.doc.lineAt(marks[marks.length - 1].from);
              hide(lastLine.from, lastLine.to);
              add(Decoration.line({ class: "cm-live-code-fence" }).range(lastLine.from));
            }
          }
        }
      },
    });
  }

  for (const match of colorMatches(state, view.visibleRanges)) {
    const active = selectionTouches(state, match.start, match.end);
    add(Decoration.mark({ class: "cm-live-color", attributes: { style: `color:${match.color}` } }).range(match.openTo, match.closeFrom));
    if (!active) { hide(match.start, match.openTo); hide(match.closeFrom, match.end); }
  }

  const urlRegexp = /https?:\/\/[^\s<>()]+/g;
  for (const visible of view.visibleRanges) {
    const from = state.doc.lineAt(visible.from).from;
    const to = state.doc.lineAt(visible.to).to;
    const text = state.doc.sliceString(from, to);
    for (let match; (match = urlRegexp.exec(text));) {
      const start = from + match.index;
      const end = start + match[0].length;
      if (markdownLinks.some(([a, b]) => start >= a && end <= b)) continue;
      add(Decoration.mark({ class: "cm-live-link", attributes: { "data-href": match[0] } }).range(start, end));
    }
  }

  return { decorations: Decoration.set(ranges, true), atomic: Decoration.set(atomic, true) };
}

const livePlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    const built = liveDecorations(view);
    this.decorations = built.decorations;
    this.atomic = built.atomic;
  }
  update(update) {
    const effectsChanged = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setLiveMode) || effect.is(toggleFold)));
    if (!update.docChanged && !update.selectionSet && !update.viewportChanged && !effectsChanged) return;
    const built = liveDecorations(update.view);
    this.decorations = built.decorations;
    this.atomic = built.atomic;
  }
}, { decorations: (value) => value.decorations });

const liveAtomicRanges = EditorView.atomicRanges.of((view) => view.plugin(livePlugin)?.atomic || Decoration.none);

function operationsToChanges(ops) {
  const changes = [];
  let position = 0;
  let pending = null;
  const flush = () => {
    if (pending) changes.push(pending);
    pending = null;
  };
  for (const part of ops || []) {
    if (typeof part === "string") {
      if (pending && (pending.from === position || pending.to === position)) pending.insert += part;
      else { flush(); pending = { from: position, to: position, insert: part }; }
    } else if (part > 0) {
      flush();
      position += part;
    } else if (part < 0) {
      const to = position - part;
      if (pending && pending.from === position && pending.to === position) pending.to = to;
      else { flush(); pending = { from: position, to, insert: "" }; }
      position = to;
    }
  }
  flush();
  return changes;
}

function createMemoEditor(options) {
  const readOnly = new Compartment();
  const callbacks = options || {};
  let mode = "source";
  let writable = false;
  const extensions = [
    basicSetup,
    syntaxHighlighting(memoHighlightStyle),
    memoCloseBrackets,
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    keymap.of([indentWithTab]),
    placeholder("마크다운으로 메모를 작성하세요. 채널 멤버와 실시간으로 함께 편집됩니다."),
    readOnly.of(EditorState.readOnly.of(true)),
    liveModeField,
    foldField,
    foldAtomicRanges,
    remoteCursorField,
    livePlugin,
    liveAtomicRanges,
    EditorView.domEventHandlers({
      mousedown(event) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const link = event.target?.closest?.(".cm-live-link[data-href]");
        const href = link?.dataset?.href || "";
        if (!/^https?:\/\//i.test(href)) return false;
        event.preventDefault();
        callbacks.onOpenLink?.(href);
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.every((transaction) => transaction.annotation(externalChange))) {
        callbacks.onChange?.(update.state.doc.toString());
      }
      if (update.selectionSet || update.focusChanged) {
        const main = update.state.selection.main;
        callbacks.onSelectionChange?.({ anchor: main.anchor, head: main.head });
      }
    }),
  ];

  const createState = (doc = "", selection = 0) => EditorState.create({
    doc,
    selection: EditorSelection.single(Math.max(0, Math.min(selection, doc.length))),
    extensions,
  });
  const view = new EditorView({ state: createState(), parent: callbacks.parent });
  callbacks.parent.dataset.memoMode = mode;

  return {
    getText: () => view.state.doc.toString(),
    getSelection: () => ({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }),
    setSelection(anchor, head = anchor) {
      const length = view.state.doc.length;
      view.dispatch({ selection: EditorSelection.single(
        Math.max(0, Math.min(anchor, length)),
        Math.max(0, Math.min(head, length)),
      ) });
    },
    reset(text, selection = 0) {
      view.setState(createState(String(text || ""), selection));
      callbacks.parent.dataset.memoMode = mode;
      if (mode === "live") view.dispatch({ effects: setLiveMode.of(true) });
      if (writable) view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(false)) });
    },
    setMode(next) {
      mode = next === "live" ? "live" : "source";
      callbacks.parent.dataset.memoMode = mode;
      view.dispatch({ effects: setLiveMode.of(mode === "live"), annotations: Transaction.addToHistory.of(false) });
    },
    setReadOnly(value) {
      writable = !value;
      view.dispatch({
        effects: readOnly.reconfigure(EditorState.readOnly.of(Boolean(value))),
        annotations: Transaction.addToHistory.of(false),
      });
    },
    setTypography({ fontFamily, fontWeight, fontSize }) {
      if (fontFamily) callbacks.parent.style.setProperty("--memo-font", fontFamily);
      callbacks.parent.style.setProperty("--memo-weight", fontWeight || "400");
      if (fontSize) callbacks.parent.style.setProperty("--memo-size", `${fontSize}px`);
      view.requestMeasure();
    },
    setPalette(colors) {
      const set = (name, value) => {
        if (value) callbacks.parent.style.setProperty(name, value);
        else callbacks.parent.style.removeProperty(name);
      };
      set("--memo-color-em", colors?.em);
      set("--memo-color-strong", colors?.strong);
      set("--memo-color-strongem", colors?.strongem);
      set("--memo-color-marker", colors?.marker);
    },
    wrapSelection(open, close, fallback) {
      if (view.state.readOnly) return;
      const selection = view.state.selection.main;
      const selected = view.state.sliceDoc(selection.from, selection.to) || fallback;
      const insert = open + selected + close;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: EditorSelection.range(selection.from + open.length, selection.from + open.length + selected.length),
      });
      view.focus();
    },
    replaceRange(from, to, insert) {
      if (view.state.readOnly) return;
      view.dispatch({ changes: { from, to, insert } });
    },
    applyOperations(ops, selection) {
      const changes = operationsToChanges(ops);
      if (!changes.length) return;
      const length = changes.reduce((size, change) => size - (change.to - change.from) + change.insert.length, view.state.doc.length);
      const anchor = Math.max(0, Math.min(selection?.anchor ?? view.state.selection.main.anchor, length));
      const head = Math.max(0, Math.min(selection?.head ?? view.state.selection.main.head, length));
      view.dispatch({
        changes,
        selection: EditorSelection.single(anchor, head),
        annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
      });
    },
    setRemoteCursors(cursors) {
      view.dispatch({ effects: setRemoteCursors.of(cursors || []), annotations: Transaction.addToHistory.of(false) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

window.AccordMemoEditor = { create: createMemoEditor };
