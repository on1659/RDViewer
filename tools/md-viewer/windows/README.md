# RDViewer for Windows

Windows 10/11 **x64**용 포터블 앱입니다. ZIP을 원하는 위치에 **전부 압축 해제**하고 `RDViewer.exe`를 실행하세요. Node.js나 별도 서버 설치는 필요하지 않습니다. EXE만 단독으로 옮기면 실행할 수 없습니다.

## 사용

- `Ctrl+O`: Markdown 파일 열기. 여러 파일 선택 가능.
- `Ctrl+Shift+O`: 프로젝트 폴더 추가. 여러 폴더 선택 가능.
- 탐색기에서 `.md` 파일을 RDViewer에 연결하거나 파일을 `RDViewer.exe` 위로 끌어 놓으면 열립니다.
- Codex·Claude가 표시하는 `C:\Work\Docs\plan.md:12`, Markdown 링크, `file:///C:/…`를 문서 열기 창에 붙여 넣을 수 있습니다.
- 사이드바는 Markdown이 있는 폴더만 보여주며 상단에서 모두 펼치기/접기를 지원합니다.
- 테마·탭은 사용자 프로필에, 프로젝트 목록은 `%APPDATA%\RDViewer\projects.json`에 저장됩니다.
- Git이 설치되어 PATH에 있으면 같은 로컬 저장소의 작업 폴더를 묶습니다. 없어도 폴더별 읽기는 가능합니다.
- 앱은 로컬 전용 `127.0.0.1:4318`을 사용합니다. 포트가 다른 프로그램에 사용 중이면 해당 프로그램을 종료한 뒤 재실행하세요.

## `.md` 기본 앱

`.md` 파일 우클릭 → 연결 프로그램 → 다른 앱 선택 → PC에서 앱 선택에서 `RDViewer.exe`를 고르세요. Windows가 제공하는 기본 앱 선택으로 설정합니다.

선택 사항으로 PowerShell에서 아래 스크립트를 실행하면 현재 사용자의 기본 앱 후보에 RDViewer를 등록하고 Windows 설정을 엽니다. 관리자 권한은 필요하지 않으며 현재 기본 앱을 강제로 바꾸지 않습니다. PowerShell 정책이 스크립트를 막으면 위의 연결 프로그램 방식을 사용하세요.

```powershell
.\Register-FileTypes.ps1
# 후보 등록 제거
.\Register-FileTypes.ps1 -Remove
```

포터블 폴더 위치를 바꾸면 연결 프로그램에서 새 `RDViewer.exe` 경로를 다시 선택하거나 등록 스크립트를 다시 실행하세요.

## 빌드

저장소의 `tools/md-viewer`에서 Node.js 22.13 이상으로 실행합니다.

```sh
npm ci
npm run build:win
npm test
npm run test:win
```

`windows/build/RDViewer-0.3.2-windows-x64.zip`과 SHA-256 파일이 생성됩니다. 빌드 의존성과 Electron 버전은 lockfile로 고정되며 macOS에서도 Windows 실행 파일을 생성할 수 있습니다.

공유 뷰어 코드·정적 리소스·안내 문서만 허용 목록으로 포함합니다. 원본 프로젝트 문서·개인 프로젝트 목록·macOS 앱·개발 도구는 배포물에 포함되지 않습니다. 렌더러는 sandbox/context isolation을 사용하고 Node 접근을 허용하지 않습니다.

이 배포물에는 Windows 코드 서명이 없습니다. 실제 Windows GUI 실행과 기본 앱 연결은 Windows PC에서 최종 확인해야 합니다.
