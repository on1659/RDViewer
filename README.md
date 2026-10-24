# RDViewer

Markdown 문서를 폴더별로 편하게 읽는 로컬 전용 뷰어입니다.

## Windows 다운로드

[최신 Release](https://github.com/on1659/RDViewer/releases/latest)에서
`RDViewer-*-windows-x64-setup.exe` 하나를 내려받아 실행하고 설치하세요.
설치 후 시작 메뉴의 **RDViewer**를 열면 됩니다.
별도의 Node.js 설치는 필요 없습니다.

- Windows 10/11 x64용 설치 앱
- 추가한 폴더·파일을 하나의 탐색 트리에서 표시, Git worktree 묶음 유지
- PNG 이미지·MP4 영상을 썸네일 없이 표시하고 클릭해서 열기, 파일 전환 시 영상 재생 종료
- 최근 열어본 파일 목록·다시 열기·기록 지우기
- 여러 폴더를 동시에 펼치는 트리, 모든 폴더의 파일명·내용 검색, 전체 펼치기·접기
- 문서 탭, 목차, 읽기·원문 전환, `Ctrl+F` 문서 내 찾기
- VS Code Dark, Visual Studio 퍼플 등 테마와 사용자 색상
- `Ctrl+O` 파일 추가, `Ctrl+Shift+O` 폴더 추가
- Codex·Claude에서 복사한 로컬 파일 경로와 Markdown 링크 열기

앱은 문서를 읽기 전용으로 처리합니다. 문서 내용을 외부 서버에 업로드하지 않습니다.
배포 파일은 Windows 코드 서명이 없으며, 실제 Windows GUI 실행 검증 상태는 각 Release 설명을 확인하세요.

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
macOS 앱은 빌드한 컴퓨터의 Node 경로를 사용하므로 다른 Mac에 바로 배포하는 독립 패키지는 아닙니다.

자세한 사용법은 [뷰어 안내](tools/md-viewer/README.md),
Windows 파일 연결은 [Windows 안내](tools/md-viewer/windows/README.md)를 참고하세요.

## Release

버전은 `tools/md-viewer/package.json`에서 관리합니다.
해당 버전의 `v<version>` 태그를 만든 뒤 GitHub Actions의 Windows Release 워크플로를 실행하면
Windows 빌드와 검사를 거쳐 설치 EXE·SHA-256을 Release에 첨부합니다.
사용자는 설치 EXE 하나만 내려받으면 됩니다. SHA-256 파일은 무결성 확인용입니다.
워크플로의 구체적인 실행 입력은 Actions 화면에서 확인할 수 있습니다.
