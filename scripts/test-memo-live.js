// Test the memo live-preview logic without a browser.
//
// Two layers are checked:
//   1. Pure string logic (renderMarkdown active-line reveal, offset helpers) — loaded from the
//      real public/app.js in a stubbed vm context.
//   2. reconcileLive() node-identity/order logic — the ACTUAL function source extracted from
//      app.js, run against a minimal faithful fake DOM. This is the anti-flicker / caret-safe
//      core: caret/IME survival is a browser consequence of NOT removing the focused node, which
//      these tests verify directly. The remaining visual/IME behaviour needs a real run (see the
//      smoke checklist printed by --checklist).
//
// Run: node scripts/test-memo-live.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_JS = process.env.APP_JS || path.join(__dirname, "..", "public", "app.js");
const src = fs.readFileSync(APP_JS, "utf8");

let pass = 0, fail = 0;
const eq = (a, e, m) => { (JSON.stringify(a) === JSON.stringify(e)) ? pass++ : (fail++, console.log(`FAIL ${m}\n  exp ${JSON.stringify(e)}\n  got ${JSON.stringify(a)}`)); };
const ok = (c, m) => { c ? pass++ : (fail++, console.log(`FAIL ${m}`)); };

// ---------- layer 1: load app.js pure functions in a stubbed vm ----------
function stubEl() {
  return new Proxy(function () {}, {
    get(t, k) {
      if (k === "style") return {};
      if (k === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === "dataset") return {};
      if (k === "value" || k === "textContent" || k === "innerHTML") return "";
      if (k === "children" || k === "childNodes") return [];
      return stubEl();
    },
    set: () => true,
    apply: () => stubEl(),
  });
}
const documentStub = {
  querySelector: stubEl, querySelectorAll: () => [], getElementById: stubEl,
  createElement: stubEl, createTextNode: () => ({}),
  createRange: () => ({ selectNodeContents() {}, setStart() {}, setEnd() {}, collapse() {} }),
  addEventListener() {}, body: stubEl(), documentElement: stubEl(),
  fonts: { add() {}, delete() {}, forEach() {} }, activeElement: null,
};
const ctx = {
  document: documentStub, location: { origin: "http://localhost", href: "http://localhost" },
  navigator: { userAgent: "node", platform: "node", mediaDevices: {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  console, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => 0,
  fetch: () => Promise.reject(new Error("no fetch")), WebSocket: function () {},
  URL, URLSearchParams, TextEncoder, TextDecoder,
  Node: { TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: "app.js" }); }
catch (e) { console.log("[load warning]", e.message); }

const { renderMarkdown, docOffsetOfLine, lineIndexOfOffset, replaceDocLineRange } = ctx;
ok(typeof renderMarkdown === "function", "renderMarkdown defined");
ok(typeof docOffsetOfLine === "function", "docOffsetOfLine defined");
ok(typeof lineIndexOfOffset === "function", "lineIndexOfOffset defined");
ok(typeof replaceDocLineRange === "function", "replaceDocLineRange defined");

const doc = "abc\nde\n\nfghi"; // line starts: 0,4,7,8
eq(docOffsetOfLine(doc, 0), 0, "offset line0");
eq(docOffsetOfLine(doc, 1), 4, "offset line1");
eq(docOffsetOfLine(doc, 2), 7, "offset line2 (blank)");
eq(docOffsetOfLine(doc, 3), 8, "offset line3");
eq(docOffsetOfLine(doc, 99), doc.length, "offset beyond -> end");
eq(lineIndexOfOffset(doc, 0), 0, "line at 0");
eq(lineIndexOfOffset(doc, 4), 1, "line at start of 1");
eq(lineIndexOfOffset(doc, 8), 3, "line at start of 3");
eq(lineIndexOfOffset(doc, 999), 3, "line beyond -> last");
for (let o = 0; o <= doc.length; o++) {
  const li = lineIndexOfOffset(doc, o);
  ok(docOffsetOfLine(doc, li) <= o && o <= docOffsetOfLine(doc, li) + doc.split("\n")[li].length, `caret roundtrip @${o}`);
}
eq(replaceDocLineRange("", 0, 0, "blank"), "blank", "empty live line accepts text");
eq(replaceDocLineRange("before\nalpha\nafter", 1, 1, "alpha\n"), "before\nalpha\n\nafter", "newline replaces active line once");
eq(replaceDocLineRange("a\nb\nc\nd", 1, 2, "B\nC"), "a\nB\nC\nd", "multi-line raw range replacement");

const md = "# Title\n\nhello **world**";
ok(!/memo-live-raw/.test(renderMarkdown(md)), "preview: no raw block");
ok(/<h1[^>]*>Title<\/h1>/.test(renderMarkdown(md)), "preview: heading rendered");
const live0 = renderMarkdown(md, 0);
eq((live0.match(/memo-live-raw/g) || []).length, 1, "live: exactly one raw block");
ok(/data-live-start="0" data-live-end="0"/.test(live0), "live: raw is active line 0");
ok(!/<h1/.test(live0), "live: active heading shown raw, not also as <h1>");
ok(/contenteditable="plaintext-only"/.test(live0), "live: raw uses plaintext-only editing");
const live2 = renderMarkdown(md, 2);
ok(/<h1[^>]*>Title<\/h1>/.test(live2), "live(2): other line still rendered");
ok(/data-live-start="2"/.test(live2), "live(2): active line is raw");
// reuse premise: a non-active line renders identically regardless of which other line is active
ok(live2.includes("<h1") && renderMarkdown(md, 3).includes("<h1"), "live: inactive block stable across active-line moves");
ok(/<br>/.test(renderMarkdown("a\n\nb", 0)), "live: blank line -> spacer");
ok(!/<br>/.test(renderMarkdown("a\n\nb")), "preview: blank line -> nothing");
const codeDoc = "before\n```\nx=1\ny=2\n```\nafter";
ok(/data-live-start="1" data-live-end="4"/.test(renderMarkdown(codeDoc, 2)), "live: code fence is one raw group");
ok(/<pre class="md-code"/.test(renderMarkdown(codeDoc, 0)), "live: inactive fence renders as <pre>");
const cbLive = renderMarkdown("- [ ] a\n- [x] b\n- [ ] c", 9);
eq([...cbLive.matchAll(/data-cb="(\d+)"/g)].map((m) => +m[1]), [0, 1, 2], "live: checkbox ordinals stay document-order");
eq([...cbLive.matchAll(/<li[^>]*data-line="(\d+)"/g)].map((m) => +m[1]), [0, 1, 2], "live: rendered list items retain source lines");

// ---------- layer 2: reconcileLive against a minimal fake DOM ----------
function extractFn(source, name) {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("not found: " + name);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("unbalanced: " + name);
}
// Faithful-enough element: reconcileLive only reads outerHTML/classList/dataset/children and
// moves nodes via insertBefore/remove. Our test HTML is flat <div ...>...</div> with no nested divs.
class El {
  constructor(outer) {
    this.parent = null;
    this._kids = [];
    if (outer !== undefined) {
      this.outerHTML = outer;
      const attrs = {};
      for (const [, k, v] of outer.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[k] = v;
      this.className = attrs.class || "";
      this.innerHTML = outer.replace(/^<div\b[^>]*>/, "").replace(/<\/div>$/, "");
      this.dataset = { liveStart: attrs["data-line"] ?? attrs["data-live-start"], liveEnd: attrs["data-live-end"] };
    }
  }
  get classList() { return { contains: (c) => this.className.split(/\s+/).includes(c) }; }
  get children() { return this._kids; }
  get lastElementChild() { return this._kids[this._kids.length - 1] || null; }
  set innerHTML(html) {
    if (this._parsing) { this._html = html; return; }
    this._parsing = true; this._html = html;
    this._kids = [];
    for (const [, whole] of [...html.matchAll(/(<div\b[^>]*>[\s\S]*?<\/div>)/g)].map((m) => [null, m[1]])) {
      const child = new El(whole); child.parent = this; this._kids.push(child);
    }
    this._parsing = false;
  }
  get innerHTML() { return this._html || ""; }
  insertBefore(node, ref) {
    if (node.parent) { const i = node.parent._kids.indexOf(node); if (i >= 0) node.parent._kids.splice(i, 1); }
    node.parent = this;
    const at = ref ? this._kids.indexOf(ref) : -1;
    if (at < 0) this._kids.push(node); else this._kids.splice(at, 0, node);
  }
  remove() { if (this.parent) { const i = this.parent._kids.indexOf(this); if (i >= 0) this.parent._kids.splice(i, 1); } }
}
const fakeDoc = { createElement: () => new El() };
const reconcileLive = new Function("document", extractFn(src, "reconcileLive") + "\nreturn reconcileLive;")(fakeDoc);

const RAW = (s, e, t) => `<div class="memo-live-raw" contenteditable="true" data-live-start="${s}" data-live-end="${e}">${t}</div>`;
const LINE = (n, h) => `<div class="memo-live-line" data-line="${n}"><p>${h}</p></div>`;
const idx = (c, n) => c._kids.indexOf(n);

const c = new El(); c.innerHTML = "";
reconcileLive(c, LINE(0, "a") + RAW(1, 1, "b") + LINE(2, "c"), null);
eq(c.children.length, 3, "reconcile: 3 blocks initially");
const n0 = c.children[0], raw = c.children[1], n2 = c.children[2];
ok(raw.classList.contains("memo-live-raw"), "reconcile: middle is raw");

// typing in raw: raw text changes, other blocks identical -> preserve everything by identity
reconcileLive(c, LINE(0, "a") + RAW(1, 1, "bX") + LINE(2, "c"), raw);
ok(c.children[1] === raw, "typing: focused raw identity preserved");
ok(c.children[0] === n0 && c.children[2] === n2, "typing: unchanged blocks reused (no flicker)");

// remote edit of a NON-focused block while caret is in raw (the discriminating case)
reconcileLive(c, LINE(0, "a") + RAW(1, 1, "bX") + LINE(2, "c-remote"), raw);
ok(c.children[1] === raw, "remote: focused raw untouched");
ok(c.children[0] === n0, "remote: untouched block still reused");
ok(c.children[2] !== n2, "remote: changed block replaced");
ok(c.children[2].innerHTML.includes("c-remote"), "remote: replaced block has new content");

// remote INSERT above the focused raw: raw shifts down, identity + range attrs must update
reconcileLive(c, LINE(0, "a") + LINE(1, "new") + RAW(2, 2, "bX") + LINE(3, "c-remote"), raw);
eq(idx(c, raw), 2, "insert-above: raw moved to index 2");
ok(c.children[2] === raw, "insert-above: raw identity preserved (caret survives)");
eq([raw.dataset.liveStart, raw.dataset.liveEnd], ["2", "2"], "insert-above: raw range attrs updated");
eq(c.children.length, 4, "insert-above: block count correct");

// block switch (freshFocus): old raw rebuilt away, new active line becomes the raw
reconcileLive(c, LINE(0, "a") + LINE(1, "new") + LINE(2, "bX-done") + RAW(3, 3, "c-remote"), null);
eq(idx(c, raw), -1, "switch: old raw removed");
ok(c.children[3].classList.contains("memo-live-raw"), "switch: new active line is raw");
eq(c.children.length, 4, "switch: block count stable");

// External doc change on the ACTIVE line (memo:state load / memo:op remote edit of my line):
// preserve keeps the stale focused-raw text (correct only for local typing) — freshFocus must
// refresh it, else the loaded/remote text renders blank or a stale raw clobbers the peer's edit.
// refreshLiveIfActiveLineStale() is the caller that switches to freshFocus in exactly this case.
{
  const cc = new El(); cc.innerHTML = "";
  reconcileLive(cc, RAW(0, 0, ""), null);              // after openMemoRoom: empty active raw, focused
  const stale = cc.children[0];
  reconcileLive(cc, RAW(0, 0, "Hello world"), stale);  // preserve path (what a plain render does)
  ok(cc.children[0] === stale && cc.children[0].innerHTML === "", "preserve keeps focused-raw text (local-typing invariant)");
  reconcileLive(cc, RAW(0, 0, "Hello world"), null);   // freshFocus path (what the fix triggers)
  ok(cc.children[0].innerHTML.includes("Hello world"), "freshFocus refreshes external change on active line (load/remote fix)");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (process.argv.includes("--checklist")) {
  console.log(`\n--- manual smoke test (needs a real run: server + login + memo room, live tab) ---
 1. Type Korean (한글) mid-line: no caret jump, no doubled/dropped syllables during IME composition.
 2. Type fast across a line: no flicker, caret stays put.
 3. Enter mid-paragraph: line above renders, caret lands at start of the new line.
 4. Backspace at line start: merges into previous line, caret at the join.
 5. Arrow Up/Down/Left/Right across rendered blocks: caret crosses smoothly.
 6. Click a rendered line: it becomes editable raw with caret at the click's line.
 7. Toggle a checkbox and a fold in the live view: still works.
 8. Two clients in the same memo, live tab: while A types on line 5, B edits line 1 — A's caret must NOT jump and B's change must appear.
 9. Paste multi-line text into a line: lands as plain text, splits into lines.`);
}
process.exit(fail ? 1 : 0);
