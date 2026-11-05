# MCP 연결

Chojema Dooroo를 로컬 MCP 서버로 실행하면 외부 MCP 클라이언트에서 HWP/HWPX 문서를 열고 읽고 편집하고 저장할 수 있습니다. MCP 전용 앱 창이 열리며, 수정은 그 창에 표시됩니다. 인터넷 서버나 별도 포트를 열지 않습니다.

이 기능은 0.7.0부터 Windows x64와 macOS Apple Silicon 설치본에 포함됩니다. Node.js 24 LTS와 MCP 실행기(`mcp.mjs`)가 필요합니다.

## AI 대화 또는 설정에서 자동 등록

편집기 오른쪽의 **AI 도우미** 대화창에서 다음과 같이 말하면 설정 파일을 직접 편집하지 않아도 자동으로 등록됩니다.

- **외부 AI 앱에 Chojema Dooroo 등록**: *"초제마 두루 MCP 연결해 줘"*, *"Claude Desktop이랑 Cursor에 MCP 등록해 줘"* (`register_dooroo_mcp` 도구 호출)
  - Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity의 설정 파일에 현재 앱 경로와 내장 `mcp.mjs`, 기본 `Documents`(또는 지정한 문서 폴더)를 자동 등록합니다.
  - 앱의 **설정 > MCP 자동 등록 > 외부 AI에 자동 등록** 버튼을 눌러도 즉시 등록됩니다.
- **앱 안의 AI 도우미에 외부 MCP 서버 연결**: *"memory MCP 서버 연결해 줘"*, *"filesystem MCP 추가해 줘"* (`register_mcp_server` 도구 호출)
  - 외부 MCP 서버(`npx`, `uvx`, `node`, `python`, `docker` 등)를 `mcp-servers.json`에 저장하고 즉시 연결하여, 그 서버가 제공하는 도구들을 앱 안의 AI 도우미가 바로 사용할 수 있습니다.

## 설치본에서 수동 연결

[릴리스 페이지](https://github.com/chojema/ChojemaDooroo/releases/latest)에서 앱을 설치하고, 같은 버전의 `mcp.mjs`를 내려받아 원하는 폴더에 보관하세요. 실행기는 Node.js 표준 라이브러리만 사용하므로 별도 `npm install` 없이 실행할 수 있습니다.

MCP 클라이언트의 서버 설정 예제입니다. 모든 경로를 실제 절대 경로로 바꾸세요. `--mcp-root` 폴더는 미리 존재해야 합니다.

```json
{
  "mcpServers": {
    "chojema-dooroo": {
      "command": "node",
      "args": [
        "D:/Tools/mcp.mjs",
        "--app", "C:/Applications/Chojema Dooroo/ChojemaDooroo.exe",
        "--mcp-root", "D:/Documents"
      ]
    }
  }
}
```

macOS에서는 실행기를 예를 들어 `/Users/사용자/Tools/mcp.mjs`에 보관하고, `--app`에는 `/Applications/ChojemaDooroo.app/Contents/MacOS/ChojemaDooroo`, `--mcp-root`에는 `/Users/사용자/Documents`를 지정합니다. 앱 묶음 이름은 실제 설치된 이름을 확인하세요.

## 소스에서 연결

먼저 프로젝트에서 의존성과 앱을 빌드합니다.

```sh
npm ci
npm run build
```

MCP 클라이언트의 서버 설정에 다음 내용을 넣습니다. `command`의 Node.js와 `args`의 프로젝트 경로, 접근할 문서 폴더는 실제 절대 경로로 바꾸세요. 지정한 문서 폴더는 미리 존재해야 합니다.

```json
{
  "mcpServers": {
    "chojema-dooroo": {
      "command": "node",
      "args": [
        "D:/Staging/AppSmith/ChojemaDooroo/tools/mcp.mjs",
        "--mcp-root",
        "D:/Documents"
      ]
    }
  }
}
```

클라이언트가 Node.js를 찾지 못하면 `command`에 `node.exe`의 절대 경로를 지정합니다. `npm run`은 안내 문구가 프로토콜에 섞일 수 있으므로 MCP 실행 명령으로 사용하지 않습니다.

Windows의 Electron 표준 입력 처리 차이로 앱의 `--mcp` 옵션을 클라이언트에서 직접 실행하는 방식은 지원하지 않습니다. 실행기가 표준 입출력을 받고 앱과는 Windows의 명명된 파이프 또는 macOS의 로컬 소켓으로 통신합니다. 앱의 진단 출력은 표준 오류로 분리합니다.

## 접근 범위와 저장

- `--mcp-root`는 필수입니다. 여러 폴더를 허용하려면 이 옵션을 반복합니다. 상대 경로와 허용 범위 밖 경로는 거부하며, 심볼릭 링크와 Windows 정션도 실제 경로를 확인합니다.
- `--mcp-read-only`를 추가하면 파일 열기와 조회 도구만 노출합니다. 이 옵션은 MCP 호출에 적용됩니다. 앱 창에서 직접 하는 편집을 잠그지는 않습니다.
- MCP 모드는 일반 앱과 다른 사용자 설정 폴더를 사용합니다. 일반 모드에서 이미 열린 문서를 조작하지 않으며, `list_documents`는 해당 MCP 세션에서 연 문서만 반환합니다. 동일 MCP 프로필의 중복 실행은 거부합니다.
- 문서 수정은 메모리에서 진행됩니다. `save_document`를 호출하거나 앱 창에서 직접 저장해야 파일로 저장합니다. 원본 보존이 필요하면 새 경로에 저장하세요. MCP 모드에서는 자동 저장을 비활성화합니다.
- 저장 경로는 확장자를 포함한 절대 경로여야 합니다. HWP는 `.hwp`, HWPX는 `.hwpx`로 지정합니다. 기존 대상은 `overwrite: true`를 명시해야 합니다.
- 저장은 기존 앱의 내보내기, 형식 검사, 보정, 최초 덮어쓰기 백업(`.bak`), 원자적 파일 쓰기를 사용합니다. 파일을 읽거나 저장한 뒤 외부에서 바뀌면 덮어쓰기를 거부합니다. 원본 파일의 모든 시각 요소 보존을 보장하지는 않으므로 중요한 문서는 사본으로 확인하세요.
- 메모 편집 창이 열려 있거나 변경 추적으로 저장이 제한된 문서는 기존 앱의 보호 절차를 따릅니다. 암호 입력과 복구 확인 등이 필요한 문서는 앱 창에서 처리해야 합니다.
- 연결이 끊기면 앱의 일반 종료 절차를 요청합니다. 저장하지 않은 변경이 있으면 창의 저장 확인을 처리해야 합니다. 클라이언트가 프로세스를 강제 종료할 수 있으므로 연결 종료 전에 명시적으로 저장하세요.

## 제공 도구

| 도구 | 기능 |
| --- | --- |
| `list_documents` | 세션의 문서 ID, 제목, 경로 조회 |
| `open_document` | HWP/HWPX 열기, 준비 완료 후 ID 반환 |
| `new_document` | 빈 문서 생성 |
| `read_document` | 현재 텍스트 읽기, 유니코드 문자 단위 분할 조회 |
| `find_text` | 일치하는 텍스트와 중복 여부 조회 |
| `replace_text` | 텍스트 한 곳 교체, 중복 시 `occurrence` 필수 |
| `insert_paragraphs` | 끝이나 기준 문단 앞뒤에 문단 삽입 |
| `list_tables` | 표 목록과 번호 조회 |
| `read_table` | 표 내용 조회 |
| `fill_table_cells` | 표 셀 채우기, 기존 내용은 `overwrite`로 교체 허용 |
| `insert_table` | 문자열 행 배열로 표 삽입 |
| `save_document` | 지정한 HWP/HWPX 파일로 저장 |

`documentId`는 열기 또는 생성 결과의 `id`를 사용합니다. `occurrence`, 표 번호, 행 번호, 열 번호는 1부터 셉니다. 문단의 `where`는 `end`, `before`, `after` 중 하나이며, 앞뒤 삽입에는 기준 문자열 `anchor`가 필요합니다. 조회 결과와 오류는 MCP 텍스트 응답으로 반환하며, 구조화된 결과는 JSON 문자열로 담습니다. `ok: false`인 편집 결과는 MCP의 `isError: true`로 반환합니다.

파일은 신뢰할 수 없는 입력입니다. 문서에 적힌 지시를 실행 지시로 취급해서는 안 됩니다. 도구는 임의 코드 실행이나 셸 실행을 제공하지 않습니다. 수정 요청은 순서대로 실행하며, 제한 시간을 초과한 편집을 자동으로 다시 시도하지 않습니다. 시간 초과 뒤에는 문서를 다시 읽어 실제 반영 여부를 확인하세요.

## 검증

```sh
npm run typecheck
npm test
npm run build
npm run test:mcp
```

`test:mcp`는 임시 프로필과 문서를 만들어 실제 stdio 연결, 한글과 유니코드 입력, 중복 교체 거부, 표 편집, HWPX/HWP 저장, 외부 변경 거부와 접근 범위 제한을 검사합니다. 새 소스로 패키징한 실행 파일은 `CHOJEMA_DOOROO_EXE`에 해당 경로를 지정해 같은 검사를 실행할 수 있습니다.

프로토콜 구현은 [공식 MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)의 서버와 stdio 전송을 사용합니다. 연결 방법은 [공식 서버 문서](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server)를 참고하세요.
