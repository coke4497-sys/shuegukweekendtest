/**
 * 이수경국어 · 모의고사 OMR 채점 시스템
 * Google Apps Script (스프레드시트에 연결)
 *
 * [시트 구성]
 *  - 회차정답 : A열 회차이름, B열 회차데이터(JSON). 1행부터 데이터.
 *  - 응답     : 비워두면 코드가 헤더부터 자동 생성.
 *
 * ★ v2 변경점 (학생 개별 페이지 '모의고사 성적' 연동) — 기존 동작은 그대로:
 *   (1) 응답 시트 맨 끝에 '학생ID'(부모님 8자리, 010 제외) 열을 추가해 저장.
 *       → omr_student.html 의 제출 payload 에 studentId 를 담아 보내면 기록됩니다.
 *       (옛 응답은 빈칸이어도 이름+학교로 보조 매칭되므로 그대로 조회됩니다.)
 *
 * ★ v3 변경점 (매칭 규칙 교정):
 *   studentReports 매칭을 이름+학교 1차(학교는 느슨 비교)로 바꿈.
 *   학생ID(부모님 8자리)는 **동명이인(같은 이름·학교) 구분용 보조**로만 사용.
 *   — 쌍둥이 형제는 부모님 번호가 같아서 ID를 1차 키로 쓰면 형제 성적이 섞이기 때문.
 *   (2) doGet 에 외부 페이지용 JSON/JSONP API 추가:
 *       .../exec?action=studentReports&id=<8자리>&name=<이름>&school=<학교>&callback=<함수>
 *       → 그 학생의 성적표만 반환(전체 미반환 = 개인정보 보호).
 *       s.html(다른 도메인)에서 JSONP 로 호출합니다.
 *
 * [업데이트] 이 코드로 교체 → 저장 → 배포 → 배포 관리 → 기존 배포 편집 → 새 버전 → 배포 (같은 URL 유지)
 */

// ───────── 스프레드시트 직접 지정 (웹앱에서도 정확히 같은 시트를 읽기 위함) ─────────
const SS_ID = '1hd1huZpppBue5rlBVMZc2-wAbZ91PitFiBGT12Cq7YQ';
function SS(){ return SpreadsheetApp.openById(SS_ID); }

// ───────── 웹페이지 제공 (학생용 / 선생님용 분기) + 외부 JSON API ─────────
// 기본 URL → 학생 OMR
// URL 뒤에 ?page=teacher → 선생님용 성적 관리 화면
// URL 뒤에 ?action=... → JSON/JSONP API (학생 개별 페이지 등 외부 페이지용)
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  if (p.action) return apiResponse_(p);   // ★ 외부 페이지용 데이터 API

  const page = p.page || 'student';
  const file = (page === 'teacher') ? 'teacher' : 'omr_student';
  const title = (page === 'teacher') ? '이수경국어 · 성적 관리' : '이수경국어 OMR';
  return HtmlService.createHtmlOutputFromFile(file)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);  // ← iframe 허용(파란 띠 제거용)
}

// ───────── 출제 저장 (answer_key.html '시트에 바로 저장' 버튼) ─────────
// payload: { action:'saveExam', pw, name(회차 이름), json(회차 데이터 문자열) }
// '회차정답' 탭에 A:이름 B:JSON 으로 기록. 같은 이름이 있으면 덮어쓰기(수정).
function doPost(e) {
  let out;
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'saveExam') out = saveExam_(data);
    else out = { result: 'error', message: 'unknown action' };
  } catch (err) {
    out = { result: 'error', message: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function saveExam_(data) {
  if (String(data.pw || '') !== 'sh') return { result: 'error', message: 'unauthorized' };
  const name = String(data.name || '').trim();
  const jsonStr = String(data.json || '').trim();
  if (!name) return { result: 'error', message: '회차 이름이 비어 있습니다.' };
  JSON.parse(jsonStr);   // 형식 검증 — 깨진 데이터가 저장되는 것 방지
  let sh = SS().getSheetByName('회차정답');
  if (!sh) sh = SS().insertSheet('회차정답');
  const rows = sh.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) {
      sh.getRange(i + 1, 2).setValue(jsonStr);
      return { result: 'success', updated: true };
    }
  }
  sh.appendRow([name, jsonStr]);
  return { result: 'success', updated: false };
}

// ───────── 외부 페이지용 JSON/JSONP API ─────────
// callback 이 있으면 JSONP(자바스크립트), 없으면 일반 JSON 으로 응답.
function apiResponse_(p) {
  let out;
  try {
    if (p.action === 'studentReports') {
      out = { result: 'success', reports: studentReports_(p.id, p.name, p.school, p.uniq) };
    } else if (p.action === 'responses') {
      // 제출 기록 목록(관리용, omr_admin.html) — 비밀번호 필요
      if (String(p.pw || '') !== 'sh') out = { result: 'error', message: 'unauthorized' };
      else out = { result: 'success', rows: responsesList_() };
    } else if (p.action === 'deleteResponse') {
      // 제출 기록 한 건 삭제(중복 제출 정리) — 비밀번호 필요
      if (String(p.pw || '') !== 'sh') out = { result: 'error', message: 'unauthorized' };
      else out = deleteResponse_(p);
    } else {
      out = { result: 'error', message: 'unknown action: ' + p.action };
    }
  } catch (err) {
    out = { result: 'error', message: String(err) };
  }
  const body = JSON.stringify(out);
  if (p.callback) {
    return ContentService.createTextOutput(p.callback + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// 한 학생의 주말 모의고사 성적표 목록(최신순)을 만든다.
//  - 1차: 이름+학교 일치(학교는 느슨 비교 — '행신고'='행신고등학교').
//  - 2차: 동명이인(같은 이름·학교) 구분 — 행·요청 양쪽에 학생ID가 있을 때만 대조.
//    ※ 쌍둥이는 학생ID(부모님 번호)가 같으므로 ID를 1차 키로 쓰지 않는다. 이름이 달라 1차에서 분리됨.
//  - uniq=1 이면(명단에 그 이름이 1명뿐 — 학생 페이지가 판단해 전달) ID 대조 생략:
//    OMR 제출 시 8자리를 잘못 적어도 이름+학교로 매칭된다.
function studentReports_(id, name, school, uniqFlag) {
  id = String(id || '').trim();
  name = String(name || '').trim();
  school = String(school || '').trim();
  const uniq = String(uniqFlag || '') === '1';
  if (!name) return [];

  const sh = SS().getSheetByName('응답');
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idIdx = headers.indexOf('학생ID');   // 없으면 -1

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const rid = idIdx >= 0 ? String(r[idIdx] || '').trim() : '';
    const rname = String(r[3] || '').trim();
    const rschool = String(r[4] || '').trim();
    const nameOk = rname === name;
    const schoolOk = !school || !rschool || schoolMatch_(rschool, school);
    const idOk = uniq || !rid || !id || rid === id;   // 동명이인 구분(이름이 유일하면 생략)
    if (!(nameOk && schoolOk && idOk)) continue;

    const answers = {};
    for (let q = 1; q <= 45; q++) answers[q] = r[9 + q];   // 점수/총점/등급(7~9) 다음이 1번(10)
    const payload = {
      examName: '' + r[1], examDate: fmtExamDate_(r[2]), name: rname,
      school: rschool, grade: '' + r[5], subject: '' + r[6], answers: answers
    };
    let rep;
    try { rep = scoreAndBuild(payload); } catch (e) { continue; }   // 정답 못 찾는 옛 회차는 건너뜀
    out.push({
      examName:  payload.examName,
      examDate:  payload.examDate,
      subject:   payload.subject,
      school:    payload.school,
      grade:     payload.grade,                 // 학년
      got:       rep.result.got,                // 점수
      level:     rep.result.grade,              // 등급
      cuts:      rep.exam.cuts,                 // 등급컷
      areas:     rep.result.areas,              // 영역별 성취도
      total:     rep.result.total,              // 총점(배점 합)
      detail:    rep.result.detail,             // 문항 채점표 (정답·학생답안·배점·정오)
      submittedAt: '' + r[0]
    });
  }
  out.sort(function(a, b){ return a.submittedAt < b.submittedAt ? 1 : (a.submittedAt > b.submittedAt ? -1 : 0); });
  return out;
}

// 학교 이름 느슨 비교 (리포트 백엔드 schoolMatch_와 동일 규칙)
function schoolMatch_(a, b) {
  a = String(a || '').replace(/\s+/g, '');
  b = String(b || '').replace(/\s+/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  // '고등학교'·'고' 접미어 차이를 흡수해 비교
  var na = a.replace(/(등학교|고등학교|중학교|학교|고|중)$/,'');
  var nb = b.replace(/(등학교|고등학교|중학교|학교|고|중)$/,'');
  if (na && nb && na === nb) return true;
  return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

// 응시일 표시 정리 — 시트가 '6월 3일'을 날짜 값으로 자동 변환한 옛 기록도 'M월 D일'로 되돌린다.
function fmtExamDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'M월 d일');
  }
  return String(v == null ? '' : v);
}

// ───────── 제출 기록 정리 (omr_admin.html — 중복 제출 삭제용) ─────────
// 응답 시트 전체를 가벼운 형태로 반환 (답안 45문항은 제외 — 목록·중복 판별에 불필요)
function responsesList_() {
  const sh = SS().getSheetByName('응답');
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    if (!r[3]) continue;   // 이름 없는 행 제외
    out.push({
      row: i + 1,                        // 시트 실제 행 번호 (삭제용)
      ts: normRespTs_(r[0]),             // 제출시각 (삭제 대조 키)
      exam: '' + r[1], name: '' + r[3], school: '' + r[4],
      grade: '' + r[5], subject: '' + r[6], got: '' + r[7], level: '' + r[9]
    });
  }
  return out;
}

// 행 번호 + 이름·제출시각 대조 후 삭제 (신청 현황 삭제와 동일한 안전장치 —
// 목록을 연 뒤 시트가 바뀌어 행이 밀렸으면 지우지 않고 stale 반환)
function deleteResponse_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SS().getSheetByName('응답');
    const row = parseInt(p.row, 10);
    if (!sh || !row || row < 2 || row > sh.getLastRow()) {
      return { result: 'error', message: 'stale' };
    }
    const r = sh.getRange(row, 1, 1, 4).getValues()[0];
    const name = String(r[3] || '').trim();
    const ts = normRespTs_(r[0]);
    if (!name || name !== String(p.name || '').trim() || !ts || ts !== String(p.ts || '').trim()) {
      return { result: 'error', message: 'stale' };
    }
    sh.deleteRow(row);
    return { result: 'success' };
  } catch (err) {
    return { result: 'error', message: String(err) };
  } finally {
    lock.releaseLock();
  }
}

// 제출시각을 대조용 문자열로 정규화 (초 단위까지 — 중복 제출도 구분)
function normRespTs_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v == null ? '' : v).trim();
}

// ───────── 열려 있는 회차 목록 (학생 화면 드롭다운용) ─────────
function getExamList() {
  const sh = SS().getSheetByName('회차정답');
  const rows = sh.getDataRange().getValues();
  return rows.filter(r => r[0]).map(r => String(r[0]));  // 회차 이름들
}

// ───────── 특정 회차 데이터 읽기 ─────────
function loadExamData(examName) {
  const sh = SS().getSheetByName('회차정답');
  const rows = sh.getDataRange().getValues();
  for (const r of rows) {
    if (String(r[0]) === String(examName)) {
      return JSON.parse(r[1]);   // { 화법과작문:{...}, 언어와매체:{...} }
    }
  }
  throw new Error('회차를 찾을 수 없습니다: ' + examName);
}

// ───────── 학생 제출 → 채점 → 저장 → 성적표 데이터 반환 ─────────
// 결과를 JSON 문자열로 반환 (웹앱 전송 안전). 화면에서 JSON.parse로 푼다.
function submitOMR(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const report = scoreAndBuild(payload);
    saveResponse(payload, report.result.got, report.result.total, report.result.grade);
    return JSON.stringify(report);
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ───────── 응답 시트에 한 줄 기록 ─────────
function saveResponse(payload, got, total, grade) {
  const ss = SS();
  let sh = ss.getSheetByName('응답');
  if (!sh) sh = ss.insertSheet('응답');
  if (sh.getLastRow() === 0) {
    const header = ['제출시각', '회차', '응시일', '이름', '학교', '학년', '선택과목', '점수', '총점', '등급'];
    for (let q = 1; q <= 45; q++) header.push(q + '번');
    header.push('학생ID');                       // ★ 맨 끝에 학생ID 열
    sh.appendRow(header);
  }
  ensureStudentIdHeader_(sh);                     // ★ 기존 시트 호환: 없으면 학생ID 헤더 추가
  const idCol = studentIdCol_(sh);                // 1-base 위치

  const row = [
    new Date(), payload.examName,
    "'" + String(payload.examDate || ''),   // '6월 3일' — 시트가 날짜+시간으로 자동 변환하지 않게 텍스트로 저장
    payload.name,
    payload.school, payload.grade, payload.subject, got, total, grade
  ];
  for (let q = 1; q <= 45; q++) row.push(payload.answers[q] || '');
  while (row.length < idCol - 1) row.push('');    // 학생ID 위치까지 패딩
  row.push(String(payload.studentId || ''));      // ★ 학생ID(부모님 8자리) 저장
  sh.appendRow(row);
}

// '응답' 시트에 '학생ID' 헤더가 없으면 맨 끝 열에 추가
function ensureStudentIdHeader_(sh) {
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('학생ID') === -1) sh.getRange(1, lastCol + 1).setValue('학생ID');
}
// '학생ID' 열의 위치(1-base). 없으면 맨 끝 다음 열.
function studentIdCol_(sh) {
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const i = headers.indexOf('학생ID');
  return i === -1 ? lastCol + 1 : i + 1;
}

// ───────── 교사용: 저장된 응답 목록 불러오기 ─────────
// 모든 값을 문자열로 변환하고 {ok, list} 형태로 반환 (웹앱 전송 안전)
function getResponses() {
  try {
    const sh = SS().getSheetByName('응답');
    if (!sh || sh.getLastRow() < 2) return { ok: true, list: [] };
    const values = sh.getDataRange().getValues();
    const list = [];
    for (let i = 1; i < values.length; i++) {       // 0행은 헤더
      const r = values[i];
      list.push({
        row: i + 1,
        submittedAt: '' + r[0],
        examName: '' + r[1],
        examDate: '' + r[2],
        name: '' + r[3],
        school: '' + r[4],
        grade: '' + r[5],
        subject: '' + r[6],
        got: '' + r[7],
        total: '' + r[8],
        gradeLevel: '' + r[9]
      });
    }
    list.reverse();
    return { ok: true, list: list };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ───────── 교사용: 저장된 한 명의 성적표 다시 만들기 ─────────
// 결과를 JSON 문자열로 반환 (웹앱 전송 안전). 화면에서 JSON.parse로 푼다.
function getReportByRow(rowNum) {
  try {
    const sh = SS().getSheetByName('응답');
    const values = sh.getDataRange().getValues();
    const r = values[rowNum - 1];
    if (!r) return JSON.stringify({ ok: false, error: '해당 행을 찾을 수 없습니다: ' + rowNum });

    const answers = {};
    for (let q = 1; q <= 45; q++) answers[q] = r[9 + q];

    const payload = {
      examName: '' + r[1], examDate: fmtExamDate_(r[2]), name: '' + r[3],
      school: '' + r[4], grade: '' + r[5], subject: '' + r[6], answers: answers
    };
    const report = scoreAndBuild(payload);
    return JSON.stringify(report);
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  }
}

// ───────── 공통 채점 함수 (제출 즉시 / 나중에 둘 다 사용) ─────────
function scoreAndBuild(payload) {
  const examPack = loadExamData(payload.examName);
  const subjectKey = payload.subject === '화법과작문' ? '화법과작문' : '언어와매체';
  const exam = examPack[subjectKey];
  if (!exam) throw new Error('선택과목 정답이 없습니다: ' + subjectKey);

  const detail = {};
  let total = 0, got = 0;
  for (let q = 1; q <= 45; q++) {
    const ok = String(payload.answers[q]) === String(exam.answers[q]);
    const pt = Number(exam.points[q]) || 0;
    detail[q] = { ans: exam.answers[q], mine: payload.answers[q] || '', pt: pt, ok: ok };
    total += pt;
    if (ok) got += pt;
  }
  const areas = exam.areas.map(function (a) {
    let f = 0, s = 0;
    a.qs.forEach(function (q) { f += Number(exam.points[q]); if (detail[q].ok) s += Number(exam.points[q]); });
    return { cat: a.cat, name: a.name, full: f, score: s, rate: Math.round(s / f * 100) };
  });
  let grade = '등급외';
  const c = exam.cuts;
  if (got >= c[0]) grade = '1';
  else if (got >= c[1]) grade = '2';
  else if (got >= c[2]) grade = '3';
  else if (got >= c[3]) grade = '4';

  return {
    ok: true,
    student: { name: payload.name, school: payload.school, grade: payload.grade,
               subject: payload.subject, examDate: payload.examDate },
    exam: { code: exam.code, date: exam.date, subject: exam.subject, cuts: exam.cuts },
    result: { total: total, got: got, grade: grade, areas: areas, detail: detail }
  };
}
