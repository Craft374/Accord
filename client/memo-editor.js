import { EditorView, basicSetup } from "codemirror";
import { Annotation, Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { acceptCompletion } from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown, markdownLanguage, insertNewlineContinueMarkupCommand, deleteMarkupBackward } from "@codemirror/lang-markdown";

// basicSetup 의 defaultHighlightStyle 은 밝은 배경 전제(헤딩 밑줄, 마크문자 어두운 회색)라 다크 테마에서
// 안 보이거나(#404740 회색) 밑줄이 남는다(제목). 마크다운에 실제로 쓰이는 태그만 다시 정의해 완전히 대체한다.
const memoHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.processingInstruction, color: "var(--memo-color-marker, var(--warning))" },
  { tag: tags.special(tags.content), backgroundColor: "var(--warning)", color: "#1a1a1a", borderRadius: "2px" },
  { tag: tags.comment, opacity: "0.55" },
]);

// 옵시디언 확장 인라인 문법(==하이라이트==, %%주석%%) — 표준 CommonMark/GFM 에 없어 Lezer 파서에 직접 얹는다.
// Strikethrough(@lezer/markdown)의 델리미터 페어 방식을 그대로 따른다: 여는/닫는 마커를 addDelimiter 로 등록해
// 파서가 짝을 찾게 하는 표준 idiom. 프리뷰(public/app.js)의 정규식 처리와 별개 구현이지만 같은 문법을 인식한다.
const memoHighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };
const memoCommentDelim = { resolve: "Comment", mark: "CommentMark" };
const memoInlineSyntax = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": tags.special(tags.content) } },
    { name: "HighlightMark", style: tags.processingInstruction },
    { name: "Comment", style: tags.comment },
    { name: "CommentMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== 61 /* '=' */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before), spaceAfter = /\s|^$/.test(after);
        return cx.addDelimiter(memoHighlightDelim, pos, pos + 2, !spaceAfter, !spaceBefore);
      },
      after: "Emphasis",
    },
    {
      name: "Comment",
      parse(cx, next, pos) {
        if (next !== 37 /* '%' */ || cx.char(pos + 1) !== 37) return -1;
        return cx.addDelimiter(memoCommentDelim, pos, pos + 2, true, true);
      },
      before: "Escape",
    },
  ],
};

// "*" 를 괄호처럼 취급해 선택한 글자를 양쪽에서 감싸게 한다(closeBrackets 는 이미 basicSetup 에 포함됨,
// 여기선 대상 문자만 languageData 로 추가). 별 3개는 감싸기를 세 번 반복 적용해 자연히 얻어진다.
const memoCloseBrackets = EditorState.languageData.of(() => [
  { closeBrackets: { brackets: ["(", "[", "{", "'", '"', "*"] } },
]);

// 선택 상태에서 '~' 를 누르면 취소선(~~..~~)으로 한 번에 감싼다. closeBrackets 의 self-매칭 방식은 한 글자만
// 감싸(~text~) 두 번 눌러야 하므로 GFM 취소선엔 안 맞는다 — closeBrackets 와 같은 계층(EditorView.inputHandler)에
// 직접 하나 더 얹어 '~' 이고 선택 영역이 있을 때만 가로챈다(그 외엔 false 를 돌려줘 평범한 입력으로 흘려보낸다).
const memoStrikethroughInput = EditorView.inputHandler.of((view, from, to, insert) => {
  if (insert !== "~" || from >= to || view.state.readOnly) return false;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `~~${selected}~~` },
    selection: EditorSelection.range(from + 2, from + 2 + selected.length),
    userEvent: "input.type",
  });
  return true;
});

// 설정(탭키 마크다운 자동완성) 켬/꺼짐. 에디터 인스턴스와 무관한 전역 상태(문서엔 하나만 떠 있음).
const memoAutocompleteState = { enabled: true };

// 줄 맨 앞에서 #, -, 1., >, ``` 등을 치면 나머지를 채워 주는 블록 마크다운 스니펫(basicSetup의 autocompletion()이 이미
// 켜져 있으므로 여기선 languageData 로 completion source만 얹는다 — autocompletion()을 또 호출할 필요 없음).
const MEMO_BLOCK_SNIPPETS = [
  { label: "# ", detail: "제목 1" },
  { label: "## ", detail: "제목 2" },
  { label: "### ", detail: "제목 3" },
  { label: "- ", detail: "글머리 목록" },
  { label: "1. ", detail: "번호 목록" },
  { label: "- [ ] ", detail: "체크박스" },
  { label: "> ", detail: "인용" },
];
const MEMO_SNIPPET_TRIGGER = /[#>\-\d.[\] `]*/;
function memoMarkdownCompletions(context) {
  if (!memoAutocompleteState.enabled) return null;
  const line = context.state.doc.lineAt(context.pos);
  const word = context.matchBefore(MEMO_SNIPPET_TRIGGER);
  if (!word || word.from !== line.from) return null;
  if (word.from === word.to && !context.explicit) return null;
  const options = MEMO_BLOCK_SNIPPETS.map((s) => ({ label: s.label, detail: s.detail, type: "keyword" }));
  options.push({
    label: "```",
    detail: "코드 블록",
    type: "keyword",
    apply(view, completion, from, to) {
      view.dispatch({ changes: { from, to, insert: "```\n\n```" }, selection: EditorSelection.single(from + 4) });
    },
  });
  return { from: word.from, options, validFor: MEMO_SNIPPET_TRIGGER };
}
const memoAutocomplete = EditorState.languageData.of(() => [{ autocomplete: memoMarkdownCompletions }]);

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

// 표는 파이프 원문이 읽기 힘들어 커서가 밖에 있을 때만 실제 <table> 로 통째 교체한다(원문은 커서가 들어오면 자동 노출 —
// atomicRanges 라 클릭/화살표가 경계에서 멈추고, 안으로 들어가면 이 위젯 자체가 사라져 원문이 보인다).
// HTML 은 window.AccordMemoRender.table(public/app.js, 미리보기와 동일한 렌더러)로 만든다 — 두 번째 표 렌더러를 새로 안 만든다.
class TableWidget extends WidgetType {
  constructor(html) {
    super();
    this.html = html;
  }
  eq(other) { return other.html === this.html; }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-table";
    wrap.innerHTML = this.html;
    return wrap;
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
// 리스트 항목에서 Tab: 위 줄 마커의 내용 시작 칸에 맞춰 한 번에 들여쓴다.
// 기본 indentMore(+2칸)만 쓰면 "1. "(3칸) 밑에 "- "를 하나만 눌러서는 CommonMark 중첩 폭에
// 못 미쳐(2<3) 파서가 하위 목록으로 인식하지 못하고, 두 번 눌러야(4칸) 겨우 인식됐다.
// 여러 줄을 선택하고 Tab 을 눌렀을 때도 같은 폭만큼(첫 줄 기준) 한꺼번에 밀어 상대 구조를 유지한다.
const LIST_MARK_RE = /^(\s*)([-*+]|\d+[.)])(\s+)/;
function listAwareIndent(view) {
  const { state } = view;
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from);
  const curMatch = LIST_MARK_RE.exec(first.text);
  if (!curMatch) return false;
  let prevLine = null;
  for (let n = first.number - 1; n >= 1; n--) {
    const candidate = state.doc.line(n);
    if (candidate.text.trim()) { prevLine = candidate; break; }
  }
  const prevMatch = prevLine && LIST_MARK_RE.exec(prevLine.text);
  if (!prevMatch) return false;
  const targetIndent = prevMatch[0].length;
  const currentIndent = curMatch[1].length;
  if (currentIndent >= targetIndent) return false;
  const insert = " ".repeat(targetIndent - currentIndent);
  const changes = [];
  for (let n = first.number; n <= state.doc.lineAt(sel.to).number; n++) {
    const line = state.doc.line(n);
    if (line.text.trim()) changes.push({ from: line.from, insert });
  }
  view.dispatch({
    changes,
    selection: sel.empty ? EditorSelection.cursor(sel.head + insert.length) : undefined,
    userEvent: "input.indent",
  });
  return true;
}

// Shift-Tab: listAwareIndent 의 반대 방향. 기본 indentLess 는 목록 마커를 모르고 고정폭(2칸)만
// 줄여서, listAwareIndent 가 3칸(마커 폭) 들여쓴 걸 되돌리면 1칸이 남는 문제가 있었다.
// 상위(들여쓰기가 더 얕은) 목록 항목의 폭까지 한 번에 되돌린다.
function listAwareOutdent(view) {
  const { state } = view;
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from);
  const curMatch = LIST_MARK_RE.exec(first.text);
  if (!curMatch) return false;
  const currentIndent = curMatch[1].length;
  if (currentIndent === 0) return false;
  let targetIndent = 0;
  for (let n = first.number - 1; n >= 1; n--) {
    const candidate = state.doc.line(n);
    if (!candidate.text.trim()) continue;
    const match = LIST_MARK_RE.exec(candidate.text);
    const indent = match ? match[1].length : 0;
    if (indent < currentIndent) { targetIndent = indent; break; }
  }
  const removeWidth = currentIndent - targetIndent;
  if (removeWidth <= 0) return false;
  const changes = [];
  for (let n = first.number; n <= state.doc.lineAt(sel.to).number; n++) {
    const line = state.doc.line(n);
    const width = Math.min(removeWidth, LIST_MARK_RE.exec(line.text)?.[1].length ?? 0);
    if (width > 0) changes.push({ from: line.from, to: line.from + width });
  }
  if (!changes.length) return false;
  view.dispatch({
    changes,
    selection: sel.empty ? EditorSelection.cursor(sel.head - removeWidth) : undefined,
    userEvent: "delete.dedent",
  });
  return true;
}

function listOrdinals(state) {
  const counters = new Map();
  const ordinals = new Map();
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== "ListItem") return;
      const parent = ref.node.parent;
      if (!parent || parent.name !== "OrderedList") return;
      // 목록의 시작 번호는 사용자가 정한 값이므로 첫 항목은 그대로 두고 그 뒤만 이어서 매긴다.
      const next = counters.get(parent.from) ?? (parseInt(state.doc.sliceString(ref.from, ref.from + 10), 10) || 1);
      ordinals.set(ref.from, next);
      counters.set(parent.from, next + 1);
    },
  });
  return ordinals;
}

// 라이브뷰·미리보기가 보여주는 번호를 원문에도 그대로 반영한다(편집할 때마다 마커 숫자를 고쳐 씀).
// ponytail: 목록의 첫 항목만 보호하므로 "2026. 7. 22" 같은 날짜 줄이 연달아 두 줄 이상이면
//           둘째 줄 숫자가 바뀐다. 실제로 문제되면 목록 판정에서 날짜 형태를 빼는 식으로 올릴 것.
const renumberLists = EditorState.transactionFilter.of((transaction) => {
  // IME 조합 중에는 브라우저가 조합 영역 DOM을 직접 관리하므로, 그 자리 텍스트를 별도 트랜잭션으로
  // 갈아치우면 조합 표시가 깨진다(번호가 겹쳐 보이거나 조합 취소 시 사라짐). 조합이 끝난 뒤에만 교정한다.
  if (!transaction.docChanged || transaction.startState.readOnly || transaction.annotation(externalChange) ||
    transaction.isUserEvent("input.type.compose")) return transaction;
  const state = transaction.state;
  const changes = [];
  for (const [from, ordinal] of listOrdinals(state)) {
    const digits = /^\d+/.exec(state.doc.sliceString(from, from + 10))?.[0];
    if (!digits || Number(digits) === ordinal) continue;
    changes.push({ from, to: from + digits.length, insert: String(ordinal) });
  }
  if (!changes.length) return transaction;
  // 재번호는 실행 취소 기록에 남기지 않는다 — 되돌린 문서에 다시 적용되므로 Ctrl+Z 한 번으로 편집 전으로 돌아간다.
  return [transaction, { changes, sequential: true, annotations: Transaction.addToHistory.of(false) }];
});

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
        if (node.name === "StrongEmphasis" || node.name === "Emphasis" || node.name === "Strikethrough" || node.name === "Highlight") {
          const cls = node.name === "StrongEmphasis" ? "cm-live-strong" : node.name === "Emphasis" ? "cm-live-em"
            : node.name === "Strikethrough" ? "cm-live-strike" : "cm-live-highlight";
          add(Decoration.mark({ class: cls }).range(node.from, node.to));
          if (!active) {
            const marker = node.name === "Strikethrough" ? "StrikethroughMark" : node.name === "Highlight" ? "HighlightMark" : "EmphasisMark";
            for (const mark of childNodes(node, marker)) hide(mark.from, mark.to);
          }
          return;
        }
        // 주석(%%...%%)은 옵시디언처럼 편집 중엔 흐리게 보이고(memoHighlightStyle의 tags.comment), 미리보기에서만 사라진다.
        if (node.name === "Comment") {
          add(Decoration.mark({ class: "cm-live-comment" }).range(node.from, node.to));
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
          // 목록 항목 전체(node)가 아니라 마커 자체(listMark)에 커서가 닿았을 때만 원문을 드러낸다.
          // 항목 본문(예: "12. c"의 "c")을 편집 중일 땐 옵시디언처럼 번호가 계속 정렬된 값으로 보여야 한다.
          // IME 조합 중엔 커서 오프셋이 마커 폭 판정과 한 박자 어긋날 수 있고, 그 틈에 위젯을 새로 씌우면
          // 브라우저가 조합 영역 DOM을 못 지우게 막아서 원문 마커 + 위젯이 겹쳐 보인다(예: "1.1.").
          // 조합 중엔 같은 줄이면 항상 원문을 유지해 위젯 교체 자체를 건너뛴다.
          const markerActive = listMark && (selectionTouches(state, listMark.from, listMark.to) ||
            (view.composing && state.doc.lineAt(listMark.from).number === state.doc.lineAt(state.selection.main.head).number));
          if (listMark && !markerActive) {
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
            // 마커 왼쪽(여백)에 띄운다 — 마커 뒤에 두면 숫자 위에 겹쳐 보였다(CSS 로 흐름 밖에 배치).
            add(Decoration.widget({ widget: new FoldWidget(fold, collapsed), side: -1 }).range(listMark.from));
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
          // 문법 강조 — public/app.js 의 highlightTokens 를 window.AccordMemoRender 브릿지로 그대로 재사용한다
          // (미리보기·채팅과 같은 토크나이저, CM6 쪽에 두 번째 파서를 새로 안 만든다).
          const codeText = childNodes(node, "CodeText")[0];
          if (codeText && window.AccordMemoRender?.tokens) {
            const info = childNodes(node, "CodeInfo")[0];
            const lang = info ? state.doc.sliceString(info.from, info.to) : "";
            const code = state.doc.sliceString(codeText.from, codeText.to);
            for (const t of window.AccordMemoRender.tokens(code, lang)) {
              add(Decoration.mark({ class: `hl-${t.cls}` }).range(codeText.from + t.from, codeText.from + t.to));
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

// 표는 여러 줄(줄바꿈 포함)을 통째로 위젯으로 바꾼다 — CM6 는 줄바꿈을 포함하는 replace 데코레이션을
// ViewPlugin 이 아니라 StateField 로만 허용한다("Decorations that replace line breaks may not be
// specified via plugins"). 그래서 다른 라이브 데코레이션(livePlugin)과 분리된 별도 StateField 로 둔다.
function tableDecorations(state) {
  if (!state.field(liveModeField)) return Decoration.none;
  const ranges = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== "Table" || selectionTouches(state, ref.from, ref.to)) return;
      const rawRows = state.doc.sliceString(ref.from, ref.to).split("\n");
      const html = window.AccordMemoRender?.table?.(rawRows) || "";
      ranges.push(Decoration.replace({ widget: new TableWidget(html), block: true }).range(ref.from, ref.to));
    },
  });
  return Decoration.set(ranges, true);
}
const tableField = StateField.define({
  create: (state) => tableDecorations(state),
  update: (value, transaction) => {
    const modeChanged = transaction.effects.some((effect) => effect.is(setLiveMode));
    return (transaction.docChanged || transaction.selection || modeChanged) ? tableDecorations(transaction.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const tableAtomicRanges = EditorView.atomicRanges.of((view) => view.state.field(tableField));

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

// 글꼴/글자 크기를 바꿔도 CM6 가 줄 높이를 다시 재지 않는 문제를 푸는 장치.
// view.requestMeasure() 만으로는 부족하다: ViewState.measure() 는 contentDOM 높이가 달라졌을 때만
// 내용을 다시 재는데, .cm-content 는 스크롤러에 맞춰 늘어나 있어 글자가 커져도 높이가 그대로다.
// → 줄번호 거터만 옛 높이(작게)로 남고 본문만 커져 어긋난다(타이핑하면 그제야 복구).
// theme facet 이 바뀌면 CM6 가 무조건 다시 재므로, 빈 테마 둘을 번갈아 끼워 그 경로를 태운다.
const measureFlipThemes = [EditorView.theme({}), EditorView.theme({})];

function createMemoEditor(options) {
  const readOnly = new Compartment();
  const measureFlip = new Compartment();
  let measureFlipIndex = 0;
  const callbacks = options || {};
  let mode = "source";
  let writable = false;
  const extensions = [
    basicSetup,
    syntaxHighlighting(memoHighlightStyle),
    memoCloseBrackets,
    memoStrikethroughInput,
    memoAutocomplete,
    markdown({ base: markdownLanguage, extensions: [memoInlineSyntax], addKeymap: false }),
    // 기본 markdownKeymap 대신 nonTightLists:false 로 직접 바인딩: 타이트한 2개짜리 목록의
    // 두 번째(마지막) 항목이 비어있을 때 Enter를 누르면, 목록을 "느슨하게" 바꿔 위에 빈 줄을
    // 끼워넣는 기본 동작 대신 다른 항목들처럼 마커만 지우고 목록을 빠져나오게 한다.
    Prec.high(keymap.of([
      { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
      { key: "Backspace", run: deleteMarkupBackward },
    ])),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    // 줄번호가 9→10줄, 99→100줄처럼 자릿수가 늘어날 때 거터 폭이 넓어지며 기존 숫자들이 옆으로 밀리던 문제.
    // 3자리로 항상 고정 폭을 예약해 두면(옵시디언과 동일한 체감) 그 안에서는 밀림이 없다.
    // ponytail: 1000줄을 넘는 메모는 다시 밀린다 — 필요해지면 자릿수만 늘리면 됨.
    lineNumbers({ formatNumber: (n) => String(n).padStart(3, String.fromCharCode(160)) }),
    keymap.of([{ key: "Tab", run: acceptCompletion }, { key: "Tab", run: listAwareIndent, shift: listAwareOutdent }, indentWithTab]),
    placeholder("마크다운으로 메모를 작성하세요. 채널 멤버와 실시간으로 함께 편집됩니다."),
    readOnly.of(EditorState.readOnly.of(true)),
    measureFlip.of(measureFlipThemes[0]),
    renumberLists,
    liveModeField,
    foldField,
    foldAtomicRanges,
    remoteCursorField,
    livePlugin,
    liveAtomicRanges,
    tableField,
    tableAtomicRanges,
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
      measureFlipIndex ^= 1;
      view.dispatch({
        effects: measureFlip.reconfigure(measureFlipThemes[measureFlipIndex]),
        annotations: Transaction.addToHistory.of(false),
      });
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
    getScrollTop: () => view.scrollDOM.scrollTop,
    setScrollTop(top) {
      // 문서를 막 넣은 직후엔 아직 높이가 안 잡혀 브라우저가 값을 0 으로 깎는다 → 레이아웃 뒤에 적용.
      view.requestMeasure({ read: () => 0, write: () => { view.scrollDOM.scrollTop = top; } });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

window.AccordMemoEditor = {
  create: createMemoEditor,
  setAutocomplete: (enabled) => { memoAutocompleteState.enabled = Boolean(enabled); },
};
