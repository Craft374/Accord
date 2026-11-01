"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { markdownLanguage } = require("@codemirror/lang-markdown");
const esbuild = require("esbuild");
const OT = require("../public/ot-text.js");

const editorSource = fs.readFileSync(path.join(__dirname, "..", "client", "memo-editor.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function nodeNames(text) {
  const names = [];
  const cursor = markdownLanguage.parser.parse(text).cursor();
  function walk() {
    names.push(cursor.name);
    if (cursor.firstChild()) {
      do { walk(); } while (cursor.nextSibling());
      cursor.parent();
    }
  }
  walk();
  return names;
}

const samples = {
  heading: ["# 제목", "ATXHeading1"],
  strong: ["**굵게**", "StrongEmphasis"],
  emphasis: ["*기울임*", "Emphasis"],
  strike: ["~~취소~~", "Strikethrough"],
  inlineCode: ["`코드`", "InlineCode"],
  link: ["[링크](https://example.com)", "Link"],
  quote: ["> 인용", "Blockquote"],
  task: ["- [ ] 작업", "TaskMarker"],
  nestedList: ["- 부모\n  - 자식", "BulletList"],
  rule: ["---", "HorizontalRule"],
  fence: ["```js\nconst n=1\n```", "FencedCode"],
};
for (const [name, [text, expected]] of Object.entries(samples)) {
  ok(nodeNames(text).includes(expected), `${name} Markdown 구문 노드를 인식해야 함`);
}

for (const token of [
  "cm-live-heading", "cm-live-strong", "cm-live-em", "cm-live-strike", "cm-live-inline-code",
  "cm-live-link", "cm-live-quote", "CheckboxWidget", "FoldWidget", "HorizontalRuleWidget",
  "cm-live-code-block", "cm-live-color", "selectionTouches", "view.visibleRanges", "atomicRanges",
]) ok(editorSource.includes(token), `${token} 라이브 장식 구현이 있어야 함`);

ok(!appSource.includes("memo-live-raw"), "contenteditable 라이브 블록이 제거되어야 함");
ok(!appSource.includes("getCaretCoordinates"), "textarea 캐럿 미러가 제거되어야 함");
ok(!appSource.includes("onMemoLiveKeydown"), "수동 라이브 화살표 처리가 제거되어야 함");
ok(appSource.includes("controller?.applyOperations"), "원격 OT가 CodeMirror 트랜잭션으로 적용되어야 함");
ok(editorSource.includes("Transaction.addToHistory.of(false)"), "원격 변경이 실행 취소 기록을 오염시키지 않아야 함");
ok(htmlSource.indexOf("memo-editor.bundle.js") < htmlSource.indexOf("app.js"), "CodeMirror 번들이 앱 코드보다 먼저 로드되어야 함");
ok(!/<textarea[^>]+id="memoEditor"/.test(htmlSource), "메모 편집기가 textarea를 사용하지 않아야 함");

const builtBundle = esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "client", "memo-editor.js")],
  bundle: true,
  minify: true,
  format: "iife",
  outfile: path.join(__dirname, "..", "public", "memo-editor.bundle.js"),
  write: false,
}).outputFiles[0].contents;
const committedBundle = fs.readFileSync(path.join(__dirname, "..", "public", "memo-editor.bundle.js"));
ok(Buffer.compare(builtBundle, committedBundle) === 0, "커밋된 CodeMirror 번들이 소스와 일치해야 함");

const base = "abc\ndef";
for (const next of ["Xabc\ndef", "abc\n한글def", "abc", "abc\ndef\n끝"]) {
  const operation = OT.fromDiff(base, next);
  ok(OT.apply(base, operation) === next, `OT diff가 ${JSON.stringify(next)}에 수렴해야 함`);
}
const local = OT.fromDiff("abc", "aLbc");
const remote = OT.fromDiff("abc", "abRc");
const localAfterRemote = OT.transform(local, remote, "right");
const remoteAfterLocal = OT.transform(remote, local, "left");
ok(OT.apply(OT.apply("abc", remote), localAfterRemote) === OT.apply(OT.apply("abc", local), remoteAfterLocal), "동시 OT가 수렴해야 함");

const baseWithBuffer = "abc";
const inflight = OT.fromDiff(baseWithBuffer, "aLbc");
const afterInflight = OT.apply(baseWithBuffer, inflight);
const buffer = OT.fromDiff(afterInflight, "aLbXc");
const remoteConcurrent = OT.fromDiff(baseWithBuffer, "abRc");
const inflightAfterRemote = OT.transform(inflight, remoteConcurrent, "right");
let remoteForLocal = OT.transform(remoteConcurrent, inflight, "left");
const bufferAfterRemote = OT.transform(buffer, remoteForLocal, "right");
remoteForLocal = OT.transform(remoteForLocal, buffer, "left");
const clientResult = OT.apply(OT.apply(afterInflight, buffer), remoteForLocal);
const serverResult = OT.apply(OT.apply(OT.apply(baseWithBuffer, remoteConcurrent), inflightAfterRemote), bufferAfterRemote);
ok(clientResult === serverResult, "inflight와 buffer를 지난 원격 OT가 서버 문서와 수렴해야 함");

// ===== 동시 편집 회귀 (엔터가 상대 커서를 끌고 가던 문제, 번호 목록이 글자를 다른 줄로 옮기던 문제) =====
const { ChangeSet, Text } = require("@codemirror/state");
const numbered = Array.from({ length: 10 }, (_, i) => `${i + 1}. 항목${i + 1}`).join("\n");
// 2번 항목 뒤에서 엔터 + 뒤 번호 고치기(lang-markdown 의 Enter 와 같은 모양의 떨어진 변경들).
function enterInList(doc, afterItem) {
  const changes = [];
  let at = 0;
  let ordinal = 0;
  doc.split("\n").forEach((line, index) => {
    const digits = /^\d+/.exec(line)[0];
    const want = String(++ordinal);
    if (want !== digits) changes.push({ from: at, to: at + digits.length, insert: want });
    at += line.length + 1;
    if (index === afterItem - 1) changes.push({ from: at - 1, insert: `\n${++ordinal}. ` });
  });
  return ChangeSet.of(changes, doc.length);
}

const endOfDoc = OT.fromChanges(ChangeSet.of({ from: 3, insert: "\n" }, 3));
ok(OT.transformCursor(3, endOfDoc, "left") === 3, "상대가 같은 자리에서 엔터를 쳐도 내 커서는 제자리여야 함");
ok(/"left"\),\n\s+head: OT\.transformCursor\(selection\.head, r, "left"\)/.test(appSource), "내 커서는 원격 op 에 left 로 옮겨져야 함");

const listChanges = enterInList(numbered, 2);
const listOp = OT.fromChanges(listChanges);
ok(OT.apply(numbered, listOp) === listChanges.apply(Text.of(numbered.split("\n"))).toString(), "ChangeSet op 가 CodeMirror 결과와 같아야 함");
const deleted = listOp.filter((part) => typeof part === "number" && part < 0).reduce((sum, part) => sum - part, 0);
ok(deleted <= 10, "번호 목록 엔터가 사이 글자까지 지웠다 다시 쓰면 안 됨");

const typedAt = numbered.indexOf("항목7") + 2;
const typed = [typedAt, "★"];
const merged = OT.apply(OT.apply(numbered, listOp), OT.transform(typed, listOp, "right"));
ok(merged.split("\n").some((line) => line.endsWith(". 항목★7")), "상대의 목록 엔터와 겹쳐도 입력은 그 줄에 남아야 함");
ok(merged.includes("8. 항목★7"), "입력한 줄의 번호도 함께 밀려야 함");
const cursorAfter = OT.transformCursor(typedAt, listOp, "left");
ok(OT.apply(numbered, listOp).slice(cursorAfter - 2, cursorAfter) === "항목", "상대의 목록 엔터 뒤에도 내 커서는 같은 글자 옆에 있어야 함");

const repeated = OT.fromChanges(ChangeSet.of({ from: 0, insert: "1" }, 4));
ok(repeated[0] === "1", "같은 숫자 사이 입력도 실제 위치로 보내야 함");

// 3명이 무작위로 입력·삭제하고 메시지 순서가 뒤섞여도 서버와 전원이 같은 문서가 되어야 한다(app.js·server.js 와 같은 순서).
function fuzzConvergence(rounds) {
  let seed = 20261102;
  const random = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = "ab1\n 가";
  for (let round = 0; round < rounds; round++) {
    const server = { text: "1. 가\n2. 나\n\n끝", history: [] };
    const clients = [0, 1, 2].map((id) => ({ id, doc: server.text, rev: 0, inflight: null, buffer: [], inbox: [] }));
    const uplink = [];
    const pump = () => {
      const { client, rev, op } = uplink.shift();
      let merged = op;
      for (let i = rev; i < server.history.length; i++) merged = OT.transform(merged, server.history[i], "right");
      server.text = OT.apply(server.text, merged);
      server.history.push(merged);
      for (const c of clients) c.inbox.push({ rev: server.history.length, op: merged, by: client.id });
    };
    const receive = (c) => {
      const message = c.inbox.shift();
      c.rev = message.rev;
      if (message.by === c.id) {
        c.inflight = c.buffer.shift() || null;
        if (c.inflight) uplink.push({ client: c, rev: c.rev, op: c.inflight });
        return;
      }
      let remoteOp = message.op;
      if (c.inflight) {
        const next = OT.transform(c.inflight, remoteOp, "right");
        remoteOp = OT.transform(remoteOp, c.inflight, "left");
        c.inflight = next;
      }
      c.buffer = c.buffer.map((pending) => {
        const next = OT.transform(pending, remoteOp, "right");
        remoteOp = OT.transform(remoteOp, pending, "left");
        return next;
      });
      c.doc = OT.apply(c.doc, remoteOp);
    };
    for (let step = 0; step < 50; step++) {
      const c = clients[random(3)];
      const action = random(3);
      if (action === 0) {
        const from = random(c.doc.length + 1);
        const to = Math.min(c.doc.length, from + (random(3) === 0 ? 1 + random(3) : 0));
        const changes = ChangeSet.of({ from, to, insert: to > from && random(2) ? "" : alphabet[random(alphabet.length)] }, c.doc.length);
        const op = OT.fromChanges(changes);
        if (!op.length) continue;
        c.doc = OT.apply(c.doc, op);
        if (c.inflight) c.buffer.push(op);
        else { c.inflight = op; uplink.push({ client: c, rev: c.rev, op }); }
      } else if (action === 1 && uplink.length) pump();
      else if (c.inbox.length) receive(c);
    }
    while (uplink.length || clients.some((c) => c.inbox.length)) {
      if (uplink.length) pump();
      for (const c of clients) while (c.inbox.length) receive(c);
    }
    for (const c of clients) ok(c.doc === server.text, `라운드 ${round}: 클라이언트 ${c.id} 문서가 서버와 같아야 함`);
  }
}
fuzzConvergence(1000);

console.log(`${passed} passed, 0 failed`);
