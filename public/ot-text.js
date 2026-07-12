// 텍스트 OT(Operational Transformation) 엔진 — 브라우저/Node 공용.
// 연산(op)은 컴포넌트 배열: 양수 n = n글자 유지(retain), 문자열 = 삽입(insert), 음수 -n = n글자 삭제(delete).
// apply 시 op가 문서 끝까지 다루지 않으면 나머지는 자동으로 유지된다.
(function (root) {
  "use strict";

  function appendComp(op, comp) {
    if (comp === 0 || comp === "") return;
    if (!op.length) { op.push(comp); return; }
    const last = op[op.length - 1];
    if (typeof comp === "string" && typeof last === "string") op[op.length - 1] = last + comp;
    else if (typeof comp === "number" && typeof last === "number" && (comp > 0) === (last > 0)) op[op.length - 1] = last + comp;
    else op.push(comp);
  }

  function apply(doc, op) {
    let res = "";
    let i = 0;
    for (const c of op) {
      if (typeof c === "string") res += c;
      else if (c > 0) { res += doc.slice(i, i + c); i += c; }
      else i += -c;
    }
    return res + doc.slice(i);
  }

  // op 컴포넌트를 부분 소비 가능한 반복자.
  function iterator(op) {
    let idx = 0;
    let off = 0;
    return {
      hasNext() { return idx < op.length; },
      type() {
        const c = op[idx];
        if (typeof c === "string") return "insert";
        return c > 0 ? "retain" : "delete";
      },
      len() {
        const c = op[idx];
        if (typeof c === "string") return c.length - off;
        return Math.abs(c) - off;
      },
      // insert면 문자열 전체 반환(off 무시), retain/delete면 최대 n만큼 소비해 부호 있는 수 반환.
      take(n) {
        const c = op[idx];
        if (typeof c === "string") {
          const s = c.slice(off);
          idx++; off = 0;
          return s;
        }
        const total = Math.abs(c);
        const avail = total - off;
        const t = n == null ? avail : Math.min(n, avail);
        off += t;
        if (off >= total) { idx++; off = 0; }
        return c > 0 ? t : -t;
      },
    };
  }

  // op1을 op2 이후에 적용되도록 변환한다. side('left'|'right')는 삽입 위치가 겹칠 때 우선순위.
  // transform(a,b,'left') 와 transform(b,a,'right') 가 짝을 이뤄 수렴한다.
  function transform(op1, op2, side) {
    const res = [];
    const it1 = iterator(op1);
    const it2 = iterator(op2);
    while (it1.hasNext() || it2.hasNext()) {
      // op2의 삽입 → 그만큼 유지(단, left면서 op1도 삽입이면 op1 삽입을 먼저).
      if (it2.hasNext() && it2.type() === "insert") {
        if (side === "left" && it1.hasNext() && it1.type() === "insert") {
          appendComp(res, it1.take());
          continue;
        }
        const s = it2.take();
        appendComp(res, s.length);
        continue;
      }
      if (it1.hasNext() && it1.type() === "insert") {
        appendComp(res, it1.take());
        continue;
      }
      if (!it1.hasNext()) break;
      if (!it2.hasNext()) { appendComp(res, it1.take()); continue; }
      const n = Math.min(it1.len(), it2.len());
      const t1 = it1.type();
      const t2 = it2.type();
      it1.take(n);
      it2.take(n);
      if (t2 === "delete") {
        // op2가 이미 지운 구간 → op1의 retain/delete 모두 무시
      } else {
        appendComp(res, t1 === "retain" ? n : -n);
      }
    }
    return res;
  }

  // 두 텍스트의 차이를 하나의 op로. (공통 접두/접미 + 가운데 삭제/삽입)
  function fromDiff(oldStr, newStr) {
    if (oldStr === newStr) return [];
    let start = 0;
    const minLen = Math.min(oldStr.length, newStr.length);
    while (start < minLen && oldStr[start] === newStr[start]) start++;
    let endOld = oldStr.length;
    let endNew = newStr.length;
    while (endOld > start && endNew > start && oldStr[endOld - 1] === newStr[endNew - 1]) { endOld--; endNew--; }
    const op = [];
    appendComp(op, start);
    if (endOld > start) appendComp(op, -(endOld - start));
    if (endNew > start) appendComp(op, newStr.slice(start, endNew));
    return op;
  }

  // 커서 위치 pos를 op 이후 위치로 변환.
  function transformCursor(pos, op, side) {
    let idx = 0;
    let result = pos;
    for (const c of op) {
      if (typeof c === "string") {
        if (idx < pos || (idx === pos && side === "right")) result += c.length;
      } else if (c > 0) {
        idx += c;
      } else {
        const del = -c;
        if (pos > idx) result -= Math.min(del, pos - idx);
        idx += del;
      }
    }
    return result;
  }

  const OT = { apply, transform, fromDiff, transformCursor };
  if (typeof module !== "undefined" && module.exports) module.exports = OT;
  if (root) root.OTText = OT;
})(typeof window !== "undefined" ? window : null);
