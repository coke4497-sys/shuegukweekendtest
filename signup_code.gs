/**
 * 이수경국어 · 주말 실전 모의고사 신청 — Apps Script 백엔드
 *
 * ── 설치 순서 ──────────────────────────────────────────────
 * 1) 구글 스프레드시트를 "새로" 만들고(채점용 시트와 별개), 주소창의
 *    .../d/ 와 /edit 사이 긴 문자열(스프레드시트 ID)을 복사해
 *    아래 SHEET_ID 에 붙여넣으세요.
 * 2) 그 스프레드시트에서 [확장 프로그램] → [Apps Script] 를 열고
 *    이 코드 전체를 붙여넣고 저장하세요.
 * 3) [배포] → [새 배포] → 유형 '웹 앱' 선택
 *      - 실행 계정: 나
 *      - 액세스 권한: 모든 사용자
 *    배포 후 나오는 .../exec 주소를 복사해
 *    signup.html 과 signup_teacher.html 의 SCRIPT_URL/DATA_URL 에
 *    각각 붙여넣으세요.
 * 4) 항목을 바꾸면 [배포] → [배포 관리] 에서 기존 배포를 '수정'해
 *    새 버전으로 올리면 같은 주소가 유지됩니다.
 * ──────────────────────────────────────────────────────────
 *
 * ── 신청 받기 ON/OFF (매주 화요일 열고 금요일 밤 닫기) ───────
 * 교사용 페이지(signup_teacher.html)의 토글 버튼이 아래 두 액션을 씁니다.
 *   - action=status                : 현재 신청 받기 상태 조회
 *   - action=setStatus&open=1|0&pw= : 신청 받기/중단 전환 (비밀번호 필요)
 * 상태는 Script Properties 에 저장되며, 중단 상태에서는 신규
 * 신청 제출(submit)이 막힙니다. 매주 화요일에 '신청 받는 중'으로
 * 켜고, 금요일 밤 11:59 이후 '신청 중단'으로 끄면 됩니다.
 * ──────────────────────────────────────────────────────────
 *
 * ── 신청 삭제 (중복 신청 정리, 교사 전용) ─────────────────────
 * 교사용 페이지 표의 '삭제' 버튼이 사용합니다.
 *   - action=delete&row=&name=&ts=&pw=  : 한 행 삭제
 *   - action=deleteMany&items=&pw=      : 여러 행 일괄 삭제
 *     items = JSON 배열 [[행번호, 이름, 제출시각], ...]
 * 행 번호만 믿지 않고 이름·제출시각을 대조해, 목록을 연 뒤 시트가
 * 바뀌어 행이 밀렸으면 지우지 않고 건너뜁니다(stale — 새로고침 유도).
 * 일괄 삭제는 큰 행 번호부터 지워 행 밀림 없이 안전합니다.
 * ──────────────────────────────────────────────────────────
 */

var SHEET_ID = "1pB05VXT__-kJHoNpQxQSxbm4PhlB6XuJ7EvVG79pW14";
var SHEET_NAME = "신청";

// 교사용 페이지에서 데이터를 읽을 때 요구하는 비밀번호.
// 서버(Apps Script)에만 있고 공개 페이지에는 노출되지 않습니다. 꼭 바꿔주세요.
var TEACHER_PASSWORD = "sh";

var HEADERS = ["제출시각", "이름", "학교", "학년", "학생ID", "선택과목", "응시요일", "응시일자"];

// 응시 요일(요일마다 정원 제한). 같은 '신청 주차'의 토/일 각각 따로 셉니다.
var DAYS = ["토요일", "일요일"];

// 요일별 신청 정원 — 이 인원에 도달하면 해당 요일은 자동 마감됩니다.
var DAY_CAP = 37;

// 신청 받기 ON/OFF 상태를 저장하는 Script Properties 키
var OPEN_KEY = "weekendOpen";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    return json_(handleSubmit_(data));
  } catch (err) {
    return json_({ result: "error", message: String(err) });
  }
}

// 신청 받기 상태 (기본값: 열림). 한 번도 설정하지 않았으면 신청을 받습니다.
function isOpen_() {
  var v = PropertiesService.getScriptProperties().getProperty(OPEN_KEY);
  return v === null || v === "1";
}
function setOpen_(open) {
  PropertiesService.getScriptProperties().setProperty(OPEN_KEY, open ? "1" : "0");
}

// ── 신청 가능 학년 (기본: 고3만, 주차에 따라 고1·고2 추가) ──────────
var GRADES_KEY = "weekendGrades";
var ALL_GRADES = ["1", "2", "3"];   // 1=고1, 2=고2, 3=고3
var DEFAULT_GRADES = ["3"];          // 기본값: 고3만
function getActiveGrades_() {
  var v = PropertiesService.getScriptProperties().getProperty(GRADES_KEY);
  if (!v) return DEFAULT_GRADES.slice();
  try {
    var arr = JSON.parse(v);
    var filtered = ALL_GRADES.filter(function (g) { return arr.indexOf(g) > -1; });
    return filtered.length ? filtered : DEFAULT_GRADES.slice();
  } catch (e) { return DEFAULT_GRADES.slice(); }
}
function setActiveGrades_(arr) {
  var clean = ALL_GRADES.filter(function (g) { return (arr || []).indexOf(g) > -1; });
  if (!clean.length) clean = DEFAULT_GRADES.slice();
  PropertiesService.getScriptProperties().setProperty(GRADES_KEY, JSON.stringify(clean));
  return clean;
}

// 학생 식별 키 (이름 + 학교 + 학생ID)
function studentKey_(name, school, id) {
  return (name || "") + "|" + (school || "") + "|" + (id || "");
}

// 신청 처리 (정원 확인 후 기록). doPost·doGet 양쪽에서 사용.
function handleSubmit_(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // 신청이 중단된 상태면 제출을 막습니다.
    if (!isOpen_()) {
      return { result: "closed" };
    }

    var day = data.day || "";
    if (DAYS.indexOf(day) === -1) {
      return { result: "error", message: "invalid_day" };
    }
    // 신청 가능 학년 확인 (닫힌 학년이면 거부)
    if (getActiveGrades_().indexOf(String(data.grade || "")) === -1) {
      return { result: "grade_closed" };
    }

    var sheet = getSheet_();
    var nowDate = new Date();
    var nowWeek = weekKey_(nowDate);

    // 정원 확인 (같은 '주차 + 요일'의 학생 수 기준)
    var info = dayInfo_(sheet, day, nowWeek);
    var meKey = studentKey_(data.name, data.school, data.id);
    if (!info.students[meKey] && info.count >= DAY_CAP) {
      return { result: "full", day: day, cap: DAY_CAP };
    }

    var now = Utilities.formatDate(nowDate, "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var row = [
      now,
      data.name || "",
      data.school || "",
      data.grade || "",
      "'" + (data.id || ""),     // 앞자리 0 보존을 위해 텍스트로 저장
      data.subject || "",
      day,
      "'" + examDateLabel_(nowWeek, day) // 'M월 D일' — 시트가 날짜+시간으로 자동 변환하지 않게 텍스트로 저장
    ];

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row]);
    return { result: "success" };
  } catch (err) {
    return { result: "error", message: String(err) };
  } finally {
    lock.releaseLock();
  }
}

// 특정 '주차 + 요일'에 이미 신청한 학생 집합과 인원 수
function dayInfo_(sheet, day, week) {
  var values = sheet.getDataRange().getValues();
  var headers = values.shift() || [];
  var iDay = headers.indexOf("응시요일"),
      iN = headers.indexOf("이름"),
      iS = headers.indexOf("학교"),
      iId = headers.indexOf("학생ID"),
      iT = headers.indexOf("제출시각");
  var students = {};
  values.forEach(function (r) {
    if (String(r[iDay]) === day && weekKey_(r[iT]) === week) {
      students[studentKey_(r[iN], r[iS], r[iId])] = true;
    }
  });
  return { students: students, count: Object.keys(students).length };
}

// 이번 주차의 요일별 학생 수 (폼에서 마감 표시용)
function dayCounts_() {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  var headers = values.shift() || [];
  var iDay = headers.indexOf("응시요일"),
      iN = headers.indexOf("이름"),
      iS = headers.indexOf("학교"),
      iId = headers.indexOf("학생ID"),
      iT = headers.indexOf("제출시각");
  var week = weekKey_(new Date());
  var perDay = {};
  values.forEach(function (r) {
    var day = String(r[iDay] || ""); if (DAYS.indexOf(day) === -1) return;
    if (weekKey_(r[iT]) !== week) return;
    (perDay[day] = perDay[day] || {})[studentKey_(r[iN], r[iS], r[iId])] = true;
  });
  var counts = {};
  DAYS.forEach(function (d) { counts[d] = perDay[d] ? Object.keys(perDay[d]).length : 0; });
  return counts;
}

// 제출시각을 화요일 시작 주(화~월) 단위 키("yyyy-MM-dd", Asia/Seoul)로 변환.
// 신청은 화~금, 응시는 같은 주 토·일 → 모두 같은 '화요일 주차'에 묶입니다.
// (2026-07: 수요일 시작 → 화요일 시작으로 변경. 기존 수~금 신청 기록의 주말 배정은 동일하게 유지됨)
function weekKey_(v) {
  var d = parseTs_(v);
  if (!d) return "";
  var ymd = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd").split("-");
  var y = +ymd[0], mo = +ymd[1], da = +ymd[2];
  var dow = new Date(Date.UTC(y, mo - 1, da, 12)).getUTCDay(); // 0=일 .. 6=토
  var since = (dow - 2 + 7) % 7;                               // 화요일(2)로부터 지난 날 수
  var tue = new Date(Date.UTC(y, mo - 1, da - since, 12));
  return Utilities.formatDate(tue, "Asia/Seoul", "yyyy-MM-dd");
}
function parseTs_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (!v) return null;
  var s = String(v).trim();
  var d = new Date(s.indexOf("T") > -1 ? s : s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

// 주차 키(그 주 화요일)와 요일로 실제 응시 날짜를 만든다.
// 토요일 = 화요일 + 4일, 일요일 = 화요일 + 5일
function examDate_(weekKey, day) {
  var p = String(weekKey || "").split("-");
  if (p.length !== 3) return null;
  var offset = (day === "토요일") ? 4 : (day === "일요일") ? 5 : 0;
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + offset, 12));
}
function examDateLabel_(weekKey, day) {
  var d = examDate_(weekKey, day);
  if (!d) return "";
  return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일";
}
function examDateISO_(weekKey, day) {
  var d = examDate_(weekKey, day);
  if (!d) return "";
  return Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd");
}

function doGet(e) {
  var params = (e && e.parameter) || {};

  // 폼: 이번 주차의 요일별 마감 여부 + 실제 응시 날짜 조회 (개인정보 없음)
  if (params.action === "days") {
    var week = weekKey_(new Date());
    var dates = {};
    DAYS.forEach(function (d) { dates[d] = { label: examDateLabel_(week, d), iso: examDateISO_(week, d) }; });
    return reply_(params.callback, {
      result: "success", cap: DAY_CAP, days: DAYS,
      counts: dayCounts_(), open: isOpen_(), dates: dates, week: week,
      grades: getActiveGrades_()
    });
  }

  // 신청 받기 상태 조회
  if (params.action === "status") {
    return reply_(params.callback, { result: "success", open: isOpen_() });
  }

  // 신청 받기/중단 전환 (교사 전용)
  if (params.action === "setStatus") {
    if (params.pw !== TEACHER_PASSWORD) {
      return reply_(params.callback, { result: "error", message: "unauthorized" });
    }
    var open = (params.open === "1" || params.open === "true");
    setOpen_(open);
    return reply_(params.callback, { result: "success", open: open });
  }

  // 신청 가능 학년 설정 (교사 전용)
  if (params.action === "setGrades") {
    if (params.pw !== TEACHER_PASSWORD) {
      return reply_(params.callback, { result: "error", message: "unauthorized" });
    }
    var gsel = [];
    try { gsel = params.grades ? JSON.parse(params.grades) : []; } catch (e) { gsel = []; }
    return reply_(params.callback, { result: "success", grades: setActiveGrades_(gsel) });
  }

  // 학생 개별 페이지: 이 학생의 '이번 주' 신청 내역 (본인 것만 반환)
  // ?action=mySignups&name=&school=&id=&callback=
  if (params.action === "mySignups") {
    return reply_(params.callback, mySignups_(params));
  }

  // 폼: 신청 처리 (응답을 읽어 마감 여부를 알려주기 위해 GET/JSONP 사용)
  if (params.action === "submit") {
    var data = {
      name: params.name, school: params.school, grade: params.grade,
      id: params.id, subject: params.subject, day: params.day
    };
    return reply_(params.callback, handleSubmit_(data));
  }

  // 교사용 페이지의 데이터 요청
  if (params.action === "data") {
    if (params.pw !== TEACHER_PASSWORD) {
      return reply_(params.callback, { result: "error", message: "unauthorized" });
    }
    var sheet = getSheet_();
    var values = sheet.getDataRange().getValues();
    var headers = values.shift() || [];
    var rows = values.map(function (r, idx) {
      var o = { _row: idx + 2 };   // 시트의 실제 행 번호 (1행은 헤더) — 삭제 버튼용
      headers.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
    return reply_(params.callback, { result: "success", rows: rows, open: isOpen_(), cap: DAY_CAP, days: DAYS, grades: getActiveGrades_() });
  }

  // 신청 삭제 (교사 전용) — 중복 신청 정리용
  if (params.action === "delete") {
    if (params.pw !== TEACHER_PASSWORD) {
      return reply_(params.callback, { result: "error", message: "unauthorized" });
    }
    return reply_(params.callback, deleteSignup_(params));
  }

  // 신청 일괄 삭제 (교사 전용) — 여러 건 선택 삭제
  if (params.action === "deleteMany") {
    if (params.pw !== TEACHER_PASSWORD) {
      return reply_(params.callback, { result: "error", message: "unauthorized" });
    }
    return reply_(params.callback, deleteManySignups_(params));
  }

  return ContentService.createTextOutput("이수경국어 주말 모의고사 신청 엔드포인트가 작동 중입니다.");
}

// 행 번호 + 이름·제출시각 대조 후 삭제. 목록을 연 뒤 다른 곳에서 시트가
// 바뀌어 행이 밀렸으면 지우지 않고 stale 을 돌려준다(페이지가 새로고침 안내).
function deleteSignup_(params) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var row = parseInt(params.row, 10);
    if (!row || row < 2 || row > sheet.getLastRow()) {
      return { result: "error", message: "stale" };
    }
    var values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    var name = String(values[HEADERS.indexOf("이름")] || "").trim();
    var ts = normTs_(values[HEADERS.indexOf("제출시각")]);
    if (!name || name !== String(params.name || "").trim() || !ts || ts !== normTs_(params.ts)) {
      return { result: "error", message: "stale" };
    }
    sheet.deleteRow(row);
    return { result: "success" };
  } catch (err) {
    return { result: "error", message: String(err) };
  } finally {
    lock.releaseLock();
  }
}
// 여러 행 일괄 삭제. items = [[행번호, 이름, 제출시각], ...]
// 큰 행 번호부터 지워야 앞선 삭제로 아래 행이 밀려도 안전하다.
// 대조에 실패한 행은 지우지 않고 stale 로 센다.
function deleteManySignups_(params) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var items;
    try { items = JSON.parse(params.items || "[]"); } catch (e) { items = []; }
    if (!items.length) return { result: "error", message: "empty" };
    var sheet = getSheet_();
    items.sort(function (a, b) { return (+b[0]) - (+a[0]); });
    var deleted = 0, stale = 0;
    items.forEach(function (it) {
      var row = parseInt(it[0], 10);
      var name = String(it[1] || "").trim();
      var ts = normTs_(it[2]);
      if (!row || row < 2 || row > sheet.getLastRow()) { stale++; return; }
      var v = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
      var rn = String(v[HEADERS.indexOf("이름")] || "").trim();
      var rts = normTs_(v[HEADERS.indexOf("제출시각")]);
      if (!rn || rn !== name || !ts || rts !== ts) { stale++; return; }
      sheet.deleteRow(row);
      deleted++;
    });
    return { result: "success", deleted: deleted, stale: stale };
  } catch (err) {
    return { result: "error", message: String(err) };
  } finally {
    lock.releaseLock();
  }
}

// 제출시각을 비교용 문자열로 정규화 (셀의 Date 값·문자열, ISO 문자열 모두 흡수)
function normTs_(v) {
  var d = parseTs_(v);
  return d ? Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd HH:mm") : "";
}

// 한 학생의 이번 주 신청 내역. 이름+학교(느슨 비교) 1차, 학생ID는 동명이인 구분 보조
// (모의고사 성적 조회와 동일 규칙 — 쌍둥이는 이름으로, 동명이인은 ID로 분리).
// uniq=1 이면(명단에 그 이름이 1명뿐 — 학생 페이지가 판단해 전달) 학생ID 대조를 생략:
// 신청서에 8자리를 잘못 적어도 이름+학교로 매칭된다.
function mySignups_(params) {
  var name = String(params.name || "").trim();
  var school = String(params.school || "").trim();
  var sid = String(params.id || "").trim();
  var uniq = String(params.uniq || "") === "1";
  if (!name) return { result: "success", signups: [] };
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  var headers = values.shift() || [];
  var iN = headers.indexOf("이름"), iS = headers.indexOf("학교"), iId = headers.indexOf("학생ID"),
      iDay = headers.indexOf("응시요일"), iT = headers.indexOf("제출시각");
  var week = weekKey_(new Date());
  var seen = {}, out = [];
  values.forEach(function (r) {
    if (String(r[iN] || "").trim() !== name) return;
    var rs = String(r[iS] || "").trim();
    if (school && rs && !schoolMatch_(rs, school)) return;
    var rid = String(r[iId] || "").replace(/^'/, "").trim();
    if (!uniq && rid && sid && rid !== sid) return; // 동명이인 구분(이름이 유일하면 생략)
    if (weekKey_(r[iT]) !== week) return;           // 이번 주만
    var day = String(r[iDay] || "").trim();
    if (DAYS.indexOf(day) === -1 || seen[day]) return;
    seen[day] = true;                                // 같은 요일 중복 신청은 1건으로
    out.push({ day: day, date: examDateLabel_(week, day) });
  });
  return { result: "success", week: week, signups: out };
}

// 학교 이름 느슨 비교 (리포트·OMR 백엔드와 동일 규칙)
function schoolMatch_(a, b) {
  a = String(a || "").replace(/\s+/g, "");
  b = String(b || "").replace(/\s+/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  var na = a.replace(/(등학교|고등학교|중학교|학교|고|중)$/, "");
  var nb = b.replace(/(등학교|고등학교|중학교|학교|고|중)$/, "");
  if (na && nb && na === nb) return true;
  return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

// callback 이 있으면 JSONP(자바스크립트), 없으면 일반 JSON 으로 응답
function reply_(callback, obj) {
  var body = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + body + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  // SHEET_ID 가 실제 ID로 채워져 있으면 그 시트를, 아니면(기본) 이 스크립트가
  // 붙어 있는 시트를 사용한다. → placeholder 그대로 둬도 동작(복붙 안전).
  var hasId = (typeof SHEET_ID === "string" && SHEET_ID.length > 20 && SHEET_ID.indexOf("여기에") === -1);
  var ss = hasId ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
