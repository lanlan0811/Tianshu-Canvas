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
  var lastFocus = null;

  function qsa(root, sel) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function emit(el, name, detail) {
    try {
      el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
    } catch (e) { /* CustomEvent 不可用时静默 */ }
  }

  /* ---------------- tabs ---------------- */

  function initTabs(root) {
    var tabs = qsa(root, '[data-ts-tab]');
    var panels = qsa(root, '[data-ts-panel]');
    if (!tabs.length) return;

    function activate(name, focus) {
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].getAttribute('data-ts-tab') === name;
        tabs[i].classList.toggle('ts-tab--active', on);
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        tabs[i].setAttribute('tabindex', on ? '0' : '-1');
        if (on) {
          var pid = tabs[i].id || (root.id ? root.id + '-panel-' + name : '');
          if (!tabs[i].id && pid) tabs[i].id = pid + '-tab';
          if (pid) tabs[i].setAttribute('aria-controls', pid);
          if (focus) tabs[i].focus();
        }
      }
      for (var j = 0; j < panels.length; j++) {
        var show = panels[j].getAttribute('data-ts-panel') === name;
        panels[j].hidden = !show;
        if (!panels[j].id) panels[j].id = (root.id ? root.id + '-panel-' + name : 'ts-panel-' + name);
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
    lastFocus = document.activeElement;
    el.hidden = false;
    el.classList.add(openClass);
    el.setAttribute('aria-hidden', 'false');
    ACTIVE_MODAL = el;
    var focusable = qsa(el, 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length) focusable[0].focus();
    emit(el, 'ts:open', null);
  }

  function closeOverlay(el, openClass) {
    if (!el) return;
    el.classList.remove(openClass);
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    if (ACTIVE_MODAL === el) ACTIVE_MODAL = null;
    if (lastFocus && typeof lastFocus.focus === 'function') { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
    emit(el, 'ts:close', null);
  }

  function initOverlays(selector, openClass) {
    qsa(document, selector).forEach(function (el) {
      el.setAttribute('aria-hidden', el.hidden ? 'true' : 'false');
    });
    qsa(document, '[data-ts-open]').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var id = (trigger.getAttribute('data-ts-open') || '').replace(/^#/, '');
        var target = id ? document.getElementById(id) : null;
        if (target) openOverlay(target, target.hasAttribute('data-ts-drawer') ? 'ts-i-drawer--open' : 'ts-i-modal--open');
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

    function setOpen(open, focusItem) {
      root.classList.toggle('ts-i-dropdown--open', open);
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && items.length) (focusItem ? items[0] : null) && items[0].focus();
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
        if (next >= 0) { e.preventDefault(); items[next].focus(); }
      });
    });
    setOpen(false, false);
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
    qsa(document, '[data-ts-toast-region] .ts-toast').forEach(function (el) {
      armToast(el);
      var closer = el.querySelector('[data-ts-toast-dismiss]');
      if (closer) closer.addEventListener('click', function () { dismissToast(el); });
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

  function initForms() {
    qsa(document, '[data-ts-form]').forEach(function (form) {
      var controls = qsa(form, 'input, select, textarea');

      function fieldOf(control) { return control.closest('.ts-i-form__field'); }

      function validateControl(control) {
        var field = fieldOf(control);
        if (!field) return true;
        var error = field.querySelector('.ts-i-form__error');
        var ok = control.checkValidity();
        if (ok) {
          field.removeAttribute('data-ts-invalid');
          if (error) { error.textContent = ''; error.classList.remove('ts-i-form__error--show'); }
          return true;
        }
        var message = control.getAttribute('data-ts-error') || control.validationMessage || '此项无效';
        field.setAttribute('data-ts-invalid', '');
        if (error) { error.textContent = message; error.classList.add('ts-i-form__error--show'); }
        return false;
      }

      controls.forEach(function (control) {
        control.addEventListener('blur', function () { validateControl(control); });
        control.addEventListener('input', function () {
          var field = fieldOf(control);
          if (field && field.hasAttribute('data-ts-invalid')) validateControl(control);
        });
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
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
      step.setAttribute('aria-current', n === current ? 'step' : 'false');
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
    var prev = root.querySelector('[data-ts-page-prev]');
    var next = root.querySelector('[data-ts-page-next]');
    var nums = qsa(root, '.ts-i-pagination__item');

    function render(page) {
      current = Math.max(1, Math.min(total, page));
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
    if (prev) prev.addEventListener('click', function () { render(current - 1); emit(root, 'ts:change', { page: current }); });
    if (next) next.addEventListener('click', function () { render(current + 1); emit(root, 'ts:change', { page: current }); });
    render(current);
  }

  /* ---------------- sortable-table ---------------- */

  function initSortableTables() {
    qsa(document, '[data-ts-table]').forEach(function (table) {
      var body = table.tBodies[0];
      if (!body) return;
      qsa(table, '.ts-i-table__th--sortable').forEach(function (th) {
        th.addEventListener('click', function () {
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
      var selected = input.getAttribute('data-ts-value') || '';
      var view = selected ? new Date(selected + 'T00:00:00') : new Date();
      if (isNaN(view.getTime())) view = new Date();
      var today = new Date();
      var todayKey = fmt(today.getFullYear(), today.getMonth(), today.getDate());

      function render() {
        var y = view.getFullYear();
        var m = view.getMonth();
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
          html += '<button type="button" class="' + cls + '" data-ts-date="' + key + '" aria-label="' + key + '">' + d + '</button>';
        }
        html += '</div>';
        popup.innerHTML = html;
      }

      function setValue(key) {
        selected = key;
        input.value = key;
        input.setAttribute('data-ts-value', key);
        render();
        emit(root, 'ts:change', key);
      }

      function open() {
        popup.hidden = false;
        render();
        var firstDay = popup.querySelector('[data-ts-date]:not([disabled])');
        if (firstDay) firstDay.focus();
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
        if (e.key === 'Escape') { e.preventDefault(); closeAndFocus(); }
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
      root.classList.toggle('ts-i-scroll-progress--visible', window.scrollY > threshold);
      root.setAttribute('aria-hidden', window.scrollY > threshold ? 'false' : 'true');
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

      root.addEventListener('mousemove', function (e) {
        var rect = root.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var x = (e.clientX - rect.left) / rect.width;
        var y = (e.clientY - rect.top) / rect.height;
        var rotateY = (x - 0.5) * 2 * max;
        var rotateX = (0.5 - y) * 2 * max;
        inner.style.transform = 'rotateX(' + rotateX.toFixed(2) + 'deg) rotateY(' + rotateY.toFixed(2) + 'deg)';
      });

      root.addEventListener('mouseleave', function () { inner.style.transform = ''; });
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
        root.classList.toggle('ts-i-mobile-nav--open', open);
        document.documentElement.classList.toggle('ts-i-mobile-nav--locked', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
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
        root.classList.toggle('ts-i-toc--open', open);
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
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

  /* ---------------- init ---------------- */

  function init() {
    qsa(document, '[data-ts-tabs]').forEach(initTabs);
    initOverlays('[data-ts-modal]', 'ts-i-modal--open');
    initOverlays('[data-ts-drawer]', 'ts-i-drawer--open');
    qsa(document, '[data-ts-dropdown]').forEach(initDropdown);
    qsa(document, '[data-ts-accordion]').forEach(initAccordion);
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

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeActiveOverlay();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
