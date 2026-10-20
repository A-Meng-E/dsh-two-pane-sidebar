# dsh-two-pane-sidebar 修复说明

## 出了什么问题

重启后 Harness 起不来，日志里两条线索（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\`）：

```
crash-...-main.log      DesktopHostFatalError: cannot create effect on inactive context
crash-...-web-boot.log  Error: web boot: 1 entry did not activate
                        dsh-two-pane-sidebar: failed
```

**1. 主进程那条致命错误不是本插件的代码引起的。**
堆栈落在 `dsh-desktop-host/lib/index.js:83`，那是内置 `desktop-office` 插件的
`apply()`：它在 `await` 之间又调了一次 `ctx.plugin(...)`，父 fiber 此时已被回收，
于是抛 `INACTIVE_EFFECT`。触发条件是**在应用运行期间改写 profile 配置**
（`package.json` / `cordis.patch.yml`），文件监听器立刻热重载，赶上启动竞态。

结论：改 profile 之前先退出应用，改完再启动。

**2. `dsh-two-pane-sidebar: failed` 是本插件的问题。**
宿主的启动自检逻辑（前端的 `bZ()`）在 entry 的 fiber 状态不是 `active` 时直接抛错，
整个 web boot 失败。`failed` 表示 fiber 进入了 FAILED，也就是插件的 `apply()` 抛了异常。

根因只有一个：**slot 注册姿势用错了**。

宿主里的第三方插件必须这样投递（可对照 `@linxin666/dsh-client-ui-task-board` 的
`registerTaskBoardPanel`）：

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name, id, order }, Component));
```

0.1.0 是裸调 `ctx.slots.register(...)`，跳过了 `inject` 这一层作用域，直接抛错。

顺带修掉的次要问题：

- entry 的 options 里塞了列表槽不认识的 `locale` 字段；
- `shell.overlay` 渲染时不传 `usePanelInfo` / `renderSlot`，组件里直接调用会崩；
- `apply` 没有任何 try/catch，抛一次就拖死整个启动。

## 改了什么

- 注册改为 `contribute()`：优先走 `slots.inject(槽名, () => slots.register(...))`，
  没有 `inject` 方法才退回裸 register。
- entry options 收紧为 `{ name, id, order }`；组件通过闭包拿 `ctx` / `prefs`，
  不再依赖 `inject` 选项。
- `inject` 从 `['slots','layout','locale','shortcuts']` 收敛为 `['slots','locale']`，
  `layout` / `shortcuts` 改为运行时可选获取——它们缺席时不会让 entry 卡在 pending。
- 全部接线挪进 `ctx.inject(['slots'], wire)` 派生的**子 fiber**：父 fiber 立即 active，
  子 fiber 出问题也只影响这个面板。
- `apply` 全程 try/catch，`apply` 不可能再抛。

净效果：最坏情况是侧边栏不出现，但**应用一定能启动**。

## 第二处修复：A 栏图标不渲染

A 栏能显示、但每行图标是空白，原因在 renderer 的 `standardKit`：

```js
if (entry.children !== void 0) {
  kit['renderSlot'] = boundRenderSlot(host, entry);
}
```

**`renderSlot` 只注入给「自己声明了 children 的 entry」。** A 栏的 entry 没有子槽，
所以 `props.renderSlot` 是 `undefined`，原来那句 `renderSlot('sidebar.panellist', …)`
在 `typeof` 守卫下直接返回 `null`，于是每行都少了图标。

修法（`renderGlyph()`）：优先走 `renderSlot`（将来若拿到就用官方路径），否则
**直接渲染该条目的 `entry.component`**——`sidebar.panellist` 里注册的图标组件都是纯
SVG（如 task-board 的 `TaskBoardPanelIcon({ size })`），只吃 `size` / `active`
两个 props，可以安全直渲染。外面再套一层 `GlyphBoundary` 错误边界，单个图标组件
抛错只让那一行退化成兜底方块，不会带崩整条 A 栏。

已验证：桩环境渲染 7 个条目 → 7 个按钮、7 个带 `data-dsh-panel-entry` 的 svg。

## 第三处修复：图标出来了但配色不对

现象：装了女仆皮肤（`@smalltailqwq/dsh-client-ui-skin-maid-atelier`）时，侧边栏是深蓝底
浅色字，A 栏却是浅底深字。

原因不在变量名——`--dsw-specific-sidebar-fill` / `--dsw-alias-label-primary` 等都是真实
token。问题在于**皮肤的作用范围**：

```css
body[data-dsh-maid-atelier] [class*=sidebarCol]{background:#0a173b; ...}
body[data-dsh-maid-atelier] [class*=sidebarCol]>div{background:...渐变纹理...}
```

皮肤是按「侧边栏那一列的类名 `sidebarCol`」刷底和纹理的。A 栏挂在 `shell.overlay` 里、
位于该列左侧，**不在这个选择器范围内**，只能退回到主题默认的浅色 token。

修法：运行时**复制原生侧边栏列的计算样式**到 A 栏（`syncSidebarChrome`）：

| 来源 | 复制到 | 内容 |
|---|---|---|
| `[class*=sidebarCol]` 的 `backgroundColor` / `backgroundImage` | `.tps-rail` | 底色与渐变 |
| 该列第一层子 div 的 `backgroundImage` 及 size/position/repeat | `.tps-railInner` | 纹理 |
| 列内 `[class*="_root"]` 的 `color` | `.tps-rail` 的 `color` | 文字/图标色 |

配套把 `.tps-item` / `.tps-iconBtn` 的颜色改成 `inherit`（原来写死 `--dsw-alias-label-primary`，
会把继承色盖掉），hover 底色改用 `color-mix(in srgb, currentColor 10%, transparent)`，
这样浅色和深色皮肤下悬浮态都自然。

同时监听 `body` 的属性变化（切深浅色、换肤）重算一次。

好处：不为任何一个皮肤写死颜色，皮肤换成什么样，A 栏就是什么样。

## v2：A 栏常驻，去掉 A/B 切换

按需求移除了显示模式切换，改动范围：

- 删掉三态模式（双栏 / 仅 A / 仅 B）、顶栏切换按钮、`sidebar.footer.action` 回落按钮、
  `Ctrl+Alt+1/2` 快捷键、窄窗口降级逻辑。
- A 栏宽度恒为 52px（带标签时 208px），`data-tps-a` 恒为 `on`，
  原生侧边栏里的导航列表始终收起。
- **删掉 `syncNative`**：v1 为了让 B 栏跟随持久化模式，会在启动时调用
  `ctx.layout.toggleSidebar()`。而宿主把「折叠」记成 `sidebar = 0`，重新展开时退回
  默认 280px——用户拖过的宽度就被覆盖了。常驻形态不需要这套反向同步，B 栏宽度
  重新完全归宿主管。
- 持久化 key 换成 `dsh.two-pane-sidebar.v2`，只存「是否带文字标签」，
  旧的 `{a, b}` 状态直接作废，不会被误读。

### 关于 B 栏宽度

宿主的列宽算法是固定的：

```js
const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);
```

`clampWidth` 只和用户偏好有关，**与 frame 宽度无关**。插件给 frame 加的
`padding-left: 52px` 不会压缩 B 栏列宽，它压缩的是中间的对话区（少 52px）。

唯一会被影响的是宿主的窄窗口判断 `narrow = viewport < 1024`：frame 的
content 宽度少了 52，阈值会提前 52px 触发。窗口宽度接近 1024 时要注意这一点。

## v2.1：插件描述与 Tooltip

### 描述改在哪

插件页显示的标题和描述**不在 `package.json`**，而在 `locale/*.json` 的 `meta` 字段：

```json
{ "meta": { "title": "插件栏分栏", "description": "把插件导航拆成侧边栏左侧的常驻细栏，主侧边栏只保留新会话与工作区。" } }
```

已同步改掉中英两份，以及 `package.json` 的 `description`（给包管理用的那份）。
改完要重启 Harness 才会重新读取。

### 悬停提示：可行性结论

**原生 `title` 属性无法改样式。** 那是 Chromium 自己画的系统气泡，CSS 完全够不着，
所以皮肤主题下必然是白底黑字 + 系统字体。

宿主提供了主题化的 `Tooltip`，可以直接复用：

- 包：`@deepseek-ai/dsh-client-ui-primitives`
- 它是 loader 的 **隐式 baseline external** —— 任何客户端插件都能 `require`，
  不用写进依赖，也不该打包另一份（宿主文档明确这么要求）。
- 组件签名：`{ label, shortcutKeys, side='right', align='center', delayMs=0, focusDelayMs=0, gap=8, disabled, portal=false, maxWidth, openOnClick }`

接入方式：`withTooltip(el, label)` 把图标按钮包一层，并**同时去掉 `title`**
（否则系统气泡和主题气泡会一起冒出来）。关键参数是 `portal: true`——A 栏有
`overflow: hidden`（窄栏要裁掉溢出），就地渲染的气泡会被裁掉。

兜底：`require` 失败或 `Tooltip` 不是函数时，退回 `title` 属性，功能不受影响。

已验证：桩环境渲染出 7 个条目 + 1 个展开按钮，共 8 个 Tooltip，全部 `portal: true`。

## v2.2：文字标签开关位置统一

问题：宽栏时开关在 A 栏**顶部**，窄栏时在**底部**，切换时控件会「跳」。

原因：两处分别渲染——宽栏那个在 `.tps-top` 容器里，窄栏那个挂在 `nav` 末尾。

改法：

- 删掉整个 `.tps-top` 容器（它只服务于那个按钮）。
- 开关移到 `.tps-railInner` 内、`nav` **之后**，成为最后一个子节点，两种宽度同一个位置。
- 放在 `nav` 外面还有一个附带好处：A 栏条目变多、列表滚动时，开关不会被一起推走。
- 窄栏是 28px 图标；宽栏 `data-wide="true"` 时撑满并显示「隐藏文字标签」文字。
- 点击处理合并成一个 `prefs.set({ wide: !wide })`，不再分两个分支。

验证（两轮，`narrow` / `wide`）：开关都是 `railInner` 的最后一个子节点，
`tps-top` 节点数 0，`data-wide` 与模式一致；宽栏下只保留开关自身一个 Tooltip。

## v2.3：开关只留图标，热区与图标尺寸对齐条目

两处调整：

1. **不再显示「隐藏文字标签 / 显示文字标签」文字**。宽栏时也只是箭头图标——
   语义交给 `aria-label` 和悬停 Tooltip，视觉上不抢注意力。
2. **热区与图标对齐 `.tps-item`**：
   - 原来的 `.tps-iconBtn` 是 28×28，比条目的 36px 矮一截，点击手感不一致。
   - 现在 `.tps-labelToggle` 覆盖成 `width:100%`、`min-height:36px`、
     `padding:7px 8px`、`height:auto`，与条目同尺寸。
   - 图标尺寸跟条目走同一条规则：`wide ? 16 : 18`（`LabelIcon` 现在接受 `size`）。

验证：`narrow` 模式下 7 个条目与开关的图标都是 18px；`wide` 模式下都是 16px；
两种模式下开关内都只有一个 svg，没有文字节点。

## 如果还需要彻底禁用

改 `~/.dsh/profiles/desktop/package.json`，删掉这一行：

```json
"dsh-two-pane-sidebar": "link:D:/文档/deepseek-harness/default-workspace/two-pane-sidebar",
```

**改之前务必先退出应用。**

## 备份

`D:\文档\deepseek-harness\default-workspace\backup-two-pane-20261021-000231\`
里有改动前的 `client.js`、`index.js`、`package.json`，以及 profile 的
`package.json` 与 `cordis.patch.yml`。
