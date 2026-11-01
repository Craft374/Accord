// 테이블 방의 PDF 렌더러. pdf.js 를 묶어 window.pdfjsLib 로 노출한다(public/app.js 가 필요할 때만 불러온다).
// 구형 Electron(Chromium 126)에서도 돌도록 legacy 빌드를 쓴다.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

window.pdfjsLib = pdfjsLib;
