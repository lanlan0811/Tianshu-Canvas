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

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeActiveOverlay();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
