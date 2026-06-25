# BulletFlow

Indentation 기반 계층을 bullet set으로 일괄 적용/교체하는 VS Code 확장.

## 기능
핵심 기능:
 - 설정: `bulletFlow.bulletSet` (기본: `['•','◦','·','>']`)
 - 기존 bullet 감지/제거 후 교체 (`bulletFlow.removeExisting` = true)
 - 별도 패턴 설정 없이 현재 활성 bulletSet 토큰만으로 기존 bullet 감지/제거
 - 들여쓰기 폭 자동 추론 (GCD) + 실패 시 fallback (`bulletFlow.indentSizeFallback`)

프로필/구성:
 - 다중 프로필 지원 (`bulletFlow.bulletSetProfiles`, `bulletFlow.activeProfile`)
 - 워크스페이스 루트 `.bulletflow.json` 파일로 프로필 override/추가 (설정과 병합, 파일 우선)
 - 프로필 항목 구조: `{ "profileKey": { "name": "Display Name", "bullets": ["•", "◦", ...] } }`
 - No-Top 변형 프로필 제공 (최상위 레벨 bullet 비움)

명령 (Command Palette):
 - `BulletFlow: Apply / Replace Bullets` (전체 문서)
 - `BulletFlow: Apply / Replace Bullets (Selection Only)` (선택 줄, 절대 레벨 유지)
 - `BulletFlow: Apply / Replace Bullets (Selection Only, Relative Levels)` (선택 줄, 최소 레벨 0으로 재정렬)
 - `BulletFlow: Remove Bullets` / `Remove Bullets (Selection Only)` (bullet 제거)
 - `BulletFlow: Select Bullet Set Profile` (프로필 빠른 전환)
 - `BulletFlow: Open/Create .bulletflow.json` (구성 파일 생성/열기)

내장 프로필(예):
 - default, circle, circleNoTop
 - simple, simpleNoTop
 - rectangle, rectangleNoTop
 - korean, koreanNoTop

선택 모드 차이:
 - Selection Only: 문서 전체 들여쓰기 기반 level 그대로
 - Selection Only (Relative): 선택 영역 내 최소 level을 0으로 내려 relative 재배치

제거(Remove) 로직:
 - 활성 bulletSet 토큰(공백/멀티문자 포함)을 길이순으로 매칭하여 선두 bullet 인식 후 제거 (패턴 설정 없음)

## 사용 방법
1. Settings 에서 기본 bullet 혹은 프로필 설정 (`bulletFlow.bulletSetProfiles` / `bulletFlow.activeProfile`).
2. 필요 시 `BulletFlow: Open/Create .bulletflow.json` 실행 후 파일에 프로필 추가/수정.
3. `BulletFlow: Select Bullet Set Profile` 로 프로필 전환.
4. 전체 적용: `BulletFlow: Apply / Replace Bullets`.
5. 일부만 적용: 영역 선택 후 Selection 관련 명령 실행.
6. bullet 교체가 아닌 제거만 필요하면 Remove 명령 사용.

## 예시
원본:
```
* Pending
  ㄴReadLater
    :https://example.com/a
    :https://example.com/b
```
설정 `["", "◦ ", "· "]` 적용 결과:
```
Pending
  ◦ ReadLater
    · https://example.com/a
    · https://example.com/b
```

## 팁
 - bullet 문자열 끝에 공백이 없으면 자동으로 단일 공백이 추가됩니다.
 - Level이 배열 길이를 초과하면 마지막 bullet이 반복 사용됩니다.
 - NoTop 프로필은 최상위 bullet 공백("")을 통해 헤드라인을 깔끔하게 유지.
 - Relative Selection 명령은 서브트리 추출/재배치에 유용.
 - `.bulletflow.json` 파일이 존재하면 VS Code 설정보다 우선하며, 설정과 병합됩니다.
 - multi-char bullet (예: "->", "=>") 또한 제거/교체 지원.

### .bulletflow.json 예시
```jsonc
{
  "profiles": {
    "default": { "name": "Default", "bullets": ["•", "◦", "·", ">"] },
    "circleNoTop": { "name": "Circle (no top)", "bullets": ["", "•", "◦", "·", ">"] },
    "customArrows": { "name": "Arrows", "bullets": ["", "→", "⇒", "⇢"] }
  },
  "active": "customArrows"
}
```

## 개발
```
npm install
npm run watch
```
F5 로 확장 개발 호스트 실행 후 명령 테스트.


## VSIX Packaging
```bash
npm install
npm run compile
npx vsce package --out out/bulletflow-0.0.2.vsix
```

Generated file: `out/bulletflow-0.0.2.vsix`

## 라이선스
MIT
