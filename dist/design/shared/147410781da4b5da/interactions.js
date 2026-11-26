/* 天枢画布交互库运行时。
   单一共享运行时：按 data-ts-* 根属性存在性初始化各交互；未用到的交互不会执行任何逻辑。
   沙箱约束（画布 iframe 与导出站均已满足）：
     - 只用内存状态，绝不读写浏览器持久化存储（opaque origin 下会抛安全异常）；
     - 绝不发起网络请求（页面 CSP 已禁止 connect）；
     - 不引用任何外部脚本/字体/图片。
   本脚本由工具在写入页面时内联注入（或导出为独立资源文件），请勿手动引入外链版本。 */
(function () {
  'use strict';
  if (window.__tianshu_interactions__) return;
  window.__tianshu_interactions__ = true;

  var ACTIVE_MODAL = null;
  var overlayStack = [];
  var tabSequence = 0;
  var formActions = new WeakMap();

  /* 焦点陷阱：Tab / Shift+Tab 在容器内循环；容器内无可聚焦项时保持焦点在容器上。
     用 inert 优先（支持时浏览器自己阻止背景交互），否则回退到纯 Tab 循环。 */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(root) {
    return qsa(root, FOCUSABLE).filter(function (el) {
      return !el.hasAttribute('inert') && el.getClientRects().length > 0;
    });
  }

  function trapFocus(container, event) {
    if (event.key !== 'Tab') return;
    var items = focusables(container);
    if (!items.length) { event.preventDefault(); return; }
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  /* 打开浮层时把页面其余部分设为 inert（不支持时只做 Tab 循环）。
     同时打开的浮层可能不止一个，所以按「所有者」记账，各自关闭时只撤销自己的影响。 */
  var inertOwners = [];

  function refreshBackgroundInert() {
    if (typeof document.body.setAttribute !== 'function') return;
    var children = Array.prototype.slice.call(document.body.children);
    children.forEach(function (el) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      var owned = inertOwners.some(function (owner) { return owner === el || el.contains(owner); });
      if (inertOwners.length && !owned) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  function setBackgroundInert(active) {
    if (!active) { inertOwners = []; refreshBackgroundInert(); return; }
    if (inertOwners.indexOf(active) === -1) inertOwners.push(active);
    refreshBackgroundInert();
  }

  function clearBackgroundInert(active) {
    var index = inertOwners.indexOf(active);
    if (index !== -1) inertOwners.splice(index, 1);
    refreshBackgroundInert();
  }

  /* 共享无障碍播报区：状态变化写入 aria-live，不抢焦点。 */
  function announce(text, assertive) {
    var region = document.getElementById('ts-i-announcer');
    if (!region) {
      region = document.createElement('div');
      region.id = 'ts-i-announcer';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      region.className = 'ts-i-visually-hidden';
      document.body.appendChild(region);
    }
    region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    region.textContent = '';
    window.setTimeout(function () { region.textContent = text; }, 16);
  }

  /* 指针手势：单一 activePointer，第二个指针出现时不夺取（第一个手势保持自己的 pointer）。
     pointercancel / lostpointercapture / 窗口失焦 一律走 onCancel，清掉状态并释放 capture，
     此后下一次手势无需刷新即可工作。
     follow: true 用于「悬停跟随」类手势（如 tilt-card）：无需按下即跟随第一个指针；
       鼠标抬起仍保持跟随，触摸/笔抬起与离场视为结束并复位。
     非 follow 是标准拖拽语义：pointerdown 才激活，pointerup 结束。 */
  function bindPointerDrag(el, handlers) {
    var opts = handlers || {};
    var activeId = null;
    var captured = false;

    function end(event) {
      if (activeId === null) return;
      if (event && event.pointerId !== undefined && event.pointerId !== activeId) return;
      var id = activeId;
      activeId = null;
      if (captured) {
        captured = false;
        try { if (el.releasePointerCapture) el.releasePointerCapture(id); } catch (e) { /* 已释放 */ }
      }
      if (opts.onEnd) opts.onEnd(event);
    }

    function cancel(event) {
      if (activeId === null) return;
      if (event && event.pointerId !== undefined && event.pointerId !== activeId) return;
      end(event);
      if (opts.onCancel) opts.onCancel(event);
    }

    function adopt(event, capture) {
      activeId = event.pointerId;
      if (capture) {
        try {
          if (el.setPointerCapture) { el.setPointerCapture(activeId); captured = true; }
        } catch (e) { captured = false; /* 合成指针或不支持捕获 */ }
      }
      if (opts.onStart) opts.onStart(event);
    }

    el.addEventListener('pointerdown', function (event) {
      if (activeId !== null) return; /* 第二个指针：不夺取 */
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      /* 跟随类手势不夺取捕获：指针捕获会屏蔽后续 pointerleave，导致离场复位失效。 */
      adopt(event, !opts.follow);
    });
    el.addEventListener('pointermove', function (event) {
      if (activeId === null) {
        if (!opts.follow) return;
        adopt(event, false);
      } else if (event.pointerId !== activeId) {
        return; /* 第二个指针不夺取 */
      }
      if (opts.onMove) opts.onMove(event);
    });
    el.addEventListener('pointerup', function (event) {
      /* 悬停跟随：鼠标抬起不结束；触摸/笔抬起结束并复位。 */
      if (opts.follow && event.pointerType === 'mouse') return;
      if (opts.follow) cancel(event);
      else end(event);
    });
    el.addEventListener('pointercancel', function (event) { cancel(event); });
    el.addEventListener('lostpointercapture', function (event) { cancel(event); });
    window.addEventListener('blur', function () { cancel(null); });
    /* 供跟随类手势在指针离场时主动复位（离场不是取消，但仍要回正）。 */
    return { cancel: function () { cancel(null); } };
  }

  function qsa(root, sel) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function owned(root, sel, boundary) {
    return qsa(root, sel).filter(function (element) { return element.closest(boundary) === root; });
  }

  function emit(el, name, detail) {
    try {
      el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
    } catch (e) { /* CustomEvent 不可用时静默 */ }
  }

  /* ---------------- tabs ---------------- */

  function initTabs(root) {
    var tabs = qsa(root, '[data-ts-tab]').filter(function (tab) { return tab.closest('[data-ts-tabs]') === root; });
    var panels = qsa(root, '[data-ts-panel]').filter(function (panel) { return panel.closest('[data-ts-tabs]') === root; });
    if (!tabs.length) return;
    if (!root.id) {
      do { root.id = 'ts-tabs-' + (++tabSequence); } while (document.querySelectorAll('[id="' + root.id + '"]').length > 1);
    }
    tabs.forEach(function (tab, index) {
      var name = tab.getAttribute('data-ts-tab');
      var panel = panels.find(function (item) { return item.getAttribute('data-ts-panel') === name; });
      if (!tab.id) tab.id = root.id + '-tab-' + index;
      if (panel) {
        if (!panel.id) panel.id = root.id + '-panel-' + index;
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('aria-labelledby', tab.id);
      }
    });

    function activate(name, focus) {
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].getAttribute('data-ts-tab') === name;
        tabs[i].classList.toggle('ts-tab--active', on);
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        tabs[i].setAttribute('tabindex', on ? '0' : '-1');
        if (on) {
          if (focus) tabs[i].focus();
        }
      }
      for (var j = 0; j < panels.length; j++) {
        var show = panels[j].getAttribute('data-ts-panel') === name;
        panels[j].hidden = !show;
      }
      emit(root, 'ts:change', { value: name });
    }

    for (var i = 0; i < tabs.length; i++) {
      (function (tab, index) {
        tab.addEventListener('click', function () { activate(tab.getAttribute('data-ts-tab'), false); });
        tab.addEventListener('keydown', function (e) {
          var key = e.key;
          var next = -1;
          if (key === 'ArrowRight' || key === 'ArrowDown') next = (index + 1) % tabs.length;
          else if (key === 'ArrowLeft' || key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
          else if (key === 'Home') next = 0;
          else if (key === 'End') next = tabs.length - 1;
          if (next >= 0) {
            e.preventDefault();
            activate(tabs[next].getAttribute('data-ts-tab'), true);
          }
        });
      })(tabs[i], i);
    }

    var initial = null;
    for (var k = 0; k < tabs.length; k++) {
      if (tabs[k].classList.contains('ts-tab--active')) { initial = tabs[k].getAttribute('data-ts-tab'); break; }
    }
    activate(initial || tabs[0].getAttribute('data-ts-tab'), false);
  }

  /* ---------------- modal / drawer（共用开关协议） ---------------- */

  function openOverlay(el, openClass) {
    if (!el) return;
    /* initOverlays 对 modal 与 drawer 各跑一遍，同一触发按钮会绑两次；
       已经在栈里的浮层不重复打开，否则关闭一次后背景 inert 撤不掉。 */
    for (var s = 0; s < overlayStack.length; s++) {
      if (overlayStack[s].el === el) return;
    }
    var opener = document.activeElement;
    el.hidden = false;
    el.classList.add(openClass);
    el.setAttribute('aria-hidden', 'false');
    /* 模态语义：dialog 角色 + aria-modal，读屏据此把背景当作不可用。 */
    if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
    if (el.getAttribute('role') === 'dialog') el.setAttribute('aria-modal', 'true');
    overlayStack.push({ el: el, opener: opener, openClass: openClass });
    ACTIVE_MODAL = el;
    setBackgroundInert(el);
    var items = focusables(el);
    if (items.length) items[0].focus();
    else { el.setAttribute('tabindex', '-1'); el.focus(); }
    /* 焦点陷阱：只在最上层浮层内循环，Tab 不会跑到页面背景。只绑一次，重复开合不叠加。 */
    if (!el.hasAttribute('data-ts-trap-bound')) {
      el.setAttribute('data-ts-trap-bound', '');
      el.addEventListener('keydown', function (event) { trapFocus(el, event); });
    }
    emit(el, 'ts:open', null);
  }

  function closeOverlay(el, openClass) {
    if (!el) return;
    el.classList.remove(openClass);
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    var entry = null;
    for (var i = overlayStack.length - 1; i >= 0; i--) {
      if (overlayStack[i].el === el) { entry = overlayStack[i]; overlayStack.splice(i, 1); break; }
    }
    if (ACTIVE_MODAL === el) ACTIVE_MODAL = overlayStack.length ? overlayStack[overlayStack.length - 1].el : null;
    if (overlayStack.length === 0) setBackgroundInert(null);
    var opener = entry ? entry.opener : null;
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) { try { opener.focus(); } catch (e) {} }
    emit(el, 'ts:close', null);
  }

  /* 外部点击关闭：点在浮层与其触发按钮之外的合成路径上才关。 */
  function bindOutsideClick(el, openClass, shouldStay) {
    document.addEventListener('click', function (event) {
      if (el.hidden || el.contains(event.target)) return;
      if (shouldStay && shouldStay(event.target)) return;
      closeOverlay(el, openClass);
    });
  }

  function initOverlays(selector, openClass) {
    qsa(document, selector).forEach(function (el) {
      el.setAttribute('aria-hidden', el.hidden ? 'true' : 'false');
    });
    qsa(document, '[data-ts-open]').forEach(function (trigger) {
      /* initOverlays 对 modal / drawer 各调一次，触发按钮只能绑一次，否则一次点击打开两层。 */
      if (trigger.hasAttribute('data-ts-open-bound')) return;
      trigger.setAttribute('data-ts-open-bound', '');
      /* aria-controls 让读屏知道这个按钮控制哪个浮层。 */
      var controlsId = (trigger.getAttribute('data-ts-open') || '').replace(/^#/, '');
      if (controlsId && document.getElementById(controlsId)) trigger.setAttribute('aria-controls', controlsId);
      trigger.addEventListener('click', function () {
        var id = (trigger.getAttribute('data-ts-open') || '').replace(/^#/, '');
        var target = id ? document.getElementById(id) : null;
        if (target) openOverlay(target, target.hasAttribute('data-ts-drawer') ? 'ts-i-drawer--open' : 'ts-i-modal--open');
      });
    });
    qsa(document, selector).forEach(function (el) {
      bindOutsideClick(el, el.hasAttribute('data-ts-drawer') ? 'ts-i-drawer--open' : 'ts-i-modal--open', function (node) {
        /* 触发按钮自己会 toggle，不重复处理。 */
        return !!(node.closest && node.closest('[data-ts-open]'));
      });
    });
    qsa(document, selector + ' [data-ts-close]').forEach(function (closer) {
      closer.addEventListener('click', function () {
        var el = closer.closest(selector);
        if (el) closeOverlay(el, el.hasAttribute('data-ts-drawer') ? 'ts-i-drawer--open' : 'ts-i-modal--open');
      });
    });
  }

  function closeActiveOverlay() {
    if (!ACTIVE_MODAL) return;
    if (ACTIVE_MODAL.hasAttribute('data-ts-drawer')) closeOverlay(ACTIVE_MODAL, 'ts-i-drawer--open');
    else closeOverlay(ACTIVE_MODAL, 'ts-i-modal--open');
  }

  /* ---------------- dropdown ---------------- */

  function initDropdown(root) {
    var trigger = root.querySelector('.ts-i-dropdown__trigger');
    var menu = root.querySelector('.ts-i-dropdown__menu');
    if (!trigger || !menu) return;
    var items = qsa(menu, '.ts-i-dropdown__item');
    if (!menu.id) menu.id = 'ts-i-dropdown-menu-' + (++tabSequence);
    if (!menu.hasAttribute('role')) menu.setAttribute('role', 'menu');
    trigger.setAttribute('aria-controls', menu.id);
    if (!trigger.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-haspopup', 'menu');
    items.forEach(function (item, index) {
      item.setAttribute('role', 'menuitem');
      if (!item.id) item.id = menu.id + '-item-' + index;
    });

    function setOpen(open, focusItem) {
      root.classList.toggle('ts-i-dropdown--open', open);
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && items.length) {
        if (focusItem) {
          items[0].focus();
          trigger.setAttribute('aria-activedescendant', items[0].id);
        }
      } else {
        trigger.removeAttribute('aria-activedescendant');
      }
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(menu.hidden, false);
    });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true, true); }
    });
    items.forEach(function (item, index) {
      item.addEventListener('click', function () { setOpen(false, false); emit(root, 'ts:select', { index: index }); });
      item.addEventListener('keydown', function (e) {
        var next = -1;
        if (e.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        else if (e.key === 'Escape') { e.preventDefault(); setOpen(false, false); trigger.focus(); return; }
        if (next >= 0) { e.preventDefault(); items[next].focus(); trigger.setAttribute('aria-activedescendant', items[next].id); }
      });
    });
    /* 外部点击关闭：点在下拉与其触发按钮之外才关。 */
    document.addEventListener('click', function (event) {
      if (menu.hidden || root.contains(event.target)) return;
      setOpen(false, false);
    });
    setOpen(false, false);
  }

  /* ---------------- tooltip：真实气泡 + aria-describedby ---------------- */

  /* 纯 CSS 的 ::after 气泡读屏不可见。运行时把它升级为真实元素：
     生成 role="tooltip" 的气泡并把触发元素用 aria-describedby 连过去。
     文本仍以 data-ts-tooltip 为唯一来源；升级后给根加 data-ts-tip-runtime，
     CSS 据此关掉 ::after，避免视觉与读屏各读一遍。 */
  function initTooltips() {
    qsa(document, '[data-ts-tooltip]').forEach(function (root) {
      var text = root.getAttribute('data-ts-tooltip') || '';
      if (!text.trim()) return;
      var bubble = root.querySelector('.ts-i-tooltip__bubble');
      if (!bubble) {
        bubble = document.createElement('span');
        bubble.className = 'ts-i-tooltip__bubble';
        root.appendChild(bubble);
      }
      if (!bubble.id) bubble.id = 'ts-i-tip-' + (++tabSequence);
      bubble.setAttribute('role', 'tooltip');
      bubble.textContent = text;
      root.setAttribute('data-ts-tip-runtime', '');
      /* 触发元素：优先用可聚焦的子元素（按钮/链接），否则让根自己可聚焦。 */
      var trigger = root.querySelector('button, a[href], input, select, textarea, [tabindex]') || root;
      if (trigger === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
      var existing = (trigger.getAttribute('aria-describedby') || '').trim();
      if (existing.split(/\s+/).indexOf(bubble.id) === -1) {
        trigger.setAttribute('aria-describedby', (existing ? existing + ' ' : '') + bubble.id);
      }
    });
  }

  /* ---------------- accordion（单开模式） ---------------- */

  function initAccordion(root) {
    if (!root.hasAttribute('data-ts-single')) return;
    var items = qsa(root, 'details.ts-i-accordion__item');
    items.forEach(function (item) {
      item.addEventListener('toggle', function () {
        if (!item.open) return;
        items.forEach(function (other) { if (other !== item) other.open = false; });
      });
    });
  }

  /* ---------------- toast ---------------- */

  function dismissToast(el) {
    if (!el || el.getAttribute('data-ts-dismissed')) return;
    el.setAttribute('data-ts-dismissed', '1');
    el.style.opacity = '0';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 180);
  }

  function armToast(el) {
    var raw = el.getAttribute('data-ts-toast-duration');
    var duration = raw === null ? 4000 : parseInt(raw, 10);
    if (!duration || duration <= 0) return;
    setTimeout(function () { dismissToast(el); }, duration);
  }

  function initToasts() {
    qsa(document, '[data-ts-toast-region]').forEach(function (region) {
      /* 区域本身是 live region；单个 toast 不再重复声明，避免重复播报。 */
      if (!region.hasAttribute('role')) region.setAttribute('role', 'status');
      if (!region.hasAttribute('aria-live')) region.setAttribute('aria-live', 'polite');
    });
    qsa(document, '[data-ts-toast-region] .ts-toast').forEach(function (el) {
      /* 错误必须打断当前播报；成功/提示用 status 即可。 */
      if (el.classList.contains('ts-toast--danger') || el.classList.contains('ts-toast--error')) {
        el.setAttribute('role', 'alert');
        el.setAttribute('aria-live', 'assertive');
      }
      armToast(el);
      var closer = el.querySelector('[data-ts-toast-dismiss]');
      if (closer) closer.addEventListener('click', function () { dismissToast(el); });
      /* 悬停或聚焦时暂停自动消失，让用户读完（也避免焦点落在即将被删的节点上）。 */
      var paused = false;
      el.addEventListener('mouseenter', function () { paused = true; });
      el.addEventListener('mouseleave', function () { paused = false; });
      el.addEventListener('focusin', function () { paused = true; });
      el.addEventListener('focusout', function () { paused = false; });
      var raw = el.getAttribute('data-ts-toast-duration');
      var duration = raw === null ? 4000 : parseInt(raw, 10);
      var tick = null;
      if (duration && duration > 0) {
        var elapsed = 0;
        tick = window.setInterval(function () {
          if (paused) return;
          elapsed += 100;
          if (elapsed >= duration) { window.clearInterval(tick); dismissToast(el); }
        }, 100);
      }
      /* Esc 关闭与自动消失无关：不会自动消失的 toast 也要能用键盘关掉。 */
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); if (tick) window.clearInterval(tick); dismissToast(el); }
      });
    });
  }

  window.tsToast = function (text, variant, duration) {
    var region = document.querySelector('[data-ts-toast-region]');
    if (!region) {
      region = document.createElement('div');
      region.className = 'ts-i-toast-region';
      region.setAttribute('data-ts-toast-region', '');
      region.setAttribute('data-ts-position', 'top-right');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    var el = document.createElement('div');
    el.className = 'ts-toast' + (variant ? ' ts-toast--' + variant : '');
    /* 动态创建的 toast 与静态骨架走同一语义：错误用 alert 打断播报。 */
    if (variant === 'danger' || variant === 'error') {
      el.setAttribute('role', 'alert');
      el.setAttribute('aria-live', 'assertive');
    }
    el.textContent = text;
    var closer = document.createElement('button');
    closer.className = 'ts-i-toast-close';
    closer.setAttribute('data-ts-toast-dismiss', '');
    closer.setAttribute('aria-label', '关闭');
    closer.textContent = '\u00d7';
    el.appendChild(closer);
    closer.addEventListener('click', function () { dismissToast(el); });
    region.appendChild(el);
    if (duration !== 0) { el.setAttribute('data-ts-toast-duration', String(duration || 4000)); }
    armToast(el);
    return el;
  };

  /* ---------------- progress（仅刷新确定值） ---------------- */

  window.tsProgress = function (el, value) {
    if (!el) return;
    var bar = el.querySelector('.ts-progress__bar');
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    if (bar) bar.style.width = v + '%';
    el.setAttribute('aria-valuenow', String(v));
  };

  /* ---------------- form-validation ---------------- */

  // Sandboxed pages deliberately lack allow-forms. Handle user intent before
  // the browser attempts submission; no network or navigation is enabled.
  function bindFormAction(form, action) {
    if (formActions.has(form)) { formActions.get(form).push(action); return; }
    var actions = [action];
    formActions.set(form, actions);
    function run() { actions.forEach(function (callback) { callback(); }); }
    form.addEventListener('submit', function (event) { event.preventDefault(); run(); });
    form.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('button, input[type="submit"], input[type="image"]');
      if (event.defaultPrevented || !button || button.form !== form || button.matches(':disabled') || button.type !== 'submit') return;
      event.preventDefault();
      run();
    });
    form.addEventListener('keydown', function (event) {
      var input = event.target;
      if (event.defaultPrevented || event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || input.tagName !== 'INPUT' || input.form !== form || input.matches(':disabled')) return;
      if (!/^(?:text|search|url|tel|email|password|date|month|week|time|datetime-local|number)$/.test(input.type)) return;
      var submitter = Array.prototype.find.call(form.elements, function (element) { return /^(?:submit|image)$/.test(element.type); });
      if (submitter && submitter.matches(':disabled')) return;
      event.preventDefault();
      run();
    });
  }

  function initForms() {
    qsa(document, '[data-ts-form]').forEach(function (form) {
      var controls = qsa(form, 'input, select, textarea');

      function fieldOf(control) { return control.closest('.ts-i-form__field'); }

      function validateControl(control) {
        var field = fieldOf(control);
        if (!field) return control.checkValidity();
        var error = field.querySelector('.ts-i-form__error');
        var ok = control.checkValidity();
        if (error) {
          if (!error.id) error.id = 'ts-i-form-error-' + (++tabSequence);
          error.setAttribute('role', 'alert');
          error.setAttribute('aria-live', 'assertive');
        }
        if (ok) {
          field.removeAttribute('data-ts-invalid');
          control.removeAttribute('aria-invalid');
          control.removeAttribute('aria-describedby');
          if (error) { error.textContent = ''; error.classList.remove('ts-i-form__error--show'); }
          return true;
        }
        var message = control.getAttribute('data-ts-error') || control.validationMessage || '此项无效';
        field.setAttribute('data-ts-invalid', '');
        /* 同时写标准 ARIA：读屏据此播报错误，且与视觉错误一一对应。 */
        control.setAttribute('aria-invalid', 'true');
        if (error) {
          error.textContent = message;
          error.classList.add('ts-i-form__error--show');
          control.setAttribute('aria-describedby', error.id);
        }
        return false;
      }

      controls.forEach(function (control) {
        control.addEventListener('blur', function () { validateControl(control); });
        control.addEventListener('input', function () {
          var field = fieldOf(control);
          if (field && field.hasAttribute('data-ts-invalid')) validateControl(control);
        });
      });

      bindFormAction(form, function () {
        var firstBad = null;
        controls.forEach(function (control) {
          if (!validateControl(control) && !firstBad) firstBad = control;
        });
        if (firstBad) { firstBad.focus(); return; }
        var data;
        try { data = new FormData(form); } catch (err) { data = null; }
        emit(form, 'ts:form-valid', data);
      });
    });
  }

  /* ---------------- segmented ---------------- */

  function initSegmented(root) {
    var items = qsa(root, '.ts-i-segmented__item');
    if (!items.length) return;

    function select(index, focus) {
      items.forEach(function (item, i) {
        var on = i === index;
        item.classList.toggle('ts-i-segmented__item--active', on);
        item.setAttribute('aria-checked', on ? 'true' : 'false');
        item.setAttribute('tabindex', on ? '0' : '-1');
        if (on && focus) item.focus();
      });
      emit(root, 'ts:change', { value: items[index].getAttribute('data-ts-value') });
    }

    items.forEach(function (item, index) {
      item.addEventListener('click', function () { select(index, false); });
      item.addEventListener('keydown', function (e) {
        var next = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        if (next >= 0) { e.preventDefault(); select(next, true); }
      });
    });

    var active = items.findIndex(function (item) { return item.classList.contains('ts-i-segmented__item--active'); });
    select(active >= 0 ? active : 0, false);
  }

  /* ---------------- switch ---------------- */

  function initSwitches() {
    qsa(document, '[data-ts-switch]').forEach(function (el) {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'switch');
      function toggle() {
        var on = !el.classList.contains('ts-switch--on');
        el.classList.toggle('ts-switch--on', on);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
        emit(el, 'ts:change', on);
      }
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      });
    });
  }

  /* ---------------- stepper ---------------- */

  function renderStepper(el, current) {
    var steps = qsa(el, '.ts-i-stepper__step');
    steps.forEach(function (step) {
      var n = parseInt(step.getAttribute('data-ts-step'), 10);
      step.classList.toggle('ts-i-stepper__step--done', n < current);
      step.classList.toggle('ts-i-stepper__step--active', n === current);
      /* aria-current 只在当前步出现；写 "false" 虽合法但会污染读屏输出。 */
      if (n === current) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  }

  window.tsStepper = function (el, current) {
    if (!el) return;
    el.setAttribute('data-ts-current', String(current));
    renderStepper(el, current);
  };

  function initSteppers() {
    qsa(document, '[data-ts-stepper]').forEach(function (el) {
      var current = parseInt(el.getAttribute('data-ts-current') || '1', 10);
      renderStepper(el, current);
    });
  }

  /* ---------------- pagination ---------------- */

  function initPagination(root) {
    var total = parseInt(root.getAttribute('data-ts-total') || '1', 10);
    var current = parseInt(root.getAttribute('data-ts-page') || '1', 10);
    var prev = owned(root, '[data-ts-page-prev]', '[data-ts-pagination]')[0];
    var next = owned(root, '[data-ts-page-next]', '[data-ts-pagination]')[0];
    var nums = owned(root, '.ts-i-pagination__item', '[data-ts-pagination]');

    function render(page) {
      total = Math.max(1, parseInt(root.getAttribute('data-ts-total') || '1', 10) || 1);
      current = Math.max(1, Math.min(total, Number.isFinite(page) ? page : 1));
      root.setAttribute('data-ts-page', String(current));
      nums.forEach(function (btn) {
        var on = parseInt(btn.textContent, 10) === current;
        btn.classList.toggle('ts-i-pagination__item--active', on);
        if (on) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
      });
      if (prev) prev.disabled = current <= 1;
      if (next) next.disabled = current >= total;
    }

    nums.forEach(function (btn) {
      btn.addEventListener('click', function () { render(parseInt(btn.textContent, 10)); emit(root, 'ts:change', { page: current }); });
    });
    if (prev) prev.addEventListener('click', function () { render((parseInt(root.getAttribute('data-ts-page') || '1', 10) || 1) - 1); emit(root, 'ts:change', { page: current }); });
    if (next) next.addEventListener('click', function () { render((parseInt(root.getAttribute('data-ts-page') || '1', 10) || 1) + 1); emit(root, 'ts:change', { page: current }); });
    render(current);
  }

  /* ---------------- sortable-table ---------------- */

  function initSortableTables() {
    qsa(document, '[data-ts-table]').forEach(function (table) {
      var body = table.tBodies[0];
      if (!body) return;
      qsa(table, '.ts-i-table__th--sortable').forEach(function (th) {
        /* th 本身不可聚焦：加 tabindex 与 Enter/Space，键盘用户才能排序。 */
        if (!th.hasAttribute('tabindex')) th.setAttribute('tabindex', '0');
        if (!th.hasAttribute('role')) th.setAttribute('role', 'columnheader');

        function sortBy() {
          var col = Array.prototype.indexOf.call(th.parentNode.children, th);
          var mode = th.getAttribute('data-ts-sort') || 'text';
          var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
          qsa(table, '.ts-i-table__th--sortable').forEach(function (other) { other.setAttribute('aria-sort', 'none'); });
          th.setAttribute('aria-sort', dir);
          var rows = Array.prototype.slice.call(body.rows);
          rows.sort(function (a, b) {
            var av = cellKey(a.cells[col], mode);
            var bv = cellKey(b.cells[col], mode);
            if (av < bv) return dir === 'ascending' ? -1 : 1;
            if (av > bv) return dir === 'ascending' ? 1 : -1;
            return 0;
          });
          rows.forEach(function (row) { body.appendChild(row); });
          /* 重排是视觉变化，读屏需要被告知。 */
          announce((th.textContent || '').trim() + '：' + (dir === 'ascending' ? '升序' : '降序') + '，共 ' + rows.length + ' 行');
        }

        th.addEventListener('click', sortBy);
        th.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(); }
        });
      });
    });
  }

  function cellKey(cell, mode) {
    if (!cell) return mode === 'number' ? 0 : '';
    var raw = cell.getAttribute('data-ts-value');
    if (raw === null) raw = (cell.textContent || '').trim();
    if (mode === 'number') { var n = parseFloat(raw.replace(/[^0-9.+-]/g, '')); return isNaN(n) ? 0 : n; }
    return raw.toLowerCase();
  }

  /* ---------------- date-picker ---------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }

  function initDatePickers() {
    qsa(document, '[data-ts-datepicker]').forEach(function (root) {
      var input = root.querySelector('.ts-i-datepicker__input');
      var popup = root.querySelector('.ts-i-datepicker__popup');
      if (!input || !popup) return;
      if (!popup.id) popup.id = 'ts-i-datepicker-popup-' + (++tabSequence);
      input.setAttribute('aria-controls', popup.id);
      input.setAttribute('aria-haspopup', 'dialog');
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-label', '选择日期');
      var selected = input.getAttribute('data-ts-value') || '';
      var view = selected ? new Date(selected + 'T00:00:00') : new Date();
      if (isNaN(view.getTime())) view = new Date();
      var today = new Date();
      var todayKey = fmt(today.getFullYear(), today.getMonth(), today.getDate());
      /* roving tabindex：整个网格只留一个 Tab 停靠点，其余日期用方向键走。
         否则键盘用户要 Tab 三十次才能离开日历。 */
      var rovingKey = '';

      function defaultRoving(y, m) {
        if (selected && selected.slice(0, 7) === y + '-' + pad2(m + 1)) return selected;
        if (todayKey.slice(0, 7) === y + '-' + pad2(m + 1)) return todayKey;
        return fmt(y, m, 1);
      }

      function render() {
        var y = view.getFullYear();
        var m = view.getMonth();
        if (!rovingKey || rovingKey.slice(0, 7) !== y + '-' + pad2(m + 1)) rovingKey = defaultRoving(y, m);
        var first = new Date(y, m, 1);
        var startDow = first.getDay();
        var daysInMonth = new Date(y, m + 1, 0).getDate();
        var html = '<div class="ts-i-datepicker__nav">' +
          '<button type="button" class="ts-icon-btn" data-ts-nav="-1" aria-label="上个月">\u2039</button>' +
          '<span>' + y + '-' + pad2(m + 1) + '</span>' +
          '<button type="button" class="ts-icon-btn" data-ts-nav="1" aria-label="下个月">\u203a</button></div>';
        html += '<div class="ts-i-datepicker__grid">';
        for (var b = 0; b < startDow; b++) html += '<button type="button" class="ts-i-datepicker__day" disabled tabindex="-1"></button>';
        for (var d = 1; d <= daysInMonth; d++) {
          var key = fmt(y, m, d);
          var cls = 'ts-i-datepicker__day';
          if (key === todayKey) cls += ' ts-i-datepicker__day--today';
          if (key === selected) cls += ' ts-i-datepicker__day--selected';
          /* aria-current=date 让读屏区分"今天"；选中用 aria-pressed。 */
          var aria = (key === todayKey ? ' aria-current="date"' : '') + (key === selected ? ' aria-pressed="true"' : ' aria-pressed="false"');
          html += '<button type="button" class="' + cls + '" data-ts-date="' + key + '" aria-label="' + key + '" tabindex="' + (key === rovingKey ? '0' : '-1') + '"' + aria + '>' + d + '</button>';
        }
        html += '</div>';
        popup.innerHTML = html;
      }

      function setValue(key) {
        selected = key;
        rovingKey = key;
        input.value = key;
        input.setAttribute('data-ts-value', key);
        render();
        emit(root, 'ts:change', key);
      }

      function focusFirst() {
        var target = popup.querySelector('[data-ts-date="' + rovingKey + '"]') || popup.querySelector('[data-ts-date]:not([disabled])');
        if (target) target.focus();
      }

      function open() {
        popup.hidden = false;
        render();
        focusFirst();
      }
      function close() { popup.hidden = true; }
      function closeAndFocus() { close(); input.focus(); }

      input.addEventListener('click', function () { popup.hidden ? open() : close(); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        else if (e.key === 'Escape') close();
      });
      popup.addEventListener('click', function (e) {
        var nav = e.target.closest('[data-ts-nav]');
        if (nav) { view.setMonth(view.getMonth() + parseInt(nav.getAttribute('data-ts-nav'), 10)); render(); return; }
        var day = e.target.closest('[data-ts-date]');
        if (day) { setValue(day.getAttribute('data-ts-date')); closeAndFocus(); }
      });
      popup.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closeAndFocus(); return; }
        /* 网格方向键：日/周/月按 Date 计算，跨月时自动翻页。 */
        var day = e.target.closest && e.target.closest('[data-ts-date]');
        if (!day) return;
        var delta = 0;
        if (e.key === 'ArrowLeft') delta = -1;
        else if (e.key === 'ArrowRight') delta = 1;
        else if (e.key === 'ArrowUp') delta = -7;
        else if (e.key === 'ArrowDown') delta = 7;
        else if (e.key === 'Home') delta = -((new Date(day.getAttribute('data-ts-date') + 'T00:00:00').getDay()));
        else if (e.key === 'End') delta = 6 - (new Date(day.getAttribute('data-ts-date') + 'T00:00:00').getDay());
        else if (e.key === 'PageUp') { e.preventDefault(); view.setMonth(view.getMonth() - 1); render(); focusFirst(); return; }
        else if (e.key === 'PageDown') { e.preventDefault(); view.setMonth(view.getMonth() + 1); render(); focusFirst(); return; }
        else return;
        e.preventDefault();
        var current = new Date(day.getAttribute('data-ts-date') + 'T00:00:00');
        current.setDate(current.getDate() + delta);
        view = new Date(current.getFullYear(), current.getMonth(), 1);
        /* 方向键移动后停靠点跟着走，网格里始终只有一个 tabindex=0。 */
        rovingKey = fmt(current.getFullYear(), current.getMonth(), current.getDate());
        render();
        var next = popup.querySelector('[data-ts-date="' + rovingKey + '"]');
        if (next) next.focus();
      });
      document.addEventListener('click', function (e) {
        if (!popup.hidden && !root.contains(e.target)) close();
      });

      if (selected) input.value = selected;
    });
  }

  /* ---------------- scroll-progress：圆形进度 + 回到顶部 ---------------- */

  var RADIUS = 45;
  var CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  function reduceMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function frameThrottle(fn) {
    var pending = false;
    return function () {
      if (pending) return;
      pending = true;
      var run = function () { pending = false; fn(); };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
      else window.setTimeout(run, 16);
    };
  }

  function initScrollProgress(root) {
    var value = root.querySelector('.ts-i-scroll-progress__value');
    var label = root.querySelector('.ts-i-scroll-progress__label');
    var threshold = parseInt(root.getAttribute('data-ts-threshold'), 10);
    if (isNaN(threshold)) threshold = 300;
    if (value) {
      value.style.strokeDasharray = String(CIRCUMFERENCE);
      value.style.strokeDashoffset = String(CIRCUMFERENCE);
    }

    var update = frameThrottle(function () {
      var doc = document.documentElement;
      var scrollable = (doc.scrollHeight || 0) - window.innerHeight;
      var ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      if (value) value.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - ratio));
      if (label) label.textContent = Math.round(ratio * 100) + '%';
      var visible = window.scrollY > threshold;
      root.classList.toggle('ts-i-scroll-progress--visible', visible);
      /* 隐藏时不能只是 aria-hidden：它本身是 role=button tabindex=0，会留下不可聚焦的陷阱。
         隐藏时同时移出 Tab 序，可见时恢复。 */
      if (visible) {
        root.removeAttribute('aria-hidden');
        root.setAttribute('tabindex', '0');
      } else {
        root.setAttribute('aria-hidden', 'true');
        root.setAttribute('tabindex', '-1');
      }
    });

    function backToTop() {
      if (typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
      }
      emit(root, 'ts:back-to-top', null);
    }

    root.addEventListener('click', backToTop);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); backToTop(); }
    });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------------- sticky-header：吸顶 + 上滑隐藏 ---------------- */

  function initStickyHeaders() {
    qsa(document, '[data-ts-sticky]').forEach(function (header) {
      var scrollAt = parseInt(header.getAttribute('data-ts-scroll-threshold'), 10);
      var hideAt = parseInt(header.getAttribute('data-ts-hide-threshold'), 10);
      if (isNaN(scrollAt)) scrollAt = 50;
      if (isNaN(hideAt)) hideAt = 100;
      var lastY = window.scrollY || 0;

      var update = frameThrottle(function () {
        var y = window.scrollY || 0;
        header.classList.toggle('ts-i-sticky-header--scrolled', y > scrollAt);
        if (!reduceMotion() && y > hideAt && y > lastY) header.classList.add('ts-i-sticky-header--hidden');
        else header.classList.remove('ts-i-sticky-header--hidden');
        lastY = y;
      });

      window.addEventListener('scroll', update, { passive: true });
      update();
    });
  }

  /* ---------------- scroll-reveal：入视口渐显 ---------------- */

  function initScrollReveal() {
    var roots = qsa(document, '[data-ts-reveal]');
    if (!roots.length) return;

    function show(el) { el.classList.add('ts-i-reveal--visible'); }

    if (typeof IntersectionObserver !== 'function') {
      roots.forEach(show);
      return;
    }

    // 组内子项按序错峰：未显式给 data-ts-delay 时用序号 × 步长。
    var groups = qsa(document, '[data-ts-reveal-group]');
    for (var g = 0; g < groups.length; g++) {
      var step = 90;
      qsa(groups[g], '[data-ts-reveal]').forEach(function (el, i) {
        if (!el.hasAttribute('data-ts-delay')) el.setAttribute('data-ts-delay', String(i * step));
      });
    }

    // 先武装（启用初始位移），再观察，避免无脚本时内容永久隐形。
    roots.forEach(function (el) { el.classList.add('ts-i-reveal--armed'); });

    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;
        var el = entry.target;
        var delay = parseInt(el.getAttribute('data-ts-delay'), 10);
        if (delay > 0) window.setTimeout(function (node) { return function () { show(node); }; }(el), delay);
        else show(el);
        observer.unobserve(el);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

    roots.forEach(function (el) { observer.observe(el); });
  }

  /* ---------------- tilt-card：指针倾斜 ---------------- */

  function initTiltCards() {
    var fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    if (!fine || reduceMotion()) return;
    qsa(document, '[data-ts-tilt]').forEach(function (root) {
      var inner = root.querySelector('.ts-i-tilt__inner');
      if (!inner) return;
      var max = parseFloat(root.getAttribute('data-ts-max-tilt'));
      if (isNaN(max) || max <= 0) max = 12;
      root.classList.add('ts-i-tilt--armed');

      function reset() { inner.style.transform = ''; }

      function applyTilt(clientX, clientY) {
        var rect = root.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var x = (clientX - rect.left) / rect.width;
        var y = (clientY - rect.top) / rect.height;
        var rotateY = (x - 0.5) * 2 * max;
        var rotateX = (0.5 - y) * 2 * max;
        inner.style.transform = 'rotateX(' + rotateX.toFixed(2) + 'deg) rotateY(' + rotateY.toFixed(2) + 'deg)';
      }

      /* 倾斜是「悬停跟随」：用 follow 模式复用同一套中断语义
         （第二指针不夺取、pointercancel / 丢失捕获 / 失焦 / 离场全部复位）。 */
      var gesture = bindPointerDrag(root, {
        follow: true,
        onMove: function (event) { applyTilt(event.clientX, event.clientY); },
        onCancel: reset,
      });
      /* 兼容只派发 MouseEvent 的环境（旧浏览器与自动化测试）。 */
      root.addEventListener('mousemove', function (event) { applyTilt(event.clientX, event.clientY); });
      root.addEventListener('pointerleave', function () { gesture.cancel(); reset(); });
      root.addEventListener('mouseleave', function () { gesture.cancel(); reset(); });
    });
  }

  /* ---------------- mobile-nav：汉堡菜单 ---------------- */

  function initMobileNavs() {
    qsa(document, '[data-ts-mobile-nav]').forEach(function (root) {
      var toggle = root.querySelector('.ts-i-mobile-nav__toggle');
      var backdrop = root.querySelector('.ts-i-mobile-nav__backdrop');
      if (!toggle) return;
      var openLabel = toggle.getAttribute('aria-label') || '';

      function setOpen(open, focusToggle) {
        var wasOpen = root.classList.contains('ts-i-mobile-nav--open');
        root.classList.toggle('ts-i-mobile-nav--open', open);
        document.documentElement.classList.toggle('ts-i-mobile-nav--locked', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        /* 打开即模态：背景 inert + 焦点陷阱，Tab 不会跑到菜单后面。 */
        if (open && !wasOpen) {
          setBackgroundInert(root);
          if (!root.hasAttribute('data-ts-trap-bound')) {
            root.setAttribute('data-ts-trap-bound', '');
            root.addEventListener('keydown', function (event) { trapFocus(root, event); });
          }
        } else if (!open && wasOpen) {
          clearBackgroundInert(root);
        }
        if (focusToggle) toggle.focus();
      }

      toggle.addEventListener('click', function () { setOpen(!root.classList.contains('ts-i-mobile-nav--open'), false); });
      if (backdrop) backdrop.addEventListener('click', function () { setOpen(false, false); });
      qsa(root, 'a[href]').forEach(function (link) {
        link.addEventListener('click', function () { setOpen(false, false); });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && root.classList.contains('ts-i-mobile-nav--open')) setOpen(false, true);
      });
      window.addEventListener('resize', function () {
        if (window.innerWidth > 768 && root.classList.contains('ts-i-mobile-nav--open')) setOpen(false, false);
      });
      if (openLabel) toggle.setAttribute('aria-label', openLabel);
    });
  }

  /* ---------------- copy-code：复制按钮 ---------------- */

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    var ok = false;
    try {
      area.select();
      ok = document.execCommand && document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(area);
    return !!ok;
  }

  function initCopyBlocks() {
    qsa(document, '[data-ts-copy]').forEach(function (root) {
      var btn = root.querySelector('[data-ts-copy-btn]');
      var code = root.querySelector('.ts-i-copy__code');
      if (!btn || !code) return;
      var original = btn.textContent;
      var doneLabel = btn.getAttribute('data-ts-copied-label') || '已复制';
      var timer = null;

      function succeed() {
        root.classList.add('ts-i-copy--done');
        btn.textContent = doneLabel;
        announce(doneLabel);
        emit(root, 'ts:copied', { text: code.textContent || '' });
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(function () {
          root.classList.remove('ts-i-copy--done');
          btn.textContent = original;
        }, 1600);
      }

      btn.addEventListener('click', function () {
        var text = code.textContent || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(succeed, function () { if (fallbackCopy(text)) succeed(); });
        } else if (fallbackCopy(text)) {
          succeed();
        }
      });
    });
  }

  /* ---------------- toc-outline：大纲侧栏 ---------------- */

  function initTocOutlines() {
    qsa(document, '[data-ts-toc]').forEach(function (root) {
      var toggle = root.querySelector('.ts-i-toc__toggle');
      var backdrop = root.querySelector('.ts-i-toc__backdrop');
      var links = qsa(root, '.ts-i-toc__link');
      if (!links.length) return;

      var targets = [];
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (href.charAt(0) !== '#') continue;
        var node = document.getElementById(href.slice(1));
        if (node) targets.push({ link: links[i], node: node });
      }
      if (!targets.length) return;

      function setOpen(open, focusToggle) {
        var wasOpen = root.classList.contains('ts-i-toc--open');
        root.classList.toggle('ts-i-toc--open', open);
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        /* 窄屏下目录是抽屉式浮层：打开时背景 inert + 焦点陷阱（宽屏常驻不受影响）。 */
        if (open && !wasOpen) {
          setBackgroundInert(root);
          if (!root.hasAttribute('data-ts-trap-bound')) {
            root.setAttribute('data-ts-trap-bound', '');
            root.addEventListener('keydown', function (event) { trapFocus(root, event); });
          }
        } else if (!open && wasOpen) {
          clearBackgroundInert(root);
        }
        if (focusToggle && toggle) toggle.focus();
      }

      function activate(link) {
        for (var k = 0; k < links.length; k++) {
          var on = links[k] === link;
          links[k].classList.toggle('ts-i-toc__link--active', on);
          if (on) links[k].setAttribute('aria-current', 'true');
          else links[k].removeAttribute('aria-current');
        }
      }

      var update = frameThrottle(function () {
        var current = targets[0];
        var line = (window.scrollY || 0) + 120;
        for (var k = 0; k < targets.length; k++) {
          var top = targets[k].node.getBoundingClientRect().top + (window.scrollY || 0);
          if (top <= line) current = targets[k];
        }
        activate(current.link);
      });

      if (toggle) {
        toggle.addEventListener('click', function () { setOpen(!root.classList.contains('ts-i-toc--open'), false); });
      }
      if (backdrop) backdrop.addEventListener('click', function () { setOpen(false, false); });
      links.forEach(function (link) {
        link.addEventListener('click', function () { activate(link); setOpen(false, false); });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && root.classList.contains('ts-i-toc--open')) setOpen(false, true);
      });

      window.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      update();
    });
  }

  /* Supplemental, registered bindings. All state is scoped to its owning root. */
  function initBindings() {
    qsa(document, '[data-ts-config-demo]').forEach(function (form) {
      var region = form.querySelector('[data-ts-config-region]');
      var zone = form.querySelector('[data-ts-config-zone]');
      var range = form.querySelector('[data-ts-config-range]');
      var rangeValue = form.querySelector('[data-ts-config-range-value]');
      var min = form.querySelector('[data-ts-config-min]');
      var max = form.querySelector('[data-ts-config-max]');
      var start = form.querySelector('[data-ts-config-start]');
      var end = form.querySelector('[data-ts-config-end]');
      var feedback = form.querySelector('[data-ts-config-feedback]');
      function cascade() {
        if (!region || !zone) return;
        var valid = false;
        qsa(zone, 'option').forEach(function (option) {
          var group = option.getAttribute('data-ts-region');
          var allowed = !group || group === region.value;
          option.disabled = !allowed;
          option.hidden = !allowed;
          if (option.value === zone.value && allowed) valid = true;
        });
        if (!valid) zone.value = '';
      }
      function validate() {
        if (range && rangeValue) rangeValue.textContent = range.value;
        if (min) min.setCustomValidity('');
        if (max) max.setCustomValidity('');
        if (start) start.setCustomValidity('');
        if (end) end.setCustomValidity('');
        var message = '';
        if (min && max && min.value !== '' && max.value !== '' && Number(min.value) > Number(max.value)) {
          message = '数值区间下限不能大于上限。';
          max.setCustomValidity(message);
        }
        if (start && end && start.value && end.value && end.value < start.value) {
          message = '结束时间不能早于开始时间（同日）。';
          end.setCustomValidity(message);
        }
        if (feedback) feedback.textContent = message || '区间已核对；仅本地演示，不保存到服务器。';
      }
      if (region) region.addEventListener('change', cascade);
      form.addEventListener('input', validate);
      form.addEventListener('change', validate);
      cascade(); validate();
    });
    qsa(document, '[data-ts-tab-target]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        var root = link.closest('[data-ts-prototype]');
        var name = link.getAttribute('data-ts-tab-target');
        var tab = root && qsa(root, '[data-ts-tab]').find(function (candidate) { return candidate.getAttribute('data-ts-tab') === name; });
        if (!tab) return;
        event.preventDefault(); tab.click(); tab.focus();
      });
    });
    qsa(document, '[data-ts-rail-target]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        var root = link.closest('[data-ts-prototype]');
        var id = link.getAttribute('data-ts-rail-target');
        var target = root && qsa(root, '[id]').find(function (candidate) { return candidate.id === id; });
        if (!target) return;
        event.preventDefault();
        qsa(root, '[data-ts-rail-target]').forEach(function (item) { if (item === link) item.setAttribute('aria-current', 'true'); else item.removeAttribute('aria-current'); });
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus(); target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      });
    });
    qsa(document, '[data-ts-filter], [data-ts-table-pages]').forEach(function (root) {
      // A paginated filter is one controller, even if it carries both markers.
      if (root.__tsBound) return;
      root.__tsBound = true;
      var boundary = '[data-ts-filter], [data-ts-table-pages]';
      var input = owned(root, '[data-ts-filter-input]', boundary)[0];
      var items = owned(root, '[data-ts-filter-item]', boundary);
      if (!items.length && root.hasAttribute('data-ts-table-pages')) items = owned(root, 'tbody tr', boundary);
      var pagination = root.matches('[data-ts-pagination]') ? root : owned(root, '[data-ts-pagination]', boundary)[0];
      var size = root.hasAttribute('data-ts-table-pages') ? Math.max(1, Math.min(100, parseInt(root.getAttribute('data-ts-page-size') || '5', 10) || 5)) : 0;
      var query = input ? input.value.trim().toLocaleLowerCase() : '';
      function render(reset) {
        var matches = items.filter(function (item) {
          var value = item.getAttribute('data-ts-filter-item') || item.textContent || '';
          return value.toLocaleLowerCase().includes(query);
        });
        var pages = size ? Math.max(1, Math.ceil(matches.length / size)) : 1;
        var current = pagination && !reset ? parseInt(pagination.getAttribute('data-ts-page') || '1', 10) : 1;
        current = Math.max(1, Math.min(pages, current || 1));
        items.forEach(function (item) {
          var index = matches.indexOf(item);
          item.hidden = index < 0 || (size > 0 && (index < (current - 1) * size || index >= current * size));
        });
        owned(root, '[data-ts-filter-count]', boundary).forEach(function (el) { el.textContent = String(matches.length); });
        owned(root, '[data-ts-filter-empty]', boundary).forEach(function (el) { el.hidden = matches.length !== 0; });
        if (pagination) {
          pagination.setAttribute('data-ts-total', String(pages));
          pagination.setAttribute('data-ts-page', String(current));
          owned(pagination, '.ts-i-pagination__item', '[data-ts-pagination]').forEach(function (button) {
            var number = parseInt(button.textContent, 10);
            button.hidden = number > pages;
            button.classList.toggle('ts-i-pagination__item--active', number === current);
            if (number === current) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
          });
          var prev = owned(pagination, '[data-ts-page-prev]', '[data-ts-pagination]')[0];
          var next = owned(pagination, '[data-ts-page-next]', '[data-ts-pagination]')[0];
          if (prev) prev.disabled = current === 1;
          if (next) next.disabled = current === pages;
        }
      }
      if (input) input.addEventListener('input', function () { query = input.value.trim().toLocaleLowerCase(); render(true); });
      if (pagination) pagination.addEventListener('ts:change', function (event) { if (event.target === pagination) render(false); });
      root.addEventListener('ts:items-change', function (event) { if (event.target === root) render(false); });
      render(true);
    });
    qsa(document, '[data-ts-bulk-demo]').forEach(function (root) {
      var boundary = '[data-ts-bulk-demo]';
      var boxes = owned(root, 'input[type="checkbox"][data-ts-bulk-select]', boundary);
      var button = owned(root, 'button[data-ts-bulk-archive]', boundary)[0];
      var count = owned(root, '[data-ts-bulk-count]', boundary)[0];
      var feedback = owned(root, '[data-ts-bulk-feedback]', boundary)[0];
      if (!button) return;
      function selected() { return boxes.filter(function (box) { return box.checked && !box.matches(':disabled'); }); }
      function update() {
        var total = selected().length;
        if (count) count.textContent = String(total);
        button.disabled = total === 0;
      }
      boxes.forEach(function (box) { box.addEventListener('change', update); });
      button.addEventListener('click', function (event) {
        event.preventDefault();
        var changed = 0;
        selected().forEach(function (box) {
          var row = box.closest('tr');
          var status = row && row.querySelector('[data-ts-bulk-status]');
          if (!row || row.closest(boundary) !== root || !status) return;
          status.textContent = '已归档（本地演示）';
          box.checked = false;
          changed++;
        });
        if (feedback && changed) {
          feedback.hidden = false;
          feedback.textContent = '已在本地演示中归档 ' + changed + ' 条选中记录；未保存到服务器，刷新后恢复。';
        }
        update();
        emit(root, 'ts:items-change', null);
      });
      update();
    });
    qsa(document, 'form[data-ts-chat-form]').forEach(function (form) {
      var prototype = form.closest('[data-ts-prototype]');
      var scope = form.parentElement;
      var messages;
      while (scope) {
        var candidates = qsa(scope, '[data-ts-chat-messages]').filter(function (element) { return element.closest('[data-ts-prototype]') === prototype; });
        var forms = qsa(scope, 'form[data-ts-chat-form]').filter(function (element) { return element.closest('[data-ts-prototype]') === prototype; });
        if (candidates.length === 1 && forms.length === 1) { messages = candidates[0]; break; }
        if (scope === prototype || !prototype) break;
        scope = scope.parentElement;
      }
      var input = form.querySelector('textarea, input:not([type="hidden"])');
      if (!messages || !input) return;
      bindFormAction(form, function () {
        var value = input.value.trim();
        if (!value || !form.checkValidity()) { form.reportValidity(); return; }
        var item = document.createElement('p');
        item.textContent = value;
        messages.appendChild(item);
        var notice = document.createElement('p');
        notice.textContent = '演示消息已加入；此原型未连接 AI 或服务器。';
        notice.setAttribute('role', 'status');
        messages.appendChild(notice);
        input.value = '';
        input.focus();
      });
    });
    qsa(document, 'form[data-ts-demo-save]').forEach(function (form) {
      bindFormAction(form, function () {
        if (!form.checkValidity()) { form.reportValidity(); return; }
        var feedback = form.querySelector('[data-ts-demo-feedback]');
        if (feedback) {
          feedback.hidden = false;
          feedback.setAttribute('role', 'status');
          feedback.textContent = '演示校验通过；未向服务器提交或永久保存。';
        }
      });
    });
  }

  /* ---------------- init ---------------- */

  function init() {
    qsa(document, '[data-ts-tabs]').forEach(initTabs);
    initOverlays('[data-ts-modal]', 'ts-i-modal--open');
    initOverlays('[data-ts-drawer]', 'ts-i-drawer--open');
    qsa(document, '[data-ts-dropdown]').forEach(initDropdown);
    qsa(document, '[data-ts-accordion]').forEach(initAccordion);
    initTooltips();
    initToasts();
    initForms();
    qsa(document, '[data-ts-segmented]').forEach(initSegmented);
    initSwitches();
    initSteppers();
    qsa(document, '[data-ts-pagination]').forEach(initPagination);
    initSortableTables();
    initDatePickers();
    qsa(document, '[data-ts-scroll-progress]').forEach(initScrollProgress);
    initStickyHeaders();
    initScrollReveal();
    initTiltCards();
    initMobileNavs();
    initCopyBlocks();
    initTocOutlines();
    initBindings();

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeActiveOverlay();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
