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
 * ── 신청 받기 ON/OFF (매주 수요일 열고 금요일 밤 닫기) ───────
 * 교사용 페이지(signup_teacher.html)의 토글 버튼이 아래 두 액션을 씁니다.
 *   - action=status                : 현재 신청 받기 상태 조회
 *   - action=setStatus&open=1|0&pw= : 신청 받기/중단 전환 (비밀번호 필요)
 * 상태는 Script Properties 에 저장되며, 중단 상태에서는 신규
 * 신청 제출(submit)이 막힙니다. 매주 수요일에 '신청 받는 중'으로
 * 켜고, 금요일 밤 11:59 이후 '신청 중단'으로 끄면 됩니다.
 * ──────────────────────────────────────────────────────────
 */

var SHEET_ID = "여기에_새_스프레드시트_ID_붙여넣기";
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
      examDateLabel_(nowWeek, day) // 해당 주차의 실제 응시 날짜 (M월 D일)
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

// 제출시각을 수요일 시작 주(수~화) 단위 키("yyyy-MM-dd", Asia/Seoul)로 변환.
// 신청은 수~금, 응시는 같은 주 토·일 → 모두 같은 '수요일 주차'에 묶입니다.
function weekKey_(v) {
  var d = parseTs_(v);
  if (!d) return "";
  var ymd = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd").split("-");
  var y = +ymd[0], mo = +ymd[1], da = +ymd[2];
  var dow = new Date(Date.UTC(y, mo - 1, da, 12)).getUTCDay(); // 0=일 .. 6=토
  var since = (dow - 3 + 7) % 7;                               // 수요일(3)로부터 지난 날 수
  var wed = new Date(Date.UTC(y, mo - 1, da - since, 12));
  return Utilities.formatDate(wed, "Asia/Seoul", "yyyy-MM-dd");
}
function parseTs_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (!v) return null;
  var s = String(v).trim();
  var d = new Date(s.indexOf("T") > -1 ? s : s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

// 주차 키(그 주 수요일)와 요일로 실제 응시 날짜를 만든다.
// 토요일 = 수요일 + 3일, 일요일 = 수요일 + 4일
function examDate_(weekKey, day) {
  var p = String(weekKey || "").split("-");
  if (p.length !== 3) return null;
  var offset = (day === "토요일") ? 3 : (day === "일요일") ? 4 : 0;
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
      counts: dayCounts_(), open: isOpen_(), dates: dates, week: week
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
    var rows = values.map(function (r) {
      var o = {};
      headers.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
    return reply_(params.callback, { result: "success", rows: rows, open: isOpen_(), cap: DAY_CAP, days: DAYS });
  }

  return ContentService.createTextOutput("이수경국어 주말 모의고사 신청 엔드포인트가 작동 중입니다.");
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
  var ss = SpreadsheetApp.openById(SHEET_ID);
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
