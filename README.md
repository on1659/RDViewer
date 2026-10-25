# RDViewer

Markdown 문서를 폴더별로 편하게 읽는 로컬 전용 뷰어입니다.

## Windows 다운로드

[최신 Release](https://github.com/on1659/RDViewer/releases/latest)에서
`RDViewer-*-windows-x64-setup.exe` 하나를 내려받아 실행하고 설치하세요.
설치 후 시작 메뉴의 **RDViewer**를 열면 됩니다.
별도의 Node.js 설치는 필요 없습니다.

- Windows 10/11 x64용 설치 앱
- 추가한 폴더·파일을 하나의 탐색 트리에서 표시, Git worktree 묶음 유지
- 없어진 폴더 자동 정리, 파일·폴더 추가 버튼에서 탐색 창으로 선택
- PNG 이미지·MP4 영상을 썸네일 없이 표시하고 클릭해서 열기, 파일 전환 시 영상 재생 종료
- 최근 열어본 파일 목록·다시 열기·기록 지우기
- 여러 폴더를 동시에 펼치는 트리, 드래그로 폴더 순서 저장, 숫자 옆 아이콘으로 폴더별 펼치기·접기
- 모든 폴더의 파일명·내용 검색
- 문서 탭, 목차, 읽기·원문 전환, `Ctrl+F` 문서 내 찾기
- 탐색기에서 MD·PNG·MP4·HTML 형식별 표시 선택과 설정 저장
- 읽기 설정에서 문서 목차 표시 켜기·끄기(기본 켜짐)
- 톱니바퀴 설정에서 단축키 변경·해제·기본값 복원
- 전용 설정 페이지에서 읽기·글꼴, 화면·테마, 단축키를 나누어 설정
- Mac·Windows 설치 글꼴 목록 검색·선택, 미리보기·저장
- 새로고침 옆 주소로 들어가기, 아래 주소 입력줄, 뒤로·앞으로 이동과 HTML 캡처·녹화
- 자동 업데이트 확인·다운로드와 재시작 설치, 설정에서 수동 확인·켜기·끄기
- VS Code Dark, Visual Studio 퍼플 등 테마와 사용자 색상
- `Ctrl+O` 파일 추가, `Ctrl+Shift+O` 폴더 추가
- Codex·Claude에서 복사한 로컬 파일 경로와 Markdown 링크 열기

앱은 문서를 읽기 전용으로 처리합니다. 문서 내용을 외부 서버에 업로드하지 않습니다.
자동 업데이트가 켜져 있으면 GitHub의 공개 RDViewer 릴리즈에서 새 버전을 확인하고 내려받습니다.
다운로드가 끝나면 **재시작하여 업데이트**를 눌러 적용합니다. 읽던 문서·테마·추가한 폴더는 유지됩니다.
설정의 **앱·업데이트**에서 자동 업데이트를 끄거나 직접 업데이트를 확인할 수 있습니다.
자동 업데이트는 0.4.15부터 지원하므로 이전 버전에서는 이 버전을 한 번 직접 설치해야 합니다.
배포 파일은 Windows 코드 서명이 없으며, 실제 Windows GUI 실행 검증 상태는 각 Release 설명을 확인하세요.

## Mac 다운로드

[최신 Release](https://github.com/on1659/RDViewer/releases/latest)에서 Apple Silicon은
`RDViewer-*-macos-arm64.zip`, Intel Mac은 `RDViewer-*-macos-x64.zip`을 내려받습니다.
압축을 풀어 `RDViewer.app`을 응용 프로그램 폴더로 옮겨 실행하세요. Node.js가 포함되어 있습니다.
개발자 ID 서명·공증이 없는 앱이므로 최초 실행 시 macOS 보안 설정에서 실행 허용이 필요할 수 있습니다.

## 개발

Node.js 22.13 이상이 필요합니다.

```sh
npm --prefix tools/md-viewer ci
npm --prefix tools/md-viewer test
npm --prefix tools/md-viewer run test:win
node tools/md-viewer/server.mjs --root .
```

브라우저에서 `http://127.0.0.1:4317`을 여세요.

```sh
# Windows x64 설치 EXE 만들기 (Windows에서 실행)
npm --prefix tools/md-viewer run build:win

# 이 Mac에 앱 빌드 및 설치 (Xcode 명령행 도구 필요)
npm --prefix tools/md-viewer run install:mac
```

Windows 산출물은 `tools/md-viewer/windows/build/`에 생성됩니다.
로컬 개발 빌드는 컴퓨터의 Node 경로를 사용합니다. 배포용 독립 Mac 패키지는
`node tools/md-viewer/macos/package.mjs`로 만듭니다.

자세한 사용법은 [뷰어 안내](tools/md-viewer/README.md),
Windows 파일 연결은 [Windows 안내](tools/md-viewer/windows/README.md)를 참고하세요.

## Release

버전은 `tools/md-viewer/package.json`에서 관리합니다.
해당 버전의 `v<version>` 태그를 만든 뒤 GitHub Actions의 Desktop Release 워크플로를 실행하면
Windows와 Mac 양쪽 아키텍처의 빌드·검사를 거쳐 설치 EXE·앱 ZIP·SHA-256을 Release에 첨부합니다.
사용자는 설치 EXE 하나만 내려받으면 됩니다. SHA-256 파일은 무결성 확인용입니다.
워크플로의 구체적인 실행 입력은 Actions 화면에서 확인할 수 있습니다.

HTML 미리보기와 Claude·Codex·GPT 로컬 에이전트용 CLI·MCP·HTTP 조작 도구도 지원합니다. 호출 예·연결 설정은 [agent API](tools/md-viewer/API.md)를 참고하세요.

## 주소로 HTML 열기

상단 지구본이나 **RDViewer 로고 → 주소 열기**를 누르고 `http://localhost:5014` 또는
`https://127.0.0.1:5014/demo.html` 같은 로컬 개발 서버 주소를 입력합니다.
`localhost:5014`처럼 프로토콜을 생략하면 HTTP로 엽니다. 기본 단축키는 `Ctrl+Shift+L`이며 Mac은 `⌘⇧L`입니다.

열린 페이지의 주소창에서 다른 주소로 이동할 수 있고, URL 탭과 최근 기록은 다시 열 수 있습니다.
미리보기는 활성 페이지 하나만 유지하며 캡처·녹화·MCP 조작을 공유합니다.
서버는 실행 중이어야 하며 HTTPS 인증서는 운영체제가 신뢰하고 주소와 일치해야 합니다.
파일로 저장한 HTML은 기존 **파일 추가**로 열 수 있습니다.
