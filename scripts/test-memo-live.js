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
ok(appSource.includes("memoEditorController?.applyOperations"), "원격 OT가 CodeMirror 트랜잭션으로 적용되어야 함");
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

console.log(`${passed} passed, 0 failed`);
