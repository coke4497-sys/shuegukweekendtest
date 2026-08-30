# 작업 메모 (이수경국어 · 슈국)

## 🚀 Apps Script(.gs) 재배포 방법 — 클로드(Claude)용 메모

이 계정(coke4497)의 Apps Script 백엔드는 **clasp**(구글 공식 CLI)로 명령줄에서 재배포할 수 있다.
사용자가 편집기에 복붙 후 수동 재배포할 필요 없이, 클로드가 `.gs`를 고치고 배포까지 한다.

**사용자는 비기술자다.** 지시는 아주 짧고 쉽게(“링크 클릭 → 허용 → 주소 붙여넣기” 수준)만 요청할 것.
사용자가 “앱스스크립트 배포해줘”라고 하면 아래 절차를 클로드가 알아서 수행한다.

### 전제
- 환경의 **네트워크 액세스 = 신뢰됨**이어야 googleapis 접속 가능(현재 OK).
- 이 환경엔 안전한 비밀 저장소가 없다(환경변수 칸은 공개됨). **토큰을 저장소/환경변수에 절대 넣지 말 것.** → 세션마다 아래 로그인 1회.

### 1) 설치
```bash
npm i -g @google/clasp   # 이미 있으면 생략
```

### 2) 로그인 (브라우저 필요 — 사용자 1분)
```bash
rm -f /tmp/co /tmp/cf; mkfifo /tmp/cf
( sleep 1800 > /tmp/cf ) &                                   # fifo write-end 유지
setsid bash -c 'clasp login --no-localhost < /tmp/cf > /tmp/co 2>&1' &
sleep 9; cat /tmp/co                                         # accounts.google.com URL 출력
```
- 출력된 **`https://accounts.google.com/...` URL**을 사용자에게 전달 → 사용자: **coke4497 계정으로** 열기 → 모두 **허용** → 리다이렉트된 **`http://localhost:8888/?...code=...` 주소 전체**를 복사해 전달.
- 받은 URL을 fifo로 전달해 완료:
```bash
printf '%s\n' '<사용자가-준-localhost-주소-전체>' > /tmp/cf
sleep 4; cat /tmp/co            # "Authorization successful" / ~/.clasprc.json 생성 확인
```
- 확인: `~/.clasprc.json`에 `tokens.default.refresh_token` 있으면 성공.

### 3) 배포 (프로젝트별)
```bash
mkdir -p /tmp/proj && cd /tmp/proj
printf '{"scriptId":"<SCRIPT_ID>"}' > .clasp.json
clasp pull -f                        # 현재 코드+appsscript.json 내려받기
cp <저장소의-최신-.gs> ./Code.gs     # pull 로 받은 코드 파일명에 맞춰 교체
clasp push -f
clasp deployments                    # 배포 목록 확인
clasp deploy -i <DEPLOYMENT_ID>      # 기존 배포 새 버전(= exec 주소 그대로 유지)
```
- **DEPLOYMENT_ID** = 웹앱 주소 `/macros/s/`**`<이 부분>`**`/exec` 문자열(아래 표).
- **SCRIPT_ID**는 아직 미확보 → 처음 한 번 사용자에게 요청: “Apps Script 편집기 → ⚙️프로젝트 설정 → **스크립트 ID** 복사해서 알려주세요.” 알게 되면 아래 표에 채워 넣고 커밋해 둘 것.

### 프로젝트별 정보
| 프로젝트 | 저장소의 코드 파일 | DEPLOYMENT_ID (exec의 AKfycb… 부분) | SCRIPT_ID |
|---|---|---|---|
| OMR 채점 | `shuegukweekendtest/omr_code.gs` | `AKfycbyUHMdCH_u35Oeu6lEmx3yOYscoKLwEB8TC0QHGBOaCXZ4rbAnkMpP9_Na4l3QLOajGPA` | `1xfBA8bK-eBdosawcefdMOGm3dS3EC4oztM3q2rCQP_S3G41iXs54nEeG` |
| 주말 신청 | `shuegukweekendtest/signup_code.gs` | `AKfycbzdqac0xTnCaOo_t_2swJQqdfxjiA14sTo-ThTV8VvwcwaTucM1MQGeJfMfV4lNLM75` | `16G_RAaxC_g3LR5LwEjTgbqrKCaRS-FXa1FFWryVSRhyLEaOaHoz9Uzgp` |
| 리포트/공지 | `shueguk-report/backend-createReport.gs` | `AKfycbzhCncBwn-JlqXARC3wfrWUCuNHzlNK2df0bdhx-w78Xr8mzYUcIYZOJdRi9N4bHtsb` | `13qQ2fq-k8s_EAAhKjxEMN9GR_DpRp1VZDDV4SWGJS3DBVBgdM9hps2uP` |
| 어휘 | `shueguk-voca/apps-script/Code.gs` | `AKfycbxW4aXPUq9Iu3VtnjHuInUxhG6dPaNIYawDRWTYEjvEIsv4kjEceXDb_y9OX5Lx3-9e` | `1Q4Jrt1wVymBfWBb18_hUno4xI5VUD5NH2bLvZOtbEzCObBRQk5zjbhZe` |
| H WORK | `shueguk-h-work/apps-script/Code.gs` | `AKfycbyrc0j6EmVLrlfZeSchetAcEzWPEFAEV1RHStr6ZTJPDJeH6pcvRDemfWU64puojmSDPg` | `1bYZrb9ACZ-QAfsEjcpdL94rVbw_Y9dskaL1vkCJniVUGSGwHZ8U2VG1G` |
| 클리닉 | `shueguk-clinic/Code.gs` | `AKfycbw8e-054e4VUfRRx-PadyuoXRb-jxsKRcdOaq04SJH1oJyFVS_VOh9GUN_pL5cHPPzKVA` | `1NF3H9DL5mxiTeYyKXGs0MJOUB-jawH0YuekudKzPpapi0n7HRlFxCDq9` |

> 참고: 토큰은 세션마다 새로 로그인해 얻는다(저장 안 함). refresh_token 재사용은 안전한 비밀 저장소가 생기면 그때 도입.

## 출제·OMR도 수파베이스가 원본 (2026-08-26 전환)
회차(omr_exams)·응답(omr_responses)의 원본이 수파베이스가 됐다(리포트 저장소
`supabase/migrations/017_omr_origin.sql` — 채점까지 DB 함수로 이식, 그쪽 `supabase/README.md` 참고).
- **학생 OMR·성적 관리 화면은 hub 저장소의 정적 페이지가 본체다**(`omr.html`·`omr_teacher.html`) —
  이 저장소의 `omr_student.html`·`teacher.html`은 UI 원본이었고, 이제 앱스스크립트 쪽은
  리다이렉트만 한다. **화면 수정은 hub 쪽 파일에서 할 것.**
- `omr_code.gs` 변경(재배포 필요): doPost `action=submit` = 정적 페이지가 제출 후 응답 시트
  '사본'을 맞추는 이중 기록 / doGet = 새 정적 페이지로 리다이렉트.
- 재배포 전까지: 새 페이지 제출은 원본(수파베이스)에만 남고 시트 사본이 비는데, 새벽 점검이
  '원본에만 n건'으로 보고한다(유실 아님).

## 회차 분석 화면 (hub `omr_analysis.html`, 2026-08-30 사용자 요청)
티쳐스 '주말 실전모의고사' 메뉴의 다섯째 카드 **[회차 분석]** — 회차를 고르면 그 회차의 성적을
한 화면에 집계해 보여 준다. 백엔드·DB 변경 없음(표를 읽어 **화면에서** 집계).
- 담긴 것: 회차 요약 타일(응시·평균·최고/최저·1·2등급) · **과목별 응시 인원·평균**(최고·최저·
  등급컷·등급별 인원) · **등급별 명단**(1~4·등급외, 이름·학교·점수 칩) · **공통 과목 오답률
  TOP 10** · 문항별 정답률과 **슈국 학생 선지 선택률 %**(공통/화작/언매 탭) · 영역별 평균 성취도.
- 데이터: `omr_exams`(정답·배점·영역·등급컷) + `omr_responses`(답안) 직접 조회 —
  omr_teacher.html과 같은 **조용한 교사 인증** 조각이 첫 스크립트 자리에 있어야 표를 읽는다.
- **점수·등급은 저장값이 아니라 지금 정답으로 다시 채점한 값**이다(성적 관리의 성적표와 같은
  방식 — `omr_report_by_id`와 값이 일치하는 것을 실 데이터로 확인). 출제 뒤 정답을 고친 회차는
  제출 당시 저장값과 다를 수 있는데, 그때는 이 화면 쪽이 맞다.
- 옵션 둘(기본 켜짐): **중복 제출은 최근 것만**(이름+학교 기준 마지막 제출) · **테스트 제출 빼기**
  (이름이나 학교가 '테스트' — 출제 뒤 OMR 입력으로 시험 삼아 낸 건). 제외 건수는 화면 위에 적힌다.
- 문항 구분: 고3형은 영역 분류 '선택과목'인 문항(보통 35~45)을 빼고 **공통 1~34**를 전원 기준으로,
  선택과목 문항은 그 과목 응시자만으로 센다. 통합형은 45문항 전부 공통. 무응답은 오답으로 센다.
- 집계 로직은 페이지 안 `ANALYSIS-CORE` 블록 한 곳에 있고, `shueguk-hub/tools/omr-analysis-test.js`가
  그 블록만 떼어 검증한다(`node tools/omr-analysis-test.js` 49건 / `SB_TOKEN=… --live`를 붙이면
  실제 9개 회차를 성적 관리 재채점 함수와 대조). **로직을 고치면 이 테스트를 함께 고칠 것.**

## 신청 데이터는 수파베이스가 원본 (2026-08-26 전환 — 아래 두 절보다 우선)
`signup_entries`가 신청의 원본이다(리포트 저장소 `supabase/migrations/016_signup_origin.sql` —
판정 함수 signup_days/signup_submit/signup_mine, 자세한 것은 그쪽 `supabase/README.md`).
- **학생 폼(signup.html)**: 요일·남은자리·학년 = `signup_days`(0.3초 안팎, 실패 시 옛 days 폴백).
  제출 = `signup_submit`(열림·학년·정원 37 판정 포함) → 성공하면 옛 백엔드에도 같은 제출을 뒤에서
  보내 **시트 사본**을 맞춘다. 수파베이스 장애면 옛 경로 폴백(+미러 훅).
- **교사 확인(signup_teacher.html)**: 목록 = 원본에서 바로(id 포함), 삭제 = 원본 id 삭제 →
  시트 사본에서 같은 신청(이름·요일 같고 제출시각 3분 이내)을 찾아 이중 삭제. 옛
  `sbResyncSignup`(시트 기준 통째 재동기화)은 **지웠다** — 되살리면 방금 신청·삭제가 되돌아간다.
  시트 사본과 어긋나면 '업데이트' 줄에 'n건 차이'로 표시(자동 수정 안 함 — 새벽 점검도 보고만).
- **설정(신청받기·가능 학년)의 원본은 여전히 신청 백엔드** — 토글·학년 저장은 옛 방식 그대로
  + signup_settings 미러 갱신. 판정 함수들이 그 미러를 읽는다.
- 아래 두 절(미러로 먼저 그리기·선조회 전달)은 이 전환 이전의 기록 — 구조 참고용.

## 신청 확인 페이지 첫 화면은 미러(수파베이스)에서 (2026-08-26)
`signup_teacher.html`이 열릴 때 신청 목록을 신청 백엔드(`action=data`)에서 받는데, 구글 서버가
시트를 읽는 시간 때문에 **2.3~5.4초** 걸린다(실측). 그동안 화면이 비어 있었다.

미러(`signup_entries`)에 같은 내용이 있으므로 **미러로 먼저 그리고, 원본인 시트는 뒤에서 받는다**
(`sbLoadFast` → `fetchData`). 첫 화면 **0.23~0.62초**.
- **삭제는 시트의 행 번호(`_row`)가 있어야 한다** — 미러에는 없으므로 원본이 오기 전에는
  체크박스·삭제 버튼을 잠가 둔다(`lock`, 안내 title). 원본이 오면 그대로 다시 그려 풀린다.
- 원본이 오면 그쪽이 이긴다(`SHEET_READY`) — 미러 응답이 늦게 도착해도 덮어쓰지 않는다.
- 미러로 이미 그린 뒤에는 `setState`로 화면을 비우지 않는다(`FAST_DRAWN`) — 새로고침·재시도 때
  목록이 사라지지 않게. 위쪽 '업데이트' 자리에 '원본 확인 중…'으로만 알린다.
- 신청받기·가능 학년도 `signup_settings` 미러에서 먼저 읽어 토글이 바로 보인다.
- 미러 신선도: 학생이 신청하면 즉시 한 줄 들어가고, 이 페이지가 목록을 읽을 때마다
  `sbResyncSignup`이 시트 기준으로 통째 교체하며, 삭제 성공 시에도 `fetchData()`가 다시 돈다.
- 검증(2026-08-26): 미러 314건 = 시트 314건, **화면에 찍히는 값(시각·주차·이름·학교·학년·ID·
  과목·요일)까지 314건 전부 동일**. 어휘 결과 페이지(`shueguk-voca`)와 같은 방식이다.

## 학생 신청 페이지(signup.html)도 선조회분으로 먼저 그린다 (2026-08-26)
signup.html은 열릴 때 days(요일·날짜·남은자리·학년)를 신청 백엔드에서 받는데 **2~5초** 걸려
그동안 요일을 고를 수 없었다. 학생 개별 페이지(s.html)의 실전 모의고사 메뉴가 열리는 순간
days를 미리 받아 sessionStorage `mockDaysPre`(**같은 도메인**)로 넘겨 주고, signup.html은
그 전달분으로 즉시 그린다(도착 전이면 300ms 간격 최대 6초 폴링).
- **자체 조회(원본)가 오면 그쪽이 이긴다**(`applyDays`/`DAYS_DIRECT`) — 남은자리가 최신으로 덮인다.
- 전달분이 '신청 중단'으로 닫아 뒀는데 원본이 '진행'이면 다시 연다(반대도 처리).
- 직접 접속(전달분 없음·북마크)은 종전과 완전히 동일. 서버가 제출 때 정원을 다시 검증하므로
  잠깐 옛 남은자리가 보여도 초과 신청은 안 된다.
