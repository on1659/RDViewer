# RDViewer for Windows

Windows 10/11 **x64**용 앱입니다. Release에서 `RDViewer-0.4.9-windows-x64-setup.exe` **하나를 다운로드하고 실행**하면 설치됩니다. Electron과 모든 실행 파일이 EXE 안에 포함되어 있어 Node.js나 별도 서버·인터넷 연결 없이 설치할 수 있습니다. 현재 사용자에게 설치되며 관리자 권한은 필요하지 않습니다.

설치 후 시작 메뉴나 바탕 화면의 **RDViewer**로 실행하세요. 새 버전의 setup EXE를 실행하면 같은 앱을 업데이트합니다. 폴더 목록·테마·탭은 `%APPDATA%\RDViewer`에 보관되며 업데이트·제거 시 유지됩니다.

## 사용

- 톱니바퀴의 **단축키**에서 각 명령의 키 조합을 변경·해제하거나 초기화할 수 있습니다. 아래 단축키는 기본값입니다.

- 탐색기 상단 필터에서 MD·PNG·MP4·HTML을 골라 표시합니다. 여러 형식을 함께 선택할 수 있고 선택은 저장됩니다.
- **설정 → 문서 목차 표시**에서 목차를 켜고 끕니다. 기본은 켜짐이며 선택은 저장됩니다.
- 창 제목 표시줄과 최소화·최대화·닫기 버튼은 앱 테마의 배경·글자 색상을 따릅니다. 제목 표시줄을 끌어 창을 이동할 수 있습니다.
- 파일·편집·보기 메뉴 막대는 기본으로 숨깁니다. `Alt` 키로 표시할 수 있으며 단축키는 그대로 사용할 수 있습니다.
- `Ctrl+O`: 파일 추가. 여러 파일 선택 가능.
- `Ctrl+Shift+O`: 폴더 추가. 여러 폴더 선택 가능.
- `Ctrl+F`: 현재 문서에서 찾기. Enter/Shift+Enter로 다음·이전 결과로 이동하고 Esc로 닫습니다.
- 사이드바 검색은 파일 이름·경로와 Markdown 내용을 함께 찾습니다. PNG·MP4 바이너리 내용은 검색하지 않습니다.
- 폴더 트리의 PNG·MP4를 클릭하면 이미지 또는 영상 플레이어를 엽니다. 썸네일은 생성하지 않으며, 영상을 떠나면 재생을 멈춥니다. MP4는 지원 코덱에 한해 재생됩니다.
- HTML·HTM은 미리보기 창 하나에서 CSS·JavaScript와 함께 확인합니다. 미리보기 화면에서 캡처·무음 녹화를 시작하거나 종료할 수 있습니다.
- 상단 **파일 추가 / 폴더 추가** 버튼을 누르면 Windows 탐색 창에서 선택합니다. **RDViewer 로고**를 눌러도 두 추가 메뉴를 사용할 수 있습니다.
- 없어진 폴더는 앱을 시작하거나 목록을 새로고침할 때 자동으로 목록에서 제거합니다. 권한 문제나 일시적인 연결 오류는 유지합니다. 실제 파일은 삭제하지 않습니다.
- 탐색기에서 `.md` 파일을 RDViewer에 연결하거나 파일을 `RDViewer.exe` 위로 끌어 놓으면 열립니다.
- Codex·Claude가 표시하는 `C:\Work\Docs\plan.md:12`, Markdown 링크, `file:///C:/…`를 **⋯ → 경로로 파일 추가…**에 붙여 넣을 수 있습니다.
- 사이드바는 추가한 폴더·하위 폴더·Markdown·PNG·MP4·HTML을 하나의 트리로 보여주며 여러 폴더를 함께 펼칠 수 있습니다.
- 테마·탭은 사용자 프로필에, 폴더 목록은 `%APPDATA%\RDViewer\projects.json`에 저장됩니다.
- Git이 설치되어 PATH에 있으면 같은 로컬 저장소의 작업 폴더를 묶습니다. 없어도 폴더별 읽기는 가능합니다.
- 앱은 로컬 전용 `127.0.0.1:4318`을 사용합니다. 포트가 다른 프로그램에 사용 중이면 해당 프로그램을 종료한 뒤 재실행하세요.

## `.md` 기본 앱

`.md` 파일 우클릭 → 연결 프로그램 → 다른 앱 선택 → PC에서 앱 선택에서 `RDViewer.exe`를 고르세요. Windows가 제공하는 기본 앱 선택으로 설정합니다.

설치 프로그램이 RDViewer를 **연결 프로그램 / 기본 앱 후보**에 등록합니다. Windows 설정 → 앱 → 기본 앱에서 `.md`를 RDViewer로 선택할 수도 있습니다. 기존 기본 앱은 자동으로 변경하지 않습니다.

이전 포터블 버전에는 아래 등록 스크립트를 사용할 수 있습니다. 설치 버전에는 별도 실행이 필요하지 않습니다.

```powershell
.\Register-FileTypes.ps1
# 후보 등록 제거
.\Register-FileTypes.ps1 -Remove
```

## 빌드

저장소의 `tools/md-viewer`에서 Node.js 22.13 이상으로 실행합니다.

```sh
npm ci
npm run build:win
npm test
npm run test:win
```

`windows/build/RDViewer-0.4.9-windows-x64-setup.exe`와 SHA-256 파일이 생성됩니다. 빌드 의존성과 Electron·electron-builder 버전은 lockfile로 고정됩니다. GitHub Actions의 Windows runner에서 NSIS 설치 EXE를 빌드합니다.

Release workflow는 설치 EXE를 조용히 설치하고, 설치된 앱을 실제 실행해 서버 응답·파일 인자·`.claude` 문서 읽기·숨김 문서 트리·PNG 읽기·MP4 범위 요청을 검사합니다. 이어 같은 설치 파일 재설치와 앱 제거, 기존 사용자 데이터 보존, 파일 연결 후보 등록·제거를 확인한 뒤 EXE와 체크섬만 배포합니다.

공유 뷰어 코드·정적 리소스·안내 문서만 허용 목록으로 포함합니다. 원본 폴더 문서·개인 폴더 목록·macOS 앱·개발 도구는 배포물에 포함되지 않습니다. 렌더러는 sandbox/context isolation을 사용하고 Node 접근을 허용하지 않습니다.

이 배포물에는 Windows 코드 서명이 없습니다. Windows가 확인되지 않은 앱 안내를 표시할 수 있습니다. 설치 마법사 화면과 사용자가 기본 앱을 선택하는 과정은 Windows PC에서 최종 확인해야 합니다.

## Claude·Codex·GPT 로컬 에이전트

설치 폴더의 `resources\agent\rdviewer.cmd`로 CLI를, `resources\agent\rdviewer-mcp.cmd`로 MCP를 실행할 수 있습니다. 앱에 포함된 런타임을 사용하며 별도 Node.js 설치가 필요하지 않습니다. 앱을 먼저 실행하고 `rdviewer.cmd info`, `rdviewer.cmd open "C:\Work\demo.html"`, `rdviewer.cmd snapshot`을 호출하세요.

인증된 HTTP API도 함께 제공합니다. 연결 정보는 `%APPDATA%\RDViewer\automation.json`에 사용자 전용으로 저장하며 토큰을 웹페이지나 모델 프롬프트에 전달하지 않습니다. 전체 명령·MCP 서버 설정·GPT 함수 도구 예시는 설치 폴더의 `API.md`를 참고하세요. 브라우저 ChatGPT에는 PC의 localhost를 호출할 로컬 연결부가 필요합니다.

녹화는 무음이며 기본10fps, 최대15fps·120초·너비1920px입니다. Chrome 대비 메모리 절감량은 실행하는 HTML과 플랫폼에 따라 달라집니다.
