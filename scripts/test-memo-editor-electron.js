"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, clipboard } = require("electron");
const resultPath = process.env.MEMO_TEST_RESULT || "";

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

function wait(ms = 35) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function report(message) {
  if (resultPath) fs.writeFileSync(resultPath, message, "utf8");
}

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 800,
    height: 620,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => console.error("renderer gone", details));
  await window.loadFile(path.join(__dirname, "fixtures", "memo-editor.html"));
  const evaluate = (source) => window.webContents.executeJavaScript(source, true);
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await wait();
  };
  const type = async (text) => {
    for (const char of text) {
      window.webContents.sendInputEvent({ type: "char", keyCode: char });
      await wait(8);
    }
    await wait();
  };

  // 줄번호 거터와 실제 텍스트 줄의 세로 위치가 정확히 일치해야 한다(gutter padding-top 중복 회귀 방지).
  // CDP debugger 부착(아래 IME 시뮬레이션)이 이후 측정에 부작용을 남기므로 그 전에 검사한다.
  const alignDoc = "하나\n둘\n셋\n넷";
  await evaluate(`memoEditor.reset(${JSON.stringify(alignDoc)}, 0); memoEditor.setReadOnly(false); memoEditor.setMode('source')`);
  await wait(150);
  const alignment = await evaluate(`JSON.stringify({
    gutters: Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')).filter((el) => el.style.visibility !== 'hidden').map((el) => el.getBoundingClientRect().top),
    lines: Array.from(document.querySelectorAll('.cm-line')).map((el) => el.getBoundingClientRect().top),
  })`);
  const { gutters: gutterTops, lines: lineTops } = JSON.parse(alignment);
  assert(gutterTops.length === lineTops.length && gutterTops.every((top, i) => Math.abs(top - lineTops[i]) < 0.5),
    "줄번호 거터의 세로 위치가 실제 텍스트 줄과 정확히 일치해야 함");

  await evaluate("memoEditor.reset(''); memoEditor.setReadOnly(false); memoEditor.setMode('live'); memoEditor.focus()");
  window.webContents.debugger.attach("1.3");
  try {
    await window.webContents.debugger.sendCommand("Input.imeSetComposition", { text: "한글", selectionStart: 2, selectionEnd: 2 });
    await window.webContents.debugger.sendCommand("Input.insertText", { text: "한글" });
  } finally {
    window.webContents.debugger.detach();
  }
  await wait();
  assert(await evaluate("memoEditor.getText()") === "한글", "Chromium IME 조합 확정이 한 번만 입력되어야 함");
  await key("ENTER");
  await type("후");
  assert(await evaluate("memoEditor.getText()") === "한글\n후", "IME 확정 뒤 Enter가 줄을 복제하지 않아야 함");

  await evaluate("memoEditor.reset(''); memoEditor.setReadOnly(false); memoEditor.setMode('live'); memoEditor.focus()");
  await type("빈 문서");
  assert(await evaluate("memoEditor.getText()") === "빈 문서", "빈 문서에서 한글 입력이 되어야 함");
  await key("ENTER");
  await key("ENTER");
  await type("다음 줄");
  assert(await evaluate("memoEditor.getText()") === "빈 문서\n\n다음 줄", "Enter 반복이 줄을 복제하지 않아야 함");

  await evaluate(`memoEditor.reset(${JSON.stringify("# 제목\n일반 **굵게** 줄\n마지막")}); memoEditor.setReadOnly(false); memoEditor.setMode('live');
    memoEditor.setSelection(2); memoEditor.focus()`);
  const beforeDown = await evaluate("memoEditor.getSelection().head");
  await key("Down");
  const afterDown = await evaluate("memoEditor.getSelection().head");
  assert(afterDown > beforeDown, "아래 화살표가 다음 시각 줄로 이동해야 함");
  await key("Up");
  assert(await evaluate("memoEditor.getSelection().head") < afterDown, "위 화살표가 이전 시각 줄로 이동해야 함");
  await key("End");
  const lineEnd = await evaluate("memoEditor.getSelection().head");
  await key("Home");
  assert(await evaluate("memoEditor.getSelection().head") <= lineEnd, "Home/End 이동이 동작해야 함");

  await evaluate("memoEditor.reset('선택'); memoEditor.setReadOnly(false); memoEditor.setSelection(0); memoEditor.focus()");
  await key("Right", ["shift"]);
  assert(await evaluate("memoEditor.getSelection().anchor !== memoEditor.getSelection().head"), "Shift+화살표가 글자 단위 선택을 만들어야 함");
  await evaluate("memoEditor.setSelection(2, 0)");
  assert(await evaluate("memoEditor.getSelection().anchor === 2 && memoEditor.getSelection().head === 0"), "드래그와 같은 역방향 선택 범위를 유지해야 함");

  await evaluate("memoEditor.reset('복사할 전체 원문'); memoEditor.setReadOnly(false); memoEditor.focus()");
  await key("A", ["control"]);
  await key("C", ["control"]);
  assert(clipboard.readText() === "복사할 전체 원문", "전체 선택과 복사가 Markdown 원문을 사용해야 함");
  clipboard.writeText("첫째\n둘째\n셋째");
  await key("V", ["control"]);
  assert(await evaluate("memoEditor.getText()") === "첫째\n둘째\n셋째", "여러 줄 붙여넣기가 평문으로 동작해야 함");
  await key("Z", ["control"]);
  assert(await evaluate("memoEditor.getText()") === "복사할 전체 원문", "붙여넣기 실행 취소가 동작해야 함");
  await key("Y", ["control"]);
  assert(await evaluate("memoEditor.getText()") === "첫째\n둘째\n셋째", "다시 실행이 동작해야 함");

  const syntax = "# 제목\n**굵게** *기울임* ~~취소~~ `코드` [링크](https://example.com)\n> 인용\n- [ ] 작업\n- 부모\n  - 자식\n---\n```js\nconst n = 1\n```\n{색:#ff0000}빨강{/색}";
  await evaluate(`memoEditor.reset(${JSON.stringify(syntax)}); memoEditor.setReadOnly(false); memoEditor.setMode('live')`);
  const rendered = await evaluate(`({
    h: !!document.querySelector('.cm-live-h1'), strong: !!document.querySelector('.cm-live-strong'),
    em: !!document.querySelector('.cm-live-em'), strike: !!document.querySelector('.cm-live-strike'),
    code: !!document.querySelector('.cm-live-inline-code'), link: !!document.querySelector('.cm-live-link'),
    quote: !!document.querySelector('.cm-live-quote'), check: !!document.querySelector('.cm-live-check'),
    fold: !!document.querySelector('.cm-live-fold'), rule: !!document.querySelector('.cm-live-rule'),
    color: !!document.querySelector('.cm-live-color'), codeBlock: !!document.querySelector('.cm-live-code-block')
  })`);
  for (const [name, exists] of Object.entries(rendered)) assert(exists, `${name} 라이브 장식이 있어야 함`);
  assert(!(await evaluate("document.querySelector('.cm-content').textContent.includes('**')")), "비활성 강조 문법 표시는 숨겨져야 함");
  const linkPoint = await evaluate(`(() => { const r=document.querySelector('.cm-live-link').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })()`);
  window.webContents.sendInputEvent({ type: "mouseDown", x: linkPoint.x, y: linkPoint.y, button: "left", modifiers: ["control"], clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: linkPoint.x, y: linkPoint.y, button: "left", modifiers: ["control"], clickCount: 1 });
  await wait();
  assert(await evaluate("memoOpenedLinks[0]") === "https://example.com", "Ctrl+링크 클릭이 안전한 URL 열기 콜백을 호출해야 함");
  const strongPoint = await evaluate(`(() => { const r=document.querySelector('.cm-live-strong').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })()`);
  window.webContents.sendInputEvent({ type: "mouseDown", x: strongPoint.x, y: strongPoint.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: strongPoint.x, y: strongPoint.y, button: "left", clickCount: 1 });
  await wait();
  assert(await evaluate("document.querySelector('.cm-content').textContent.includes('**굵게**')"), "렌더된 강조를 클릭하면 해당 문법 단위만 드러나야 함");
  assert(await evaluate("document.querySelectorAll('.cm-live-check').length") === 1, "체크박스는 위젯 하나로 렌더되어야 함");
  await evaluate("document.querySelector('.cm-live-check').click()");
  assert((await evaluate("memoEditor.getText()")).includes("- [x] 작업"), "체크박스 클릭이 원문 트랜잭션이어야 함");
  await key("Z", ["control"]);
  assert((await evaluate("memoEditor.getText()")).includes("- [ ] 작업"), "체크박스 변경이 실행 취소되어야 함");
  await evaluate("document.querySelector('.cm-live-fold').click()");
  assert(await evaluate("document.querySelector('.cm-live-fold').classList.contains('collapsed')"), "목록 접기가 편집기 상태 트랜잭션이어야 함");

  // 번호목록 위젯은 원문 숫자를 그대로 보여주지 않고 미리보기(<ol>)처럼 항목 순서대로 다시 매겨야 하고,
  // 중첩된 하위 불릿목록이 껴 있어도 바깥 번호는 계속 이어져야 한다.
  const ordinalDoc = "커서\n1. 숫자\n6. 설정\n\t- 가\n8. 숫자\n1. 랑랑랑";
  await evaluate(`memoEditor.reset(${JSON.stringify(ordinalDoc)}, 1); memoEditor.setReadOnly(false); memoEditor.setMode('live')`);
  assert(
    (await evaluate("JSON.stringify(Array.from(document.querySelectorAll('.cm-live-bullet')).map((el) => el.textContent))"))
      === JSON.stringify(["1.", "2.", "•", "3.", "4."]),
    "번호목록 위젯이 원문 숫자 대신 실제 순서로 다시 매겨져야 함",
  );

  // 커서가 목록 항목의 "본문"에 있을 때는(마커 자체가 아니면) 옵시디언처럼 번호가 계속 정렬된 값으로 보여야 하고,
  // 마커(숫자) 위에 커서가 있을 때만 원문 숫자를 드러내 편집 가능해야 한다.
  const wrongNumberDoc = "10. a\n11. b\n12. c";
  await evaluate(`memoEditor.reset(${JSON.stringify(wrongNumberDoc)}, ${wrongNumberDoc.length}); memoEditor.setReadOnly(false); memoEditor.setMode('live')`);
  await wait();
  assert(
    (await evaluate("JSON.stringify(Array.from(document.querySelectorAll('.cm-line')).map((el) => el.textContent))"))
      === JSON.stringify(["1. a", "2. b", "3. c"]),
    "커서가 목록 항목 본문에 있어도 번호는 항상 순서대로 다시 매겨져야 함(옵시디언식 강제 재번호)",
  );
  const markerIndex = wrongNumberDoc.lastIndexOf("12.") + 1;
  await evaluate(`memoEditor.setSelection(${markerIndex})`);
  await wait();
  assert(
    (await evaluate("JSON.stringify(Array.from(document.querySelectorAll('.cm-line')).map((el) => el.textContent))"))
      === JSON.stringify(["1. a", "2. b", "12. c"]),
    "커서가 마커 숫자 위에 있을 때는 원문 숫자를 그대로 드러내 편집할 수 있어야 함",
  );

  // 번호목록 밑에 불릿을 Tab 한 번으로 중첩시킬 수 있어야 한다.
  // 기본 들여쓰기(2칸)는 "1. " 마커 폭(3칸)보다 좁아 CommonMark가 하위 목록으로 인식하지 못해 두 번 눌러야 했다.
  const tabDoc = "1. 꼭\n- a\n2. 글";
  await evaluate(`memoEditor.reset(${JSON.stringify(tabDoc)}, ${tabDoc.indexOf("- a")}); memoEditor.setReadOnly(false); memoEditor.setMode('live'); memoEditor.focus()`);
  await key("Tab");
  assert(await evaluate("memoEditor.getText()") === "1. 꼭\n   - a\n2. 글", "리스트 항목에서 Tab 한 번이 위 번호목록 마커 폭만큼 들여써야 함");
  // 커서가 방금 들여쓴 "- a" 의 마커 위에 그대로 있으므로(원문 노출) 다른 곳으로 옮겨 위젯 상태를 확인한다.
  await evaluate("memoEditor.setSelection(9999)");
  assert(
    (await evaluate("JSON.stringify(Array.from(document.querySelectorAll('.cm-live-bullet')).map((el) => el.textContent))"))
      === JSON.stringify(["1.", "•", "2."]),
    "Tab 한 번만으로 하위 불릿이 중첩되어 번호 재계산(2.)이 즉시 반영되어야 함",
  );

  // 목록 접기 화살표는 줄번호 옆 네이티브 foldGutter가 아니라 cm-live-fold(문장 바로 왼쪽, 인라인)만 보여야 한다.
  // CM6 baseTheme이 .cm-gutter{display:flex !important}를 강제해 !important 없인 안 먹는 함정이 있었다.
  await evaluate(`memoEditor.reset(${JSON.stringify("# 제목\n1. 꼭\n\t- a")}); memoEditor.setReadOnly(false); memoEditor.setMode('live')`);
  assert(await evaluate("getComputedStyle(document.querySelector('.cm-foldGutter')).display") === "none",
    "네이티브 접기 거터는 숨겨져 있어야 함(중복·오정렬 방지)");

  await evaluate(`memoEditor.reset('색칠'); memoEditor.setReadOnly(false); memoEditor.setSelection(0, 2);
    memoEditor.wrapSelection('{색:#00ff00}', '{/색}', '색 글자')`);
  assert(await evaluate("memoEditor.getText()") === "{색:#00ff00}색칠{/색}", "색상 적용이 선택 범위를 감싸야 함");
  await key("Z", ["control"]);
  assert(await evaluate("memoEditor.getText()") === "색칠", "색상 적용이 실행 취소되어야 함");

  const longLine = "자동줄바꿈 ".repeat(100);
  await evaluate(`memoEditor.reset(${JSON.stringify(longLine)}); memoEditor.setReadOnly(false); memoEditor.setMode('live')`);
  assert(await evaluate(`(() => { const line=document.querySelector('.cm-line'); const range=document.createRange(); range.selectNodeContents(line); return range.getClientRects().length > 1 })()`), "긴 줄이 편집기 폭에서 자동 줄바꿈되어야 함");

  await evaluate(`memoEditor.reset('처음'); memoEditor.setReadOnly(false); memoEditor.replaceRange(2,2,' 로컬'); memoEditor.setSelection(5);
    memoEditor.setMode('live'); document.querySelector('.cm-scroller').scrollTop = 12; memoEditor.setMode('source'); memoEditor.setMode('live'); memoEditor.focus()`);
  assert(await evaluate("memoEditor.getSelection().head") === 5, "모드 전환이 선택 위치를 유지해야 함");
  await key("Z", ["control"]);
  assert(await evaluate("memoEditor.getText()") === "처음", "모드 전환이 실행 취소 기록을 유지해야 함");
  const scrollDoc = Array.from({length:80}, (_, index) => `줄 ${index}`).join("\n");
  await evaluate(`memoEditor.reset(${JSON.stringify(scrollDoc)}); memoEditor.setReadOnly(false); memoEditor.setMode('source')`);
  await wait();
  const scrollBefore = await evaluate("(() => { const scroller=document.querySelector('.cm-scroller'); scroller.scrollTop=400; return scroller.scrollTop })()");
  assert(scrollBefore > 0, "긴 문서의 스크롤 위치를 설정할 수 있어야 함");
  assert(await evaluate("getComputedStyle(document.querySelector('.cm-gutters')).display !== 'none'"), "소스 모드는 줄번호를 보여야 함");
  await evaluate("memoEditor.setMode('live')");
  assert(await evaluate("getComputedStyle(document.querySelector('.cm-gutters')).display !== 'none'"), "라이브 모드도 줄번호를 보여야 함");
  await evaluate("memoEditor.setMode('source')");
  assert(Math.abs((await evaluate("document.querySelector('.cm-scroller').scrollTop")) - scrollBefore) < 2, "모드 전환이 스크롤 위치를 유지해야 함");

  await evaluate(`memoEditor.reset('abc'); memoEditor.setReadOnly(false); memoEditor.replaceRange(3,3,'L');
    memoEditor.applyOperations([1,'R'], {anchor:5,head:5}); memoEditor.setRemoteCursors([{name:'상대',pos:2,sel:4,color:'#ff4488'}]); memoEditor.focus()`);
  assert(await evaluate("memoEditor.getText()") === "aRbcL", "원격 OT 변경이 실제 구간에 적용되어야 함");
  assert(await evaluate("!!document.querySelector('.cm-memo-remote-cursor') && !!document.querySelector('.cm-memo-remote-selection')"), "원격 커서와 선택이 장식으로 표시되어야 함");
  await key("Z", ["control"]);
  assert(await evaluate("memoEditor.getText()") === "aRbc", "로컬 실행 취소가 원격 변경을 되돌리지 않아야 함");
  await evaluate("memoEditor.reset('abcdef'); memoEditor.setReadOnly(false); memoEditor.applyOperations([1,-2,'XY',2,-1], {anchor:5,head:5})");
  assert(await evaluate("memoEditor.getText()") === "aXYde", "여러 구간이 있는 원격 OT 변경이 정확히 적용되어야 함");

  await evaluate("memoEditor.reset('읽기 전용'); memoEditor.setReadOnly(true); memoEditor.focus()");
  await type("변경");
  assert(await evaluate("memoEditor.getText()") === "읽기 전용", "읽기 전용 문서는 입력으로 바뀌지 않아야 함");
  await key("A", ["control"]);
  assert(await evaluate("memoEditor.getSelection().anchor !== memoEditor.getSelection().head"), "읽기 전용 문서도 선택할 수 있어야 함");

  assert(await evaluate("memoChanges.length > 0 && memoSelections.length > 0"), "변경과 선택 콜백이 발생해야 함");
  window.destroy();
  const result = `${passed} passed, 0 failed`;
  report(result);
  console.log(result);
  app.exit(0);
}

run().catch((error) => {
  report(`FAILED\n${error.stack || error}`);
  console.error(error.stack || error);
  app.exit(1);
});
