# dsh-browser

为 **DeepSeek Harness（DSH）** 提供 AI 可操作、用户可实时接管的侧栏浏览器。

AI 通过 `sidebar_browser` 工具浏览网页，用户在侧栏观察同一个页面。需要手动操作时，点击「接管浏览器」即可使用键鼠；点击「交还 AI」后恢复只读。插件独立运行，不修改 DSH 源码，不接管日常浏览器资料。

## 功能

- **AI 浏览器工具**：导航、页面文本读取、元素检查、点击、表单输入、组合键、滚动、悬停、拖拽、等待和标签页管理。
- **实时人工接管**：接管后使用 Chromium 连续画面输出，鼠标按下、移动、松开分别传递，拖动过程中即可看到网页反馈。
- **人机控制互斥**：默认只读观察；人工接管期间，AI 不能修改或关闭浏览器，但仍可读取页面。
- **会话隔离**：每个 DSH Session 使用独立 Chromium context，不同会话不共享 Cookie。
- **多标签与地址栏**：支持前进、后退、刷新、新建空白标签；直接输入 `baidu.com` 等域名会自动补全 HTTPS。
- **使用现有认证通道**：通过 DSH Connection 传输，不新增监听端口，不自行保存 DSH 令牌。

版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 环境要求

- Node.js **22.19 或更高版本**。
- 提供 `connection.fetch.register`、`sidebarRightTabs` 和 `resources` 接口的 DSH Web 或桌面版本。
- Playwright Chromium，或本机已安装的 Chrome / Edge。

本插件不是独立浏览器应用，也不声明兼容所有旧版 DSH。开发时使用 DSH `0.2.1-rc.2` 的已安装 runtime 做过服务接入回归测试；这不等同于完整桌面端兼容性认证。

## 安装

### 1. 构建与准备浏览器

在项目目录运行：

```powershell
npm ci
npm run build
npm run browser:install
```

如果使用本机 Chrome / Edge，可跳过浏览器下载，在插件配置中设置 `channel: chrome` 或 `channel: msedge`。即使使用本机浏览器程序，也会创建独立 context，不读取日常浏览器资料。

### 2. 安装到 DSH

Web profile 示例，在项目目录运行：

```powershell
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh --profile web
```

也可先打包，再安装生成的文件：

```powershell
npm pack
dsh plugin --profile web add .\dsh-browser-0.4.0.tgz
```

`npm pack` 会自动构建，并将 Host 和客户端产物一起打包。Git 仓库不跟踪生成的 `lib/`、根目录 `client.js` 和安装包，从源码使用时必须先构建。

**桌面端请通过应用自身的插件管理入口安装安装包。** 全局 CLI 的 Web profile 不一定与桌面端使用同一份配置。安装或升级后，完全退出并重新打开 DSH，避免混用旧客户端与新 Host。

## 使用

打开一个 DSH 会话，在右侧栏开始页选择「AI 浏览器」，然后对 AI 说：

> 请使用 sidebar_browser 打开 https://example.com，读取页面并告诉我内容。

也可以先点击「接管浏览器」，再在地址栏输入网址。

### 侧栏操作

| 控件 | 用途 |
| --- | --- |
| 接管浏览器 / 交还 AI | 切换人工控制与只读观察 |
| 地址栏 | 输入网址并回车；普通域名默认 HTTPS，本机 loopback 地址默认 HTTP |
| 地址栏右侧「＋」 | 新建空白浏览器标签，不是新建 DSH 对话 |
| 标签上的「×」 | 关闭对应标签 |
| 原始尺寸 / 适应宽度 | 切换画面显示尺寸 |
| 更多操作「⋯」→ 关闭浏览器 | 确认后关闭当前会话所有浏览器标签并清除 Cookie 和登录状态；取消则保留 |
| 文字与按键 | 向网页焦点输入中文、粘贴的文字或发送组合键 |

接管后点击网页即可直接输入文字、使用中文输入法及粘贴纯文本；输入法只在提交后发送文字，连续输入会短暂合并以减少请求。粘贴仅处理用户发起的 paste 事件，不主动读取系统剪贴板；不支持图片/文件粘贴及自动复制网页选区。底部「文字与按键」保留为辅助入口。Tab 默认用于 DSH 界面焦点导航；开启「捕获 Tab 键」后发送到网页，Escape 退出捕获。网页自身的右键事件可触发，但面板不显示原生浏览器菜单。标准文本、小手、抓取等光标由网页样式同步；跨进程 iframe 内或自定义图片光标可能回退为默认。

状态栏显示连接中、已连接、已断开或已暂停。接管期间预览超过 5 秒无有效响应会锁定操作；恢复后需「确认接管」，不会直接执行断线前排队的输入。只读模式允许配置的轮询间隔加 5 秒。窗口或面板隐藏时停止画面请求并交还本窗口控制权；重新显示后需再次接管。网页本身仍在后台运行，不等于暂停网页脚本。

关闭侧栏不会关闭浏览器；持有控制权的侧栏关闭时会尝试交还。窗口崩溃或断连后，默认 30 秒无有效心跳或输入即释放控制。失焦、丢失指针捕获、交还与超时也会清理鼠标按下状态。

**接管不是隐私模式**：AI 仍能读取网页。不要在不可信模型或网站中输入敏感信息。

### AI 工具

```json
{"action":"navigate","url":"https://example.com"}
{"action":"snapshot"}
{"action":"inspect","selector":"input[name=q]"}
{"action":"fill","selector":"input[name=q]","text":"DeepSeek Harness"}
{"action":"press","key":"Enter"}
{"action":"new_tab"}
```

| 操作 | 参数与说明 |
| --- | --- |
| `navigate` | `url`，支持省略协议的域名 |
| `snapshot` | 返回有长度限制的无障碍树文本 |
| `inspect` | `selector`；返回元素可见性、边界和无障碍内容 |
| `click` | `selector` 或 `x,y`；可选 `button`、`clickCount`、`modifiers` |
| `hover` | `selector` 或 `x,y` |
| `drag` | `selector,targetSelector` 或 `x,y,toX,toY` |
| `fill` | `selector,text`；替换输入框内容 |
| `type` | `text`，可选 `selector`；输入文字 |
| `press` | `key`，如 `Control+A`；可选 `selector` |
| `scroll` | `deltaY`，可选 `deltaX`、`selector` |
| `check` | `selector,checked` |
| `select_option` | `selector,values`，按 HTML option 的 value 选择 |
| `wait_for` | `selector`，可选 `state`、`timeoutMs` |
| `back` / `forward` / `reload` | 前进、后退、刷新 |
| `tabs` / `select_tab` | 列出标签；按 `index` 切换标签 |
| `new_tab` / `close_tab` | 可选 `url` 新建标签，省略为空白页；可选 `index` 关闭标签，省略为当前页 |
| `close` | 关闭当前会话的整个浏览器，丢弃 Cookie 和页面状态 |

坐标以配置的完整视口为准，不是缩放后的侧栏尺寸。模型可先用 `inspect` 获取边界。人工接管期间仅允许 AI 的 `snapshot`、`inspect`、`tabs` 读取操作；物理指针输入接口不向模型开放。

## 配置

在目标 profile 的 `cordis.patch.yml` 中覆盖 `id: dsh-browser`。DSH patch 会替换整份 `config`，遗漏项使用插件默认值。

```yaml
- id: dsh-browser
  config:
    headless: true
    viewportWidth: 1280
    viewportHeight: 800
    actionTimeoutMs: 15000
    navigationTimeoutMs: 30000
    maxSessions: 8
    maxPagesPerSession: 8
    maxSnapshotChars: 24000
    frameIntervalMs: 1200
    jpegQuality: 65
    humanControlLeaseMs: 30000
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `headless` | `true` | 后台运行；`false` 额外显示原生窗口 |
| `channel` / `executablePath` | 未设置 | 使用 `chrome`、`msedge` 或指定程序路径 |
| `viewportWidth` / `viewportHeight` | `1280` / `800` | 视口范围分别为 320–3840 / 240–2160 |
| `actionTimeoutMs` / `navigationTimeoutMs` | `15000` / `30000` | 操作和导航超时，100–120000 毫秒 |
| `maxSessions` / `maxPagesPerSession` | `8` / `8` | 浏览器 context 与单 context 标签数量上限，1–32 |
| `maxSnapshotChars` | `24000` | 模型文本结果的 UTF-16 长度上限，128–100000 |
| `frameIntervalMs` | `1200` | 只读预览请求完成后的等待间隔，500–30000 毫秒 |
| `humanFrameIntervalMs` | `150` | 兼容旧配置；范围 50–2000，0.3.0 起不再控制活动页面接管画面 |
| `jpegQuality` | `65` | 画面 JPEG 质量，20–90 |
| `humanControlLeaseMs` | `30000` | 人工控制租约，10000–120000 毫秒 |

## 实现与限制

- **不是原生 webview 或 WebRTC 视频**：只读时使用低频截图；接管时使用 Chromium CDP screencast，通过已有认证 RPC 长轮询传递最新帧。等待帧不占用输入队列，但编码、RPC 往返与前端解码仍有开销，不承诺固定帧率或无延迟。
- **手动拖动不等于验证码保证**：鼠标 down/move/up 实时传递，慢连接合并移动坐标以避免积压。插件不自动识别或解决验证码，不修改风控或浏览器指纹。仅验证本地滑块，未验证真实验证码通过率。
- **原生导航与弹窗边界**：普通页面由 Chromium 处理 HTTP 重定向、最终 URL、相对资源、Cookie 和方法语义，CDP 在请求与重定向响应阶段校验目标。部分弹窗首轮请求早于可拦截 target 暴露，使用窄范围的逐跳安全代理回退；这类弹窗仍可能显示最初 URL、影响相对资源，且不支持回退中的表单重定向。不是对所有登录或跨进程页面的兼容性保证。
- **状态不持久化**：重启、关闭整个浏览器或卸载会丢弃 Cookie 和页面状态。没有文件上传下载、持久登录、开发者工具或任意 JavaScript 执行工具。
- **不接管 DSH 原有浏览器页签**：使用独立的「AI 浏览器」侧栏入口，AI 首次操作不会自动切换侧栏。

## 安全与隐私

- Host 在 `/api/dsh-browser/` 提供 `frame`、`command`、`control`、`input`、`pause` 路由，复用 DSH 的认证及 owner 权限检查，并验证会话和人工控制身份。
- 仅接受无内嵌凭据的 HTTP(S) 地址；阻止直接或重定向访问 DSH 自身 origin 及相同端口的常见 loopback 别名。**这不是通用 SSRF、DNS 重绑定或私网防火墙**，浏览器仍可访问宿主可达的其他 HTTP(S) 服务，只应对可信用户开放。
- Service Worker 禁用，下载被取消，权限默认不授予。取消 AI 操作会关闭相应 context，但无法撤销已发生的网页提交或点击。
- 网页文字是不可信数据，不是指令。AI 工具读取或填写的内容可能进入模型上下文和 DSH 工具日志；侧栏画面不会自动发给模型，也没有模型截图工具。
- 网络失败显示 `Browser request failed`，真正的策略拦截显示 `Browser policy blocked a request`。0.4.0 起不再由插件自动重试网络请求或重放动作，原生网络行为由 Chromium 决定。

## 开发与测试

```powershell
npm ci
npm run build
npm test
npm run test:e2e
```

集成测试需要先安装 Chromium。可选通过环境变量 `DSH_TEST_RUNTIME` 指向已安装 DSH runtime 的目录，启用真实 Cordis / Connection 服务接入测试；未设置时跳过该项。

测试覆盖参数与权限校验、会话隔离、导航与表单、控制交接、连续画面、实时拖动、取消与清理、重定向阻止、连接失败恢复，以及发布客户端的 React 界面。测试不等同于完整桌面应用、真实模型对话或真实验证码验证。

```text
src/                 Host、客户端与连续画面实现
scripts/build.mjs    构建 Host 和侧栏客户端
tests/               基础测试与 Chromium 集成测试
cordis.patch.yml     DSH 插件加载配置
```

## 卸载

```powershell
dsh plugin --profile web remove dsh-browser
```

随后重启对应 profile。桌面端通过应用插件管理入口卸载。

## License

[MIT](LICENSE)。第三方依赖及浏览器组件遵循各自许可证。
