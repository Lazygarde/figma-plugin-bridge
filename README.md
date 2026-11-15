# Figma to Android (Figma plugin + bridge + agent plugin)

Cho phép AI agent đọc design **trực tiếp từ Figma Desktop** (không qua Figma REST API/MCP, nên không dính rate limit) và chuyển thành UI Jetpack Compose theo quy trình chuẩn của team.

```
Agent ──MCP──> bridge/mcp.mjs ──HTTP──> bridge/server.mjs ──WebSocket──> Figma plugin UI ──> figma.* (code.ts)
```

## Repo gồm 3 phần

| Thư mục | Vai trò | Ai cần |
|---|---|---|
| `manifest.json`, `code.ts`, `ui.html` | Figma plugin "Design Live Bridge" (chạy trong Figma Desktop) | Mỗi dev, 1 lần |
| `bridge/` | Server local + MCP server (11 tool `figma_*`) | Tự chạy, không cần làm gì |
| `agent-plugin/` | Plugin cho agent: skill `figma-to-compose`, rule, cấu hình MCP | Cài bằng `install.sh` |
| `templates/`, `scripts/` | Template cho repo app, script cài đặt | |

## Cài đặt cho một máy (clone xong chạy 1 lệnh)

Yêu cầu: macOS/Linux, Node.js >= 18, Figma **Desktop**.

```bash
git clone <url-repo-nay> ~/tools/figma-to-android
cd ~/tools/figma-to-android
./scripts/install.sh
```

`install.sh` build Figma plugin, cài dependency cho bridge, rồi **hiện menu cho bạn chọn agent** muốn dùng:

```
Select the AI agents to set up:
  1) [ ] Antigravity
  2) [x] Claude Code  (detected)
  3) [ ] Codex CLI
  4) [ ] Cursor (MCP only)
Toggle by number (e.g. 1 3), a = all, n = none, Enter = confirm:
```

Agent phát hiện được trên máy sẽ được chọn sẵn. Gõ số để bật/tắt, `a` chọn hết, `n` bỏ hết, Enter để xác nhận. Không dùng menu được thì truyền tham số:

```bash
./scripts/install.sh --agents claude,codex   # chỉ định
./scripts/install.sh --all                   # tất cả
./scripts/install.sh --yes                   # không hỏi, dùng agent phát hiện được
```

| Agent | Skill | Đăng ký MCP |
|---|---|---|
| Antigravity | plugin `~/.gemini/config/plugins/figma-to-android` (skill + rule + `mcp_config.json`) | trong plugin |
| Claude Code | `~/.claude/skills/figma-to-compose` | `claude mcp add --scope user` |
| Codex CLI | `~/.agents/skills/figma-to-compose` | `codex mcp add` |
| Cursor | không có thư mục skill, dùng rule theo repo | `~/.cursor/mcp.json` (merge, có file backup `.bak-figma`) |

Đường dẫn MCP trỏ tới **clone trên máy này** và được tạo lúc cài, nên mỗi người một đường dẫn không sao. Nếu CLI `claude`/`codex` chưa có trên máy, script in lệnh để bạn tự chạy sau. Lựa chọn được lưu lại để `update.sh` dùng lại.

> Chỉ cấu hình Antigravity đã được thử trên thực tế. Claude Code, Codex và Cursor làm theo tài liệu công khai, **chưa kiểm chứng trên máy thật**: nếu đường dẫn hoặc lệnh khác phiên bản của bạn, hãy báo để sửa script.

Với Antigravity, mở Customizations và kiểm tra plugin `figma-to-android` đang bật.

### Phía Figma (1 lần mỗi máy)

1. Mở Figma **Desktop** và một file design (file bạn có quyền chạy plugin; nếu chỉ xem được thì duplicate về Drafts).
2. Menu **Plugins → Development → Import plugin from manifest...** → chọn `manifest.json` trong thư mục clone.
3. Chạy **Design Live Bridge** và **giữ cửa sổ plugin mở** (chấm xanh = đã kết nối).

Bridge server **tự khởi động** khi agent gọi tool `figma_*` lần đầu. Muốn chạy tay: `./scripts/start-bridge.sh`.

## Dùng trong repo app

```bash
~/tools/figma-to-android/scripts/init-repo.sh /path/to/app-repo
```

Lệnh này (không ghi đè file có sẵn, chạy lại an toàn):
- tạo `design/figma-tokens.json`, `design/figma-components.json`, `design/screens.json`
- thêm mục "Figma to Compose" vào `AGENTS.md` của repo

Sau đó điền các file `design/` (map token Figma → token Kotlin, component Figma → Composable) và các dòng `TODO` trong `AGENTS.md`. Commit các file này vào repo app để cả team dùng chung.

Thêm `--with-skill` nếu muốn repo mang theo bản skill (copy vào `.agents/skills/figma-to-compose/`), dành cho đồng nghiệp chưa cài plugin:

```bash
~/tools/figma-to-android/scripts/init-repo.sh /path/to/app-repo --with-skill
```

Khi đã cài plugin toàn cục thì **không cần** `--with-skill` (tránh hai bản skill trùng tên; bản trong repo ưu tiên hơn).

## Dùng

Trong Antigravity, mở repo app và nói, ví dụ:

> Implement frame này bằng Compose: https://www.figma.com/design/...?node-id=12-34

hoặc chọn một frame trong Figma và nói "làm frame đang chọn". Agent sẽ kích hoạt skill `figma-to-compose`.

## Cập nhật

```bash
~/tools/figma-to-android/scripts/update.sh   # git pull + cài lại cho các agent đã chọn lần trước
```
Sau đó relaunch plugin trong Figma để nạp `code.js` mới. Repo nào dùng `--with-skill` thì chạy lại `init-repo.sh ... --with-skill`.

Gỡ: `./scripts/uninstall.sh` (tất cả agent) hoặc `./scripts/uninstall.sh --agents claude`. Chỉ xóa phần đã cài, không đụng clone hay repo app.

## Tool của bridge

| Tool | Chức năng |
|---|---|
| `figma_ping` | Kiểm tra kết nối, tên file, page, số node đang chọn |
| `figma_get_selection`, `figma_get_pages` | Node đang chọn, danh sách page |
| `figma_get_metadata` | Cây layer gọn (id, tên, loại, kích thước) |
| `figma_get_node` | Thuộc tính đầy đủ (REST JSON); mặc định resolve variable thành tên token |
| `figma_resolve_variables` | Tra VariableID → tên token, giá trị theo mode, `codeSyntax` |
| `figma_export_image` | Render node ra PNG/JPG/SVG, trả về đường dẫn file |
| `figma_list_image_fills`, `figma_export_image_fills` | Liệt kê và tải ảnh gốc của image fill (hoa văn, ảnh nền) |
| `figma_get_variables`, `figma_get_styles` | Variables và styles local của file |

File xuất ra nằm trong `out/` của thư mục clone (ảnh node) và `out/fills/` (ảnh gốc của image fill). Có thể đổi bằng biến môi trường `OUT_DIR`.

## Kiểm tra bridge không cần Figma

```bash
cd bridge
PORT=3056 node server.mjs &      # hoặc terminal khác
PORT=3056 node smoke-test.mjs    # plugin giả lập, kiểm tra HTTP + MCP
```

CLI để test từng lệnh: `node bridge/cli.mjs ping`, `node bridge/cli.mjs get_node '{"id":"12:34"}'`.

## Phát triển

```bash
npm install && npm run build   # build code.ts -> code.js (file sinh ra, đã ignore)
npm run watch
npm run lint
```

`code.js` được sinh ra từ `code.ts` nên không commit. `install.sh` luôn build lại. Sửa `code.ts` xong cần relaunch plugin trong Figma.

## Bảo mật

- Server chỉ lắng nghe `127.0.0.1:3055`.
- `POST /call` yêu cầu header `x-bridge: 1`, WebSocket từ origin web (`http(s)://`) bị từ chối.
- Bridge cho phép đọc toàn bộ nội dung file Figma đang mở trong plugin. Không expose ra mạng.

## Giới hạn

- Phải mở Figma Desktop và chạy plugin; không chạy headless.
- Plugin chạy ở chế độ development (`devAllowedDomains` cho localhost), nên không publish lên Figma Community được. Mỗi dev import manifest như trên.
- Script cài đặt là bash (macOS/Linux). Trên Windows dùng WSL hoặc làm tay các bước trong `install.sh`.
- Một số tính năng (đọc biến từ thư viện ngoài, `JSON_REST_V1`) phụ thuộc quyền và plan Figma của từng người.
