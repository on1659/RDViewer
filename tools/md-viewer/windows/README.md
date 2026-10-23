# RDViewer for Windows

Windows 10/11 **x64**용 앱입니다. Release에서 `RDViewer-0.3.4-windows-x64-setup.exe` **하나를 다운로드하고 실행**하면 설치됩니다. Electron과 모든 실행 파일이 EXE 안에 포함되어 있어 Node.js나 별도 서버·인터넷 연결 없이 설치할 수 있습니다. 현재 사용자에게 설치되며 관리자 권한은 필요하지 않습니다.

설치 후 시작 메뉴나 바탕 화면의 **RDViewer**로 실행하세요. 새 버전의 setup EXE를 실행하면 같은 앱을 업데이트합니다. 폴더 목록·테마·탭은 `%APPDATA%\RDViewer`에 보관되며 업데이트·제거 시 유지됩니다.

## 사용

- `Ctrl+O`: 파일 추가. 여러 파일 선택 가능.
- `Ctrl+Shift+O`: 폴더 추가. 여러 폴더 선택 가능.
- `Ctrl+F`: 현재 문서에서 찾기. Enter/Shift+Enter로 다음·이전 결과로 이동하고 Esc로 닫습니다.
- 사이드바 검색은 현재 폴더의 파일 이름과 문서 내용을 함께 찾습니다.
- 상단 **⋯** 메뉴에서도 **폴더 추가 / 파일 추가**를 선택할 수 있습니다.
- 탐색기에서 `.md` 파일을 RDViewer에 연결하거나 파일을 `RDViewer.exe` 위로 끌어 놓으면 열립니다.
- Codex·Claude가 표시하는 `C:\Work\Docs\plan.md:12`, Markdown 링크, `file:///C:/…`를 **⋯ → 경로로 파일 추가…**에 붙여 넣을 수 있습니다.
- 사이드바는 Markdown이 있는 폴더만 보여주며 상단에서 모두 펼치기/접기를 지원합니다.
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

`windows/build/RDViewer-0.3.4-windows-x64-setup.exe`와 SHA-256 파일이 생성됩니다. 빌드 의존성과 Electron·electron-builder 버전은 lockfile로 고정됩니다. GitHub Actions의 Windows runner에서 NSIS 설치 EXE를 빌드합니다.

Release workflow는 설치 EXE를 조용히 설치하고, 설치된 앱을 실제 실행해 서버 응답·파일 인자·`.claude` 문서 읽기·숨김 문서 트리를 검사합니다. 이어 같은 설치 파일 재설치와 앱 제거, 기존 사용자 데이터 보존, 파일 연결 후보 등록·제거를 확인한 뒤 EXE와 체크섬만 배포합니다.

공유 뷰어 코드·정적 리소스·안내 문서만 허용 목록으로 포함합니다. 원본 폴더 문서·개인 폴더 목록·macOS 앱·개발 도구는 배포물에 포함되지 않습니다. 렌더러는 sandbox/context isolation을 사용하고 Node 접근을 허용하지 않습니다.

이 배포물에는 Windows 코드 서명이 없습니다. Windows가 확인되지 않은 앱 안내를 표시할 수 있습니다. 설치 마법사 화면과 사용자가 기본 앱을 선택하는 과정은 Windows PC에서 최종 확인해야 합니다.
