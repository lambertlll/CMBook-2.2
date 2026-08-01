# CMBook macOS 白屏问题 —— 完整修复方案

> 版本：2.6.0（HEAD b718259）｜ 日期：2026-08-01
> 性质：诊断 + 修复方案（本文档只给方案，具体修改需另行执行）
> 核心结论：**白屏是四个独立问题叠加所致，任何一个都能单独致白，且当前全部存在。修复必须分层处理，缺一不可。**

---

## 一、问题现象与影响面

**现象**：部分 macOS 用户安装后打开即白屏，无法使用；大部分新系统机器正常。

**影响面判定**（关键：不能只看 macOS 版本，还要看该机是否更新过 Safari）：

| macOS | 可得最高 Safari | 结果 |
|---|---|---|
| 10.13 High Sierra | 13.1.2 | JS 语法即崩（`??=`） |
| 10.14 Mojave | 14.1.2 | 私有字段可能崩，CSS 全废 |
| 10.15 Catalina | 15.6.1 | JS 勉强过，CSS 大面积失效 |
| 11 Big Sur | 16.6.1 | 若未更新到 16.2+ 则 CSS 崩 |
| 12 Monterey | 17.6 | 同上，取决于是否更新 |
| 13 Ventura | 18.6 | 基本正常 |
| 14+ Sonoma/Sequoia | 26.x | 正常 |

> **出厂版 Safari 低于 16.2 的 Big Sur/Monterey 机器会白屏，更新过则正常** —— 这精确解释了"大部分正常、少部分白屏"。
> `tauri.conf.json` 的 `minimumSystemVersion = "10.13"` 在安装阶段不拦，装完才白屏。

---

## 二、根因分析（四层，均已用产物实测验证）

### 成因 1【最严重】polyfill 根本没进产物，且 `__next_s` 队列机制是死循环

**现象**：`src/app/layout.tsx` 里 `legacy-polyfills`（约 7000 字符，`strategy="beforeInteractive"`）**完全未注入**产物——`out/` 下全部 27 个 HTML 中 `flatMap` 出现 **0 次**；而紧随其后的 `markdown-it-fix`（403 字符）注入成功。

**关键机制**：注入成功的脚本也不是裸 `<script>` 落地，而是被塞进 Next.js 的 `__next_s` 队列：

```js
(self.__next_s = self.__next_s || []).push([0, {"children": "...", "id": "markdown-it-fix"}])
```

该队列由 **Next.js 运行时**消费执行——而运行时本身就在含 `??=` 语法（`invalidUsageError??=t`）的 chunk 里。**polyfill 要等它想修的东西先跑成功才能生效，这是死循环**：即使 polyfill 注入成功，旧版 WKWebView 也会因运行时先崩而永远无法执行 polyfill。

**结论**：2.6.0 的"白屏修复"实际未生效，测试通过大概率因为测试机恰好都是新系统。

### 成因 2【语法级崩溃】构建零语法降级，首屏必经 chunk 含致命语法

**现象**：`package.json` 配置了 `browserslist: safari >= 11`，但 **Next.js 15 + Turbopack 不消费该字段做客户端降级**（`turbopack-build/impl.js` 中 `getSupportedBrowsers` 被注释，硬编码 `last 1 Safari versions`）。产物语法实测：

| 语法 | 数量 | 最低 Safari |
|---|---|---|
| 箭头函数 / let / const / class | 上万处 | ES6（10.x） |
| 可选链 `?.` | 2,789 | 13.1 |
| 空值合并 `??` | 1,142 | 13.1 |
| **逻辑赋值 `??=` / `||=` / `&&=`** | **75** | **14** |
| 类静态块 `static {}` | 131 | 16.4 |
| **私有字段 `this.#x`** | **2,132** | **14.1** |
| 正则后行断言 `(?<=` | 7 | 16.4 |

**首屏路径交叉验证**：`index.html` 的 23 个首屏 script 中，以下两个 chunk 必然执行且含致命语法：

- `77177711489cbc18.js`：含 `??=`（Next.js 运行时 `invalidUsageError??=t`）→ 需 Safari 14+
- `02bef592a1acf8f9.js`：含私有字段（`class extends Map { #e; ... }`，Radix UI collection）→ 需 Safari 14.1+

旧版 WKWebView 解析到即抛 **SyntaxError**，整个 chunk 一行不执行 → React 无法挂载 → DOM 全空 → **白屏**。

> `static {}` 与后行断言来自 mermaid / tiptap-mathematics，在懒加载 chunk 中，暂不炸首屏，但用户点开相关功能会崩。

### 成因 3【静默白屏】Tailwind 4 的 CSS 在旧 Safari 上静默失效

**现象**：主样式表 `3445a3e3f71b9346.css`（191 KB）中：

| CSS 特性 | 数量 | 最低 Safari |
|---|---|---|
| `color-mix()` | 563 | 16.2 |
| `oklch()` | 73 | 15.4 |
| `@property` | 89 | 16.4 |
| `@layer` | 5 | 15.4 |

这是 **Tailwind CSS 4 的默认输出**（v4 将颜色系统整体换成 oklch）。旧 Safari 遇到不认识的颜色函数会**丢弃整条声明**，导致背景色、文字色全部失效——即使 JS 侥幸跑起来，视觉上仍是一片白（白底白字）。

**最恶劣点**：CSS 解析失败**不报错**。JS 语法错误至少 devtools 可见，CSS 失败完全静默。

### 成因 4【辅助】白屏时无任何可见线索

- `tauri.conf.json` 未开 devtools；
- 前端无 `window.onerror` 兜底；
- `console-filter.tsx` 还在过滤控制台——故障不可见，无法定位。

---

## 三、修复方案（按优先级）

### 🔴 P0-1 构建做语法降级（治本，先做这个）

**目标**：让产物 JS 降到旧 WKWebView 可解析的语法（ES2017/ES2019 级）。

**方案 A（推荐，侵入最小）**：构建后追加转译步骤
- 在 `package.json` 的 `build` 脚本（`next build --turbopack && pnpm build:prune-maps`）之后，**挂一个新的转译钩子**（复用现有 `build:prune-maps` 的 Node 脚本模式）；
- 用 esbuild / SWC 对 `out/_next/static/chunks/*.js` 做一次降级转译：`target: 'es2017'`（或 es2019），覆盖 `??=`/`||=`/`&&=`/私有字段/静态块/后行断言；
- 注意：私有字段降级会生成 **WeakMap 垫片**，产物体积会涨，需实测（预计 +5%—10%）。

**方案 B（更彻底，改动构建链）**：去掉 `--turbopack` 回退 webpack
- `next build --turbopack` → `next build`；
- webpack 路径才会读取项目 `browserslist`（safari>=11）做 SWC 转译；
- 代价：构建速度下降，且需回归验证 Turbopack 特有行为（如 markdown-it-fix 的 workaround 是否仍需要）。

**方案 C（中间态）**：配置 `experimental.browsersListForSwc` 让 SWC 按 `safari>=11` 转译（若该配置在 Next 15 有效）。

> **必须同时修成因 1**：即使语法降级成功，polyfill 仍可能因 `__next_s` 机制无法执行（见 P0-2）。

### 🔴 P0-2 polyfill 改为独立注入（绕开 `__next_s` 死循环）

**目标**：polyfill 必须在任何应用 JS 之前、以不依赖 Next 运行时的方式执行。

**方案（推荐）**：polyfill 移出 `next/script`，改为构建后直接插入 HTML
- 将 `layout.tsx` 中的 `legacy-polyfills` 脚本内容保存为独立文件（如 `public/legacy-polyfills.js`，**纯 ES5 编写**，不依赖 Next）；
- 在 `build:prune-maps` 同环节，把 `<script src="/legacy-polyfills.js"></script>` 以**裸 script** 形式插入每个 HTML 的 `<head>` **最前**（27 个 HTML 都要插，或只插入口 `index.html` 及 `core/main.html`）；
- 不依赖 `__next_s` 队列，天然在运行时之前执行。

**同时修复 CSP 放行问题**（见 P1-3）：`script-src 'self'` 下，外部 `<script src>` 是允许的（'self' 同源），但内联脚本会被拦——因此**改为外部文件注入**天然规避 CSP 问题。

### 🔴 P0-3 Tailwind 4 CSS 降级（静默白屏的唯一解法）

**目标**：把 `oklch()` / `color-mix()` 编译成旧浏览器可识别的 `rgb()` / `rgba()`。

**方案**：postcss 加插件 `@csstools/postcss-oklab-function`
- 配置：
  ```js
  // postcss.config.mjs
  export default {
    plugins: {
      '@tailwindcss/postcss': {},
      '@csstools/postcss-oklab-function': {
        preserve: false, // 生成 rgb() 回退，移除原 oklch
      },
    },
  };
  ```
- `color-mix()` 目前主流方案是用 `@csstools/postcss-color-mix-function`（同样设 `preserve: false` 产出 fallback）；
- 验证：构建后 grep 产物 CSS，`oklch(` 与 `color-mix(` 数量应降为 0（或保留极少量带 fallback 的双写）。

> **兜底选项**（如插件不兼容 Tailwind4 的 vite 链路）：整体放弃 Tailwind v4 的 oklch 默认主题，回退为显式 `rgb()` 色板（改动面较大，列为备选）。

### 🟠 P1-1 白屏可见性兜底（先让故障可被看到）

**目标**：即使仍白屏，用户与运维也能看到明确提示而非空白。

**方案 A**：`index.html` 加**纯 ES5** 的 `window.onerror` 捕获 + 直写 DOM 提示（插入 `<body>` 最前）：
```html
<script>
  (function () {
    window.addEventListener('error', function (e) {
      try {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#c00;padding:12px;font:12px/1.5 sans-serif;white-space:pre-wrap;max-height:50%;overflow:auto';
        d.textContent = '页面脚本错误: ' + (e && e.message ? e.message : 'unknown');
        document.body.appendChild(d);
      } catch (x) {}
    });
  })();
</script>
```

**方案 B**：Rust 侧加"前端就绪握手"
- 前端启动后调用 `app_ready()` 命令；
- `main.rs` 5 秒未收到就绪信号 → 弹出原生对话框提示"页面加载异常，请升级系统或反馈"，避免无提示白屏。

### 🟠 P1-2 minimumSystemVersion 提高（保底拦截）

`tauri.conf.json` 的 `minimumSystemVersion` 从 `"10.13"` 提高到 **`"13.0"`**（Ventura）：
- 安装阶段直接拦下不兼容系统，用户看到"系统不支持"而非白屏；
- **代价**：丢失 High Sierra/Mojave/Catalina/Big Sur/Monterey 用户——需业务侧确认可接受；
- 若不能接受，则此项改为"文档声明支持 macOS 13+"，并保证上述 P0 修复全部完成。

### 🟠 P1-3 CSP 放行评估

`tauri.conf.json` 的 CSP `script-src 'self'`（无 `'unsafe-inline'`）：
- 当前产物中 `__next_s`/`__next_f` 内联脚本**可能被拦截**（需实机验证是否真拦）；
- 若被拦：方案① CSP 加 `'unsafe-inline'`（Tauri 桌面场景风险可控）；方案② polyfill 改外部文件（P0-2 已天然规避）；方案③ 用 Tauri 2 的 nonce/hash 机制。
- 建议在 P0-2 改外部注入后实机验证，能不加 `unsafe-inline` 就不加。

### 🟡 P2-1 音频链路兼容（不影响首屏，但影响核心功能）

- `meeting-live-transcript.ts:798`：`captureNode instanceof AudioWorkletNode` 在旧 Safari 无 `AudioWorkletNode` 全局 → ReferenceError → teardown 中断。
  - 修复：`typeof AudioWorkletNode !== 'undefined' && captureNode instanceof AudioWorkletNode`。
- `meeting-audio-recorder.ts`：`new MediaRecorder` 失败直接 throw，旧 Safari 无 MediaRecorder 时录音报错。
  - 修复：检测 `typeof MediaRecorder === 'undefined'` 时 UI 提示降级（不影响首屏，可后置）。

---

## 四、修复后验证清单

### 4.1 产物级验证（不依赖真机，先做）

```bash
# 1. 语法降级：致命语法归零（或仅剩懒加载/已降级）
grep -rl '??=' out/_next/static/chunks/ | head
grep -rlE '#[a-zA-Z_]+;' out/_next/static/chunks/ | head
# 期望：首屏 23 个 chunk 中 0 命中（??= 和私有字段在 es2017 target 下会被转译）

# 2. polyfill 注入
grep -c 'legacy-polyfills\|flatMap' out/index.html
# 期望：> 0，且为裸 <script src> 形式（非 __next_s 队列）

# 3. CSS 降级
grep -o 'oklch(' out/_next/static/chunks/*.css | wc -l   # 期望 0
grep -o 'color-mix(' out/_next/static/chunks/*.css | wc -l  # 期望 0

# 4. __next_s 不再包含 polyfill 内容
grep -o 'legacy-polyfills' out/index.html  # 期望仅在独立 script 中出现
```

### 4.2 真机验证矩阵（最可靠）

| 验证机 | macOS / Safari | 预期 |
|---|---|---|
| 旧系统未更新 | 10.15 / Safari 15.6 或 11.x / 16.0 | 修复前白屏 → 修复后正常 |
| 中老年系统 | 12 Monterey / Safari 16.x 出厂 | 修复前 CSS 白 → 修复后正常 |
| 新系统 | 13+ / Safari 17+ | 回归无影响 |
| 演示备用机 | 任意 | 回归无影响 |

验证动作：启动 → 首屏渲染 → 新建会议 → 录音 → 实时转写 → 生成纪要 → 打开知识库问答 → 生成周报（覆盖 mermaid/tiptap-mathematics 懒加载路径）。

### 4.3 回归项

- 新系统（macOS 13+/14+、Windows）全流程无回归；
- 构建产物体积变化（WeakMap 垫片增量）可接受；
- `pnpm build` 全流程通过（含新增转译钩子）；
- `npx tsc --noEmit`、`cd src-tauri && cargo check` 通过。

---

## 五、实施顺序建议（最小改动先见效）

| 步骤 | 动作 | 工作量 | 见效 |
|---|---|---|---|
| 1 | 构建加语法降级钩子（P0-1 方案 A） | 中 | 解决首屏 SyntaxError（最大头） |
| 2 | polyfill 改外部文件注入（P0-2） | 小 | 让 API polyfill 真正生效 |
| 3 | postcss 加 oklch/color-mix 降级（P0-3） | 小 | 解决静默白屏 |
| 4 | window.onerror 兜底 + Rust 握手（P1-1） | 小 | 故障可见 |
| 5 | 真机验证矩阵（4.2） | — | 确认修复 |
| 6 | minimumSystemVersion / CSP 评估（P1-2/1-3） | 小 | 保底与收尾 |

> **务必避免**：只重新 `pnpm build` 就宣布修复——成因 2/3 是构建链本身的问题，重跑不解决；成因 1 因 `__next_s` 死循环，重跑也不解决。四层必须按上表全做。

---

## 六、附：问题定位关键证据索引

| 证据 | 位置 |
|---|---|
| 硬编码 browserslist | `node_modules/next/dist/build/turbopack-build/impl.js:64-66` |
| polyfill 源码 | `src/app/layout.tsx:34-212`（legacy-polyfills） |
| `__next_s` 队列注入 | `out/index.html`（markdown-it-fix 以 push 形态落地） |
| 首屏致命 chunk | `out/_next/static/chunks/77177711489cbc18.js`（`??=`）、`02bef592a1acf8f9.js`（`#e;`） |
| 主样式表 | `out/_next/static/chunks/3445a3e3f71b9346.css`（191KB，color-mix 563 / oklch 73 / @property 89 / @layer 5） |
| CSP 配置 | `src-tauri/tauri.conf.json:16`（`script-src 'self'`） |
| minimumSystemVersion | `src-tauri/tauri.conf.json:64`（"10.13"） |
| AudioWorklet instanceof | `src/app/core/main/meeting/meeting-live-transcript.ts:798` |
