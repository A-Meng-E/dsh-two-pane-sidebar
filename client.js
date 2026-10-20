/**
 * Two-pane sidebar — Client half.
 *
 * 当前形态（v2）：A 栏常驻，不再有 A/B 显隐切换。
 *
 *   [A 栏 52px 固定] [B 栏 = 宿主原生 sidebar 槽，宽度由宿主自己决定]
 *
 * A 栏注册进 `shell.overlay`（frame 级唯一的常驻 list 槽），再用 frame 的
 * 左侧 padding 把这一列真正留出来。原生 `sidebar` 槽完全不碰，B 栏继续由
 * 出厂的 SidebarRoot 渲染（新会话 + 工作区 + 底部区）。
 *
 * 为什么不再有「显示模式」：v1 里为了让 B 栏跟随持久化模式，会在启动时调用
 * `ctx.layout.toggleSidebar()`。而宿主把「折叠」记成 sidebar=0，再展开时退回
 * 默认 280px——用户拖过的宽度就丢了。常驻形态不需要这套反向同步，删掉它，
 * B 栏宽度重新完全归宿主管。
 */
window.__ModuleLoader__.load({
  id: 'dsh-two-pane-sidebar',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState, useSyncExternalStore } = React;

    /** 本插件拥有的 locale 命名空间。 */
    const NS = 'twoPane';
    /** 窄栏：只有图标。 */
    const RAIL_NARROW = 52;
    /** 宽栏：图标 + 文字。 */
    const RAIL_WIDE = 208;
    /** 偏好持久化的 key（v2：只存宽窄，不再存显隐）。 */
    const STORAGE_KEY = 'dsh.two-pane-sidebar.v2';
    /** 标记承载三列布局的 frame 元素。 */
    const FRAME_ATTR = 'data-tps-frame';

    /** A 栏挂载的槽：frame 级常驻 list 槽。 */
    const SLOT_RAIL = 'shell.overlay';
    /** 插件导航项的注册表，A 栏内容完全由它驱动。 */
    const SLOT_PANELS = 'sidebar.panellist';

    const zh = {
      'rail.label': '插件栏',
      'rail.expandLabels': '显示文字标签',
      'rail.collapseLabels': '隐藏文字标签'
    };
    const en = {
      'rail.label': 'Plugin bar',
      'rail.expandLabels': 'Show text labels',
      'rail.collapseLabels': 'Hide text labels'
    };

    /** 一次告警绝不能再引发新的异常。 */
    function warn(label, error) {
      try {
        console.warn('[two-pane-sidebar] ' + label, error);
      } catch (_) {
        /* console 不可用就算了 */
      }
    }

    /** 取服务；拿不到就是 undefined，绝不抛。 */
    function service(ctx, name) {
      try {
        if (!ctx) return undefined;
        if (typeof ctx.get === 'function') return ctx.get(name);
        return ctx[name];
      } catch (_) {
        return undefined;
      }
    }

    /**
     * 宿主的 UI primitives 是 loader 的「隐式 baseline external」：任何客户端插件
     * 都能直接 require，不需要写进依赖，也不该打包另一份。这里取它的 Tooltip，
     * 用它取代原生 title 属性——原生 tooltip 是 Chromium 自己画的，样式改不了，
     * 皮肤下会出现白底黑字的系统字体气泡。拿不到就退回 title，不影响功能。
     */
    let primitives = null;
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      warn('primitives unavailable, tooltips fall back to native title', error);
    }
    const Tooltip = primitives && typeof primitives.Tooltip === 'function' ? primitives.Tooltip : null;

    const CSS = [
      '.tps-rail{position:absolute;top:var(--dsh-windows-titlebar-height,0px);bottom:0;left:0;overflow:hidden;',
      'background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);',
      'transition:width 180ms var(--ds-ease-in-out,ease);',
      '}',
      '.tps-railInner{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;',
      'padding:6px;gap:2px}',
      '.tps-list{display:flex;flex-direction:column;gap:2px;min-height:0;overflow-y:auto;overflow-x:hidden;flex:1 1 auto}',
      '.tps-item{position:relative;display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:36px;',
      'padding:7px 8px;border:0;border-radius:var(--dsw-radius-md);background:transparent;',
      // 用 inherit 而不是写死 token：A 栏颜色在运行时跟随原生侧边栏，
      // 皮肤把侧边栏刷成深底浅字时这里能自动对上。
      'color:inherit;font:inherit;text-align:left;cursor:pointer;',
      'transition:background 150ms var(--ds-ease-in-out,ease)}',
      '.tps-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.tps-item:hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
      '.tps-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.tps-item[data-active="true"]{background:color-mix(in srgb,currentColor 14%,transparent)}',
      '.tps-item:focus-visible,.tps-iconBtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
      'var(--dsw-focus-ring-color);outline-offset:-2px}',
      '.tps-mark{position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:1px;',
      'background:var(--dsw-alias-state-business-primary)}',
      '.tps-glyph{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:20px;height:20px}',
      '.tps-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:1.4}',
      '.tps-iconBtn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 auto;',
      'border:0;border-radius:var(--dsw-radius-md);background:transparent;',
      'color:inherit;opacity:.72;cursor:pointer;',
      'transition:background 150ms var(--ds-ease-in-out,ease),opacity 150ms var(--ds-ease-in-out,ease)}',
      '.tps-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);opacity:1}',
      '.tps-iconBtn:hover{background:color-mix(in srgb,currentColor 12%,transparent)}',
      // 文字标签开关：两种宽度下都在 A 栏底部，且都只有图标（不再随宽度变出文字）。
      // 尺寸刻意对齐 `.tps-item`：宽 100%、高 36px、图标 18px，
      // 这样它的可点击热区和上方插件条目的热区完全一致。
      '.tps-labelToggle{flex:0 0 auto;width:100%;height:auto;min-height:36px;padding:7px 8px;',
      'box-sizing:border-box;border-radius:var(--dsw-radius-md);justify-content:center;gap:0}',
      '[data-tps-frame]{transition:padding-left 180ms var(--ds-ease-in-out,ease)}',
      // A 栏常驻，所以原生侧边栏里的导航列表始终收起，条目只出现在 A 栏。
      // 用 class 后缀匹配，因为宿主输出的是 hash 过的模块类名。
      '[data-tps-frame][data-tps-a="on"] nav[class*="_panelList"]{display:none}',
      '@media (prefers-reduced-motion:reduce){',
      '.tps-rail{transition:none}[data-tps-frame]{transition:none}}'
    ].join('');

    const LabelIcon = function LabelIcon(props) {
      const size = (props && props.size) || 16;
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: props && props.style },
        h('path', {
          // open = 当前已展开，箭头朝左表示「收起」；反之朝右表示「展开」。
          d: props && props.open ? 'M10 4.5 6.5 8l3.5 3.5' : 'M6 4.5 9.5 8 6 11.5',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        })
      );
    };

    // ---------------------------------------------------------------------
    // 持久化偏好：只剩「A 栏是否带文字」。
    // ---------------------------------------------------------------------

    function readPrefs() {
      const fallback = { wide: false };
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return fallback;
        return { wide: parsed.wide === true };
      } catch (_) {
        return fallback;
      }
    }

    function writePrefs(state) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (_) {
        /* 隐私模式下只是不持久化，本次会话照常工作 */
      }
    }

    function createPrefs() {
      let state = readPrefs();
      const listeners = new Set();
      return {
        get: () => state,
        set(patch) {
          state = Object.assign({}, state, patch);
          writePrefs(state);
          for (const listener of Array.from(listeners)) {
            try {
              listener();
            } catch (error) {
              warn('listener', error);
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      };
    }

    function usePrefs(prefs) {
      return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
    }

    // ---------------------------------------------------------------------
    // 读取宿主注册表 / DOM 位置
    // ---------------------------------------------------------------------

    /** 实时读取 `sidebar.panellist` 注册表，A 栏内容永不硬编码。 */
    function readPanels(ctx) {
      try {
        const slots = service(ctx, 'slots');
        if (!slots || typeof slots.entriesOfSlot !== 'function') return [];
        const entries = slots.entriesOfSlot(SLOT_PANELS) || [];
        return entries
          .map((entry) => {
            const options = (entry && entry.options) || {};
            const id = options.id;
            const raw = options.label;
            let label = raw;
            if (typeof raw === 'function') {
              try {
                label = raw();
              } catch (_) {
                label = id;
              }
            }
            return { id, order: options.order || 0, label: label || id, component: entry && entry.component };
          })
          .filter((panel) => typeof panel.id === 'string' && panel.id.length > 0)
          .sort((left, right) => left.order - right.order || String(left.id).localeCompare(String(right.id)));
      } catch (error) {
        warn('read panels', error);
        return [];
      }
    }

    function usePanels(ctx) {
      const [panels, setPanels] = useState(() => readPanels(ctx));
      useEffect(() => {
        let disposed = false;
        const sync = () => {
          if (!disposed) setPanels(readPanels(ctx));
        };
        const disposers = [];
        try {
          const slots = service(ctx, 'slots');
          if (slots && typeof slots.subscribe === 'function') {
            const off = slots.subscribe(SLOT_PANELS, sync);
            if (typeof off === 'function') disposers.push(off);
          }
          const locale = service(ctx, 'locale');
          if (locale && typeof locale.subscribe === 'function') {
            const off = locale.subscribe(sync);
            if (typeof off === 'function') disposers.push(off);
          }
        } catch (error) {
          warn('subscribe panels', error);
        }
        sync();
        return () => {
          disposed = true;
          for (const dispose of disposers) {
            try {
              dispose();
            } catch (_) {
              /* 已拆过 */
            }
          }
        };
      }, [ctx]);
      return panels;
    }

    /** 三列布局的宿主 frame。 */
    function frameNow() {
      try {
        const overlay = document.querySelector('[data-shell-overlay]');
        if (overlay && overlay.parentElement) return overlay.parentElement;
        return document.querySelector('[class*="_frame"]') || null;
      } catch (_) {
        return null;
      }
    }

    function makeTranslator(ctx) {
      try {
        const locale = service(ctx, 'locale');
        if (locale && typeof locale.bind === 'function') {
          const bound = locale.bind(NS);
          if (typeof bound === 'function') return bound;
        }
      } catch (error) {
        warn('locale bind', error);
      }
      const dict = Object.assign({}, zh);
      return (key) => (dict[key] === undefined ? key : dict[key]);
    }

    // ---------------------------------------------------------------------
    // 图标
    // ---------------------------------------------------------------------

    /** 拿不到图标时的兜底：一个中性方块轮廓，保证行高和节奏不乱。 */
    function FallbackGlyph(props) {
      const size = (props && props.size) || 16;
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', {
          x: 2.5,
          y: 2.5,
          width: 11,
          height: 11,
          rx: 3,
          stroke: 'currentColor',
          strokeWidth: 1.2,
          opacity: 0.55
        })
      );
    }

    /**
     * 单个图标的错误边界。注册表里任何一个图标组件抛错，都只让那一行退化成
     * 兜底方块，不能把整条 A 栏带崩。
     */
    class GlyphBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        warn('panel glyph', error);
      }
      render() {
        if (this.state.failed) return h(FallbackGlyph, { size: this.props.size });
        return this.props.children;
      }
    }

    /**
     * 渲染一个插件导航项的图标。
     *
     * 宿主只给「自己声明了 children 的 entry」注入 `renderSlot`（见 renderer 的
     * standardKit），A 栏的 entry 没有子槽，所以 props.renderSlot 通常是 undefined。
     * 因此两条路：有 renderSlot 走官方槽渲染，没有就直接渲染该 entry 自己的组件
     * ——这些图标组件是纯 SVG，只吃 size / active。
     */
    function renderGlyph(options) {
      const { renderSlot, panel, size, active, slotKey } = options;

      if (typeof renderSlot === 'function') {
        try {
          const element = renderSlot(slotKey, { size, active }, { only: panel.id });
          if (element !== null && element !== undefined) return element;
        } catch (error) {
          warn('render glyph via slot ' + panel.id, error);
        }
      }

      const Comp = panel.component;
      if (typeof Comp === 'function' || (Comp && typeof Comp === 'object')) {
        return h(GlyphBoundary, { size }, h(Comp, { size, active }));
      }

      return h(FallbackGlyph, { size });
    }

    // ---------------------------------------------------------------------
    // A 栏
    // ---------------------------------------------------------------------

    const noPanelInfo = () => null;

    /**
     * 给一个图标控件套上宿主的 Tooltip。
     *
     * `portal: true` 是必须的：A 栏有 `overflow: hidden`（窄栏要裁掉超出部分），
     * 就地渲染的气泡会被裁掉。挂到 portal 上还能避开 overlay 层的层叠顺序。
     * 拿不到 Tooltip 时原样返回，控件自己带 title 兜底。
     */
    function withTooltip(element, label) {
      if (!Tooltip || !label) return element;
      return h(Tooltip, { label, side: 'right', align: 'center', delayMs: 260, gap: 8, portal: true }, element);
    }

    function RailItem(props) {
      const { label, active, wide, glyph } = props;
      const button = h(
        'button',
        {
          type: 'button',
          className: 'tps-item',
          'data-active': active ? 'true' : 'false',
          'aria-current': active ? 'page' : undefined,
          'aria-label': label,
          // 宽栏已经把文字显示出来了；有 Tooltip 时也不该再挂原生 title，
          // 否则会出现系统气泡和主题气泡同时冒出来。
          title: wide || Tooltip ? undefined : label,
          onClick: props.onSelect
        },
        active ? h('span', { className: 'tps-mark', 'aria-hidden': true }) : null,
        h('span', { className: 'tps-glyph', 'aria-hidden': true }, glyph),
        wide ? h('span', { className: 'tps-title' }, label) : null
      );
      return wide ? button : withTooltip(button, label);
    }

    function makeRail(ctx, prefs) {
      const t = makeTranslator(ctx);

      return function TwoPaneRail(props) {
        const pref = usePrefs(prefs);
        const panels = usePanels(ctx);
        const usePanelInfo = props && typeof props.usePanelInfo === 'function' ? props.usePanelInfo : noPanelInfo;
        const renderSlot = props && typeof props.renderSlot === 'function' ? props.renderSlot : null;
        const activeId = usePanelInfo((info) => (info ? info.activePanelId : null));
        const hostRef = useRef(null);
        const innerRef = useRef(null);
        const frameRef = useRef(null);

        const wide = pref.wide;
        // 常驻：宽度只由「是否带文字」决定，不再有显隐分支。
        const width = wide ? RAIL_WIDE : RAIL_NARROW;

        // 在宿主 frame 上预留这一列的宽度。这是与出厂布局唯一的 DOM 接触点：
        // frame 自己是 grid 的所有者，加左侧 padding 是唯一能在不替换
        // SidebarRoot React 树的前提下腾出第二列的办法。React 不写 paddingLeft，
        // 所以这个值能扛住重渲染；下面的 cleanup 负责在禁用时还原。
        useEffect(() => {
          let frame = null;
          try {
            const node = hostRef.current;
            const overlay = node && typeof node.closest === 'function' ? node.closest('[data-shell-overlay]') : null;
            frame = overlay ? overlay.parentElement : frameNow();
          } catch (error) {
            warn('locate frame', error);
          }
          if (!frame) return undefined;
          frameRef.current = frame;
          const raf = requestAnimationFrame(() => {
            try {
              frame.setAttribute(FRAME_ATTR, '');
            } catch (_) {
              /* 元素已卸载 */
            }
          });
          return () => {
            cancelAnimationFrame(raf);
            frameRef.current = null;
            try {
              frame.removeAttribute(FRAME_ATTR);
              frame.removeAttribute('data-tps-a');
              frame.style.paddingLeft = '';
              frame.style.removeProperty('--tps-rail-w');
            } catch (_) {
              /* 元素已卸载 */
            }
          };
        }, []);

        useEffect(() => {
          const frame = frameRef.current;
          if (!frame) return;
          try {
            frame.style.paddingLeft = width + 'px';
            frame.style.setProperty('--tps-rail-w', width + 'px');
            frame.setAttribute('data-tps-a', 'on');
          } catch (error) {
            warn('reserve column', error);
          }
        }, [width]);

        // 跟随宿主侧边栏的实际外观。
        //
        // 皮肤插件是用 `[class*=sidebarCol]` 给原生侧边栏那一列铺底色和纹理的
        // （女仆皮肤就是 background:#0a173b 加两层渐变），而 A 栏在它左侧、
        // 不在那个选择器范围内，只能拿到主题的默认 token——于是深色皮肤下会变成
        // 一块浅色板、图标变深色。这里直接读原生列的计算样式复制过来：
        // 皮肤换成什么样 A 栏就是什么样，不需要为每个皮肤单独适配。
        useEffect(() => {
          const rail = hostRef.current;
          const inner = innerRef.current;
          if (!rail) return undefined;

          const apply = () => {
            try {
              const column = document.querySelector('[class*="sidebarCol"]');
              if (!column || (typeof column.contains === 'function' && column.contains(rail))) return;
              const columnStyle = getComputedStyle(column);

              if (columnStyle.backgroundColor && columnStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                rail.style.backgroundColor = columnStyle.backgroundColor;
              }
              if (columnStyle.backgroundImage && columnStyle.backgroundImage !== 'none') {
                rail.style.backgroundImage = columnStyle.backgroundImage;
              }

              const face = column.querySelector('[class*="_root"]') || column.firstElementChild;
              if (face) {
                const faceStyle = getComputedStyle(face);
                if (faceStyle.color) rail.style.color = faceStyle.color;
              }

              // 纹理通常画在列内第一层 div 上，尺寸/位置/重复方式要一起搬，
              // 否则渐变会被拉伸得不成样子。
              const holder = column.firstElementChild;
              if (inner && holder) {
                const holderStyle = getComputedStyle(holder);
                if (holderStyle.backgroundImage && holderStyle.backgroundImage !== 'none') {
                  inner.style.backgroundImage = holderStyle.backgroundImage;
                  inner.style.backgroundSize = holderStyle.backgroundSize;
                  inner.style.backgroundPosition = holderStyle.backgroundPosition;
                  inner.style.backgroundRepeat = holderStyle.backgroundRepeat;
                }
              }
            } catch (error) {
              warn('sync sidebar chrome', error);
            }
          };

          apply();

          // 换肤 / 切深浅色都会改 body 上的标记属性，跟着重算一次。
          let observer = null;
          try {
            observer = new MutationObserver(apply);
            observer.observe(document.body, {
              attributes: true,
              attributeFilter: ['class', 'data-dsh-maid-atelier', 'data-ds-dark-theme', 'data-theme']
            });
          } catch (error) {
            warn('observe theme', error);
          }

          return () => {
            try {
              if (observer) observer.disconnect();
            } catch (_) {
              /* 已断开 */
            }
          };
        }, []);

        const items = panels.map((panel) => {
          const isActive = panel.id === activeId;
          const glyph = renderGlyph({
            renderSlot,
            panel,
            size: wide ? 16 : 18,
            active: isActive,
            slotKey: SLOT_PANELS
          });
          return h(RailItem, {
            key: panel.id,
            id: panel.id,
            label: panel.label,
            wide,
            active: isActive,
            glyph,
            onSelect: () => {
              try {
                const layout = service(ctx, 'layout');
                if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(panel.id);
              } catch (error) {
                warn('open panel ' + panel.id, error);
              }
            }
          });
        });

        return h(
          React.Fragment,
          null,
          h('style', { key: 'css' }, CSS),
          h(
            'div',
            { key: 'rail', ref: hostRef, className: 'tps-rail', style: { width } },
            h(
              'div',
              { className: 'tps-railInner', ref: innerRef, style: { width } },
              h('nav', { className: 'tps-list', 'aria-label': t('rail.label') }, items),
              // 文字标签开关：两种宽度下都在 A 栏底部，且都只显示图标。
              // 放在 nav 外面，这样列表变长滚动时它不会被一起推走。
              withTooltip(
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tps-iconBtn tps-labelToggle',
                    'aria-label': wide ? t('rail.collapseLabels') : t('rail.expandLabels'),
                    'aria-expanded': wide ? 'true' : 'false',
                    title: Tooltip ? undefined : wide ? t('rail.collapseLabels') : t('rail.expandLabels'),
                    onClick: () => prefs.set({ wide: !wide })
                  },
                  h(LabelIcon, { open: wide, size: wide ? 16 : 18 })
                ),
                wide ? t('rail.collapseLabels') : t('rail.expandLabels')
              )
            )
          )
        );
      };
    }

    // ---------------------------------------------------------------------

    return {
      // 只声明确实存在、且本插件必需的服务。layout 走可选获取，
      // 免得它哪天被关掉时本 entry 卡在 pending 把启动拖死。
      inject: ['slots', 'locale'],
      apply(ctx) {
        const prefs = createPrefs();

        try {
          const locale = service(ctx, 'locale');
          if (locale && typeof locale.register === 'function') {
            ctx.effect(() => locale.register(NS, { zh, en }), 'two-pane-sidebar: dictionaries');
          }
        } catch (error) {
          warn('register dictionaries', error);
        }

        // 真正的接线放进 ctx.inject 派生的子 fiber：即使某个服务缺席，也只是
        // 这个子 fiber 待命，本 entry 仍然是 active，启动不受影响。
        const wire = (c) => {
          try {
            const slots = service(c, 'slots');
            if (!slots || typeof slots.register !== 'function') {
              warn('slots service unavailable, rail stays off');
              return;
            }

            const Rail = makeRail(c, prefs);

            // 宿主里的第三方插件一律这样投递：先 inject 到目标槽，再在回调里 register。
            const contribute = (slotKey, options, Component) => {
              const run = () => slots.register(options, Component);
              return typeof slots.inject === 'function' ? slots.inject(slotKey, run) : run();
            };

            const disposers = [];
            try {
              disposers.push(contribute(SLOT_RAIL, { name: SLOT_RAIL, id: 'two-pane-sidebar.rail', order: 0 }, Rail));
            } catch (error) {
              warn('register rail slot', error);
            }

            try {
              c.effect(
                () => () => {
                  for (const dispose of disposers.splice(0)) {
                    try {
                      if (typeof dispose === 'function') dispose();
                    } catch (_) {
                      /* 已拆过 */
                    }
                  }
                },
                'two-pane-sidebar: registrations'
              );
            } catch (error) {
              warn('dispose registration', error);
            }
          } catch (error) {
            warn('wiring failed', error);
          }
        };

        try {
          if (typeof ctx.inject === 'function') ctx.inject(['slots'], wire);
          else wire(ctx);
        } catch (error) {
          warn('defer wiring', error);
        }
      }
    };
  }
});
