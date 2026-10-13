/* ================= 轻打卡 Lika - 应用逻辑 ================= */
(function () {
  'use strict';

  var STORE_KEY = 'ck_checkin_data_v1';
  var CK_VERSION = 'v12-multi'; // 单文件版由 build-standalone.js 自动替换为打包时间戳

  // ---------- 安全存储（file:// 下 localStorage 可能被禁用，降级为内存，避免脚本抛错中断） ----------
  var LS = (function () {
    try { var k = '__ck_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  })();
  var _mem = {};
  function storeGet(key) {
    if (LS) { try { return LS.getItem(key); } catch (e) { /* 落到内存 */ } }
    return Object.prototype.hasOwnProperty.call(_mem, key) ? _mem[key] : null;
  }
  function storeSet(key, val) {
    _mem[key] = val;
    if (LS) { try { LS.setItem(key, val); } catch (e) { /* 仅内存 */ } }
  }

  // ---------- 数据层 ----------
  var state = load();

  function load() {
    try {
      var raw = storeGet(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        return { tasks: d.tasks || [], records: d.records || {} };
      }
    } catch (e) { /* 数据损坏则重置 */ }
    return { tasks: [], records: {} };
  }

  function save() {
    storeSet(STORE_KEY, JSON.stringify(state));
  }

  // ---------- 日期工具 ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return ymd(new Date()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  // 周一为一周起点
  function startOfWeek(d) {
    var x = new Date(d);
    var day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  var WEEK_LABEL = ['一', '二', '三', '四', '五', '六', '日'];

  // ---------- 业务规则 ----------
  // 日期区间：开始/结束日期均可选（空=不限），以 YYYY-MM-DD 字符串直接比较
  function inRange(task, date) {
    var ds = ymd(date);
    if (task.startDate && ds < task.startDate) return false;
    if (task.endDate && ds > task.endDate) return false;
    return true;
  }
  function isDue(task, date) {
    if (!inRange(task, date)) return false;
    var dow = date.getDay(); // 0=周日
    switch (task.cycle) {
      case 'daily': return true;
      case 'weekday': return dow >= 1 && dow <= 5;
      case 'weekend': return dow === 0 || dow === 6;
      case 'custom': return (task.weekdays || []).indexOf(dow) !== -1;
      default: return false;
    }
  }
  // 已终止：手动归档，或结束日期已过（自动视为终止）
  function isArchived(task) {
    return !!task.archived || (!!task.endDate && task.endDate < todayStr());
  }
  function countRecords(taskId) {
    var n = 0, pre = taskId + '_';
    Object.keys(state.records).forEach(function (k) { if (k.indexOf(pre) === 0) n++; });
    return n;
  }
  function clearRecords(taskId) {
    var pre = taskId + '_';
    Object.keys(state.records).forEach(function (k) { if (k.indexOf(pre) === 0) delete state.records[k]; });
  }
  function cycleLabel(task) {
    if (task.cycle === 'daily') return '每天';
    if (task.cycle === 'weekday') return '工作日';
    if (task.cycle === 'weekend') return '周末';
    if (task.cycle === 'custom') {
      var w = (task.weekdays || []).slice().sort(function (a, b) { return (a === 0 ? 7 : a) - (b === 0 ? 7 : b); });
      return '每周' + w.map(function (d) { return WEEK_LABEL[(d + 6) % 7]; }).join('·');
    }
    return '';
  }
  function recKey(taskId, dateStr) { return taskId + '_' + dateStr; }
  function isDone(taskId, dateStr) { return !!state.records[recKey(taskId, dateStr)]; }

  // ---------- 每日一句 ----------
  // 风格标签 -> 中文展示名
  var QUOTE_STYLE_LABEL = {
    '燃': '励志', '暖': '治愈', '恒': '坚持',
    '定': '专注', '长': '成长', '豁': '豁达'
  };
  var QUOTE_EPOCH = Date.UTC(2000, 0, 1); // 固定基准日
  var QUOTE_MUL = 7919;                   // 与池长互质的质数，用于打乱展示顺序
  var quoteShift = 0;                     // “换一句”点击偏移：不持久，刷新/跨天后回到当日固定句
  function quoteOfDay(date, shift) {
    if (!window.QUOTES || !window.QUOTES.length) return null;
    var n = window.QUOTES.length;
    var dayIndex = Math.floor(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - QUOTE_EPOCH) / 86400000
    );
    // 确定性散列：同一天恒定同一句，且任意连续 365 天下标不重复（n>=365 且与 mul 互质）
    var idx = ((dayIndex % n) * QUOTE_MUL) % n;
    // 换一句：从当日句开始按顺序轮换，同日连点不重复（模 n）
    return window.QUOTES[((idx + (shift || 0)) % n + n) % n];
  }
  function renderQuote() {
    var q = quoteOfDay(new Date(), quoteShift);
    if (!q) return;
    var now = new Date();
    document.getElementById('ck-quote-text').textContent = '“' + q.t + '”';
    document.getElementById('ck-quote-style').textContent = QUOTE_STYLE_LABEL[q.s] || '今日';
    document.getElementById('ck-quote-date').textContent =
      (now.getMonth() + 1) + '月' + now.getDate() + '日';
    var card = document.getElementById('ck-quote-card');
    if (card) card.setAttribute('data-style', q.s);
    // 重放淡入动画（先移除再强制重排）
    var textEl = document.getElementById('ck-quote-text');
    textEl.classList.remove('ck-quote-in');
    void textEl.offsetWidth;
    textEl.classList.add('ck-quote-in');
  }
  // 点击卡片（含“换一句”按钮，事件冒泡只计一次）轮换下一句
  var quoteCard = document.getElementById('ck-quote-card');
  if (quoteCard) {
    quoteCard.addEventListener('click', function () {
      quoteShift++;
      renderQuote();
    });
  }

  // 某日应打卡事项 + 已完成数
  function dayStat(date) {
    var ds = ymd(date), plan = 0, done = 0;
    state.tasks.forEach(function (t) {
      if (isDue(t, date)) { plan++; if (isDone(t.id, ds)) done++; }
    });
    return { plan: plan, done: done };
  }

  // ---------- 视图切换 ----------
  function showView(id) {
    document.querySelectorAll('.ck-view').forEach(function (v) { v.classList.remove('ck-active'); });
    document.getElementById(id).classList.add('ck-active');
    document.querySelectorAll('.ck-tabbar button').forEach(function (b) {
      b.classList.toggle('ck-on', b.dataset.view === id);
    });
    if (id === 'ck-view-today') renderToday();
    if (id === 'ck-view-stats') renderStats();
    if (id === 'ck-view-manage') renderManage();
  }

  document.querySelectorAll('.ck-tabbar button').forEach(function (b) {
    b.addEventListener('click', function () { showView(b.dataset.view); });
  });
  document.querySelectorAll('[data-nav]').forEach(function (b) {
    b.addEventListener('click', function () { showView(b.dataset.nav); });
  });

  // ---------- 今日视图 ----------
  function renderToday() {
    renderQuote();
    var now = new Date();
    document.getElementById('ck-today-date').textContent =
      (now.getMonth() + 1) + '月' + now.getDate() + '日 · 星期' + WEEK_LABEL[(now.getDay() + 6) % 7];
    var list = document.getElementById('ck-task-list');
    var empty = document.getElementById('ck-today-empty');
    list.innerHTML = '';
    var due = state.tasks.filter(function (t) { return !isArchived(t) && isDue(t, now); });
    var doneCount = due.filter(function (t) { return isDone(t.id, todayStr()); }).length;
    document.getElementById('ck-today-progress').textContent =
      due.length ? ('已完成 ' + doneCount + ' / ' + due.length + ' 项') : '今日无需打卡';

    if (!due.length) { empty.classList.remove('ck-hidden'); return; }
    empty.classList.add('ck-hidden');

    due.forEach(function (t) {
      list.appendChild(buildTaskItem(t, now, doneCount));
    });
  }

  function buildTaskItem(task, date, _) {
    var ds = ymd(date);
    var done = isDone(task.id, ds);
    var li = document.createElement('li');
    li.className = 'ck-task-item' + (done ? ' ck-done' : '');
    li.innerHTML =
      '<span class="ck-task-dot" style="background:' + task.color + '"></span>' +
      '<div style="flex:1"><div class="ck-task-name">' + esc(task.name) + '</div>' +
      '<div class="ck-task-cycle">' + cycleLabel(task) + '</div></div>' +
      '<button class="ck-check">✓</button>';
    li.querySelector('.ck-check').addEventListener('click', function () {
      var k = recKey(task.id, ds);
      if (state.records[k]) delete state.records[k]; else state.records[k] = true;
      save();
      li.classList.toggle('ck-done', !!state.records[k]); // 就地刷新当前行样式
      // 根据所在容器刷新对应视图：弹层内重绘日历/汇总，今日页重绘进度
      if (li.closest('#ck-day-list')) renderStats(); else renderToday();
    });
    return li;
  }

  // ---------- 统计视图（周/月） ----------
  var stats = { mode: 'week', anchor: new Date() };

  document.querySelectorAll('#ck-seg-mode button').forEach(function (b) {
    b.addEventListener('click', function () {
      stats.mode = b.dataset.mode;
      document.querySelectorAll('#ck-seg-mode button').forEach(function (x) { x.classList.remove('ck-on'); });
      b.classList.add('ck-on');
      renderStats();
    });
  });
  document.getElementById('ck-btn-prev').addEventListener('click', function () { shiftAnchor(-1); });
  document.getElementById('ck-btn-next').addEventListener('click', function () { shiftAnchor(1); });
  document.getElementById('ck-btn-backtoday').addEventListener('click', function () {
    stats.anchor = new Date(); renderStats();
  });
  function shiftAnchor(dir) {
    if (stats.mode === 'week') stats.anchor = addDays(stats.anchor, dir * 7);
    else {
      var x = new Date(stats.anchor);
      x.setMonth(x.getMonth() + dir);
      stats.anchor = x;
    }
    renderStats();
  }

  function renderStats() {
    var dates = periodDates();
    var labelEl = document.getElementById('ck-stats-period');
    if (stats.mode === 'week') {
      var s = dates[0], e = dates[6];
      labelEl.textContent = (s.getMonth() + 1) + '/' + s.getDate() + '周' + WEEK_LABEL[(s.getDay() + 6) % 7]
        + ' - ' + (e.getMonth() + 1) + '/' + e.getDate() + '周' + WEEK_LABEL[(e.getDay() + 6) % 7];
    } else {
      labelEl.textContent = stats.anchor.getFullYear() + '年' + (stats.anchor.getMonth() + 1) + '月';
    }

    // 汇总
    var plan = 0, done = 0;
    dates.forEach(function (d) { var st = dayStat(d); plan += st.plan; done += st.done; });
    document.getElementById('ck-sum-done').textContent = done;
    document.getElementById('ck-sum-plan').textContent = plan;
    document.getElementById('ck-sum-rate').textContent = plan ? Math.round(done / plan * 100) + '%' : '--';
    document.getElementById('ck-sum-streak').textContent = calcStreak();

    renderCalendar(dates);
    renderTaskStats(dates);
  }

  function periodDates() {
    if (stats.mode === 'week') {
      var start = startOfWeek(stats.anchor);
      var arr = [];
      for (var i = 0; i < 7; i++) arr.push(addDays(start, i));
      return arr;
    }
    // 月：返回该月每一天
    var y = stats.anchor.getFullYear(), m = stats.anchor.getMonth();
    var last = new Date(y, m + 1, 0).getDate();
    var arr = [];
    for (var d = 1; d <= last; d++) arr.push(new Date(y, m, d));
    return arr;
  }

  function renderCalendar(dates) {
    var cal = document.getElementById('ck-calendar');
    cal.innerHTML = '';
    var tds = todayStr();
    // 星期表头（周/月视图都显示，便于对照星期几）
    WEEK_LABEL.forEach(function (w) {
      var h = document.createElement('div'); h.className = 'ck-cal-head'; h.textContent = w; cal.appendChild(h);
    });
    // 月视图：当月第一天前补空白格，使其对齐到正确星期列
    if (stats.mode === 'month') {
      var blanks = (dates[0].getDay() + 6) % 7;
      for (var b = 0; b < blanks; b++) {
        var blank = document.createElement('div'); blank.className = 'ck-cal-cell ck-blank'; cal.appendChild(blank);
      }
    }
    dates.forEach(function (d) {
      var ds = ymd(d), st = dayStat(d);
      var cell = document.createElement('div');
      // 分类：无应打卡 / 未完成 / 部分完成 / 全部完成（用不同色相拉开区分度）
      var cat = st.plan === 0 ? 'none' : (st.done === 0 ? 'zero' : (st.done === st.plan ? 'full' : 'partial'));
      cell.className = 'ck-cal-cell ck-c-' + cat;
      if (ds > tds) cell.classList.add('ck-future');
      if (ds === tds) cell.classList.add('ck-today');
      var num = document.createElement('span'); num.className = 'ck-cal-num'; num.textContent = d.getDate();
      cell.appendChild(num);
      if (st.plan > 0) {
        var frac = document.createElement('small'); frac.className = 'ck-cal-frac';
        frac.textContent = st.done + '/' + st.plan; cell.appendChild(frac);
      }
      cell.addEventListener('click', function () { openDay(d); });
      cal.appendChild(cell);
    });
  }

  function renderTaskStats(dates) {
    var ul = document.getElementById('ck-task-stats');
    ul.innerHTML = '';
    var built = 0;
    if (!state.tasks.length) {
      ul.innerHTML = '<li class="ck-tip" style="text-align:center;padding:10px">暂无事项，去「管理」添加吧</li>';
      return;
    }
    state.tasks.forEach(function (t) {
      var plan = 0, done = 0;
      dates.forEach(function (d) {
        if (isDue(t, d)) { plan++; if (isDone(t.id, ymd(d))) done++; }
      });
      if (plan === 0) return; // 该区间内无应打卡（如已终止/尚未开始），不展示
      built++;
      var pct = Math.round(done / plan * 100);
      var li = document.createElement('li');
      li.className = 'ck-stat-row';
      li.innerHTML =
        '<div class="ck-stat-top"><span>' + esc(t.name) + '</span><span>' + done + '/' + plan + ' · ' + pct + '%</span></div>' +
        '<div class="ck-bar"><i style="width:' + pct + '%;background:' + t.color + '"></i></div>';
      ul.appendChild(li);
    });
    if (!built) ul.innerHTML = '<li class="ck-tip" style="text-align:center;padding:10px">该时段内没有应打卡事项</li>';
  }

  // 连续达标天数（从昨天往前，含今天已全达标则计入今天）
  function calcStreak() {
    var streak = 0, cur = new Date();
    // 若今天已全部完成则从今天算，否则从昨天算
    var todaySt = dayStat(cur);
    if (todaySt.plan > 0 && todaySt.done === todaySt.plan) { streak++; }
    cur = addDays(cur, -1);
    while (true) {
      var st = dayStat(cur);
      if (st.plan > 0 && st.done === st.plan) { streak++; cur = addDays(cur, -1); }
      else break;
      if (streak > 3650) break;
    }
    return streak;
  }

  // ---------- 某日详情 / 补打卡 ----------
  var dayModal = document.getElementById('ck-modal-day');
  var dayModalDate = null;
  function openDay(date) {
    if (ymd(date) > todayStr()) { toast('未来的日期还不能打卡哦'); return; }
    dayModalDate = date;
    document.getElementById('ck-day-title').textContent =
      (date.getMonth() + 1) + '月' + date.getDate() + '日 · 补打卡';
    var ul = document.getElementById('ck-day-list');
    ul.innerHTML = '';
    var due = state.tasks.filter(function (t) { return isDue(t, date); });
    if (!due.length) ul.innerHTML = '<li class="ck-tip" style="text-align:center;padding:16px">当天没有应打卡事项</li>';
    due.forEach(function (t) { ul.appendChild(buildTaskItem(t, date)); });
    dayModal.classList.remove('ck-hidden');
  }
  document.getElementById('ck-btn-day-close').addEventListener('click', function () {
    dayModal.classList.add('ck-hidden');
  });

  // ---------- 管理视图 ----------
  function rangeLabel(t) {
    var parts = [];
    if (t.startDate) parts.push('自 ' + t.startDate);
    if (t.endDate) parts.push('至 ' + t.endDate);
    return parts.length ? parts.join(' ') : '永久有效';
  }
  function renderManage() {
    var ul = document.getElementById('ck-manage-list');
    var aUl = document.getElementById('ck-archived-list');
    var aWrap = document.getElementById('ck-archived-wrap');
    ul.innerHTML = ''; aUl.innerHTML = '';
    document.getElementById('ck-active-count').textContent = '';
    document.getElementById('ck-archived-count').textContent = '';

    var active = state.tasks.filter(function (t) { return !isArchived(t); });
    var archived = state.tasks.filter(isArchived);

    if (!state.tasks.length) {
      ul.innerHTML = '<li class="ck-empty" style="box-shadow:none;background:transparent">还没有事项，点击右上角「＋ 新增事项」</li>';
    }
    document.getElementById('ck-active-count').textContent = active.length ? ('· ' + active.length + ' 项') : '';

    active.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'ck-manage-item';
      li.innerHTML =
        '<span class="ck-task-dot" style="background:' + t.color + '"></span>' +
        '<div class="ck-manage-info"><div class="ck-task-name">' + esc(t.name) + '</div>' +
        '<div class="ck-task-cycle">' + cycleLabel(t) + ' · ' + rangeLabel(t) + '</div></div>' +
        '<button class="ck-op ck-op-edit">编辑</button>' +
        '<button class="ck-op ck-op-term">终止</button>';
      li.querySelector('.ck-op-edit').addEventListener('click', function () { openEdit(t); });
      li.querySelector('.ck-op-term').addEventListener('click', function () {
        ckConfirm({
          title: '终止打卡', okText: '终止',
          message: '终止「' + t.name + '」的每日打卡？\n终止后不再出现在“今日”，但已有打卡记录会完整保留。'
        }).then(function (ok) {
          if (!ok) return;
          if (!t.endDate || t.endDate > todayStr()) t.endDate = todayStr();
          t.archived = true;
          save(); renderManage(); toast('已终止，历史记录已保留');
        });
      });
      ul.appendChild(li);
    });

    if (!archived.length) { aWrap.classList.add('ck-hidden'); return; }
    aWrap.classList.remove('ck-hidden');
    document.getElementById('ck-archived-count').textContent = '· ' + archived.length + ' 项';
    archived.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'ck-manage-item ck-archived-item';
      var recCnt = countRecords(t.id);
      li.innerHTML =
        '<span class="ck-task-dot" style="background:' + t.color + '"></span>' +
        '<div class="ck-manage-info"><div class="ck-task-name">' + esc(t.name) + '</div>' +
        '<div class="ck-task-cycle">终止于 ' + (t.endDate || todayStr()) + ' · 共 ' + recCnt + ' 条记录</div></div>' +
        '<button class="ck-op ck-op-restore">恢复</button>' +
        '<button class="ck-op ck-op-clear">清空记录</button>' +
        '<button class="ck-op ck-op-purge">彻底删除</button>';
      li.querySelector('.ck-op-restore').addEventListener('click', function () {
        t.archived = false;
        if (t.endDate && t.endDate <= todayStr()) t.endDate = ''; // 恢复为永久
        save(); renderManage(); toast('已恢复，重新开始打卡');
      });
      li.querySelector('.ck-op-clear').addEventListener('click', function () {
        if (recCnt === 0) { toast('该事项暂无打卡记录'); return; }
        ckConfirm({
          title: '清空打卡记录', okText: '清空记录', danger: true,
          message: '确定清空「' + t.name + '」的全部 ' + recCnt + ' 条打卡记录？\n事项本身保留，仅清除历史，此操作不可撤销。'
        }).then(function (ok) {
          if (!ok) return;
          clearRecords(t.id); save(); renderManage(); toast('已清空 ' + recCnt + ' 条记录');
        });
      });
      li.querySelector('.ck-op-purge').addEventListener('click', function () {
        var msg = recCnt > 0
          ? '彻底删除「' + t.name + '」？将连同其 ' + recCnt + ' 条打卡记录一起删除，不可恢复。'
          : '彻底删除「' + t.name + '」？该事项将从列表中移除。';
        ckConfirm({ title: '彻底删除', okText: '删除', danger: true, message: msg }).then(function (ok) {
          if (!ok) return;
          state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; });
          clearRecords(t.id);
          save(); renderManage(); toast('已彻底删除');
        });
      });
      aUl.appendChild(li);
    });
  }

  // ---------- 新增/编辑弹层 ----------
  var editModal = document.getElementById('ck-modal-edit');
  var editing = null; // null=新增
  var form = { cycle: 'daily', weekdays: [], color: '#4f7cff', startDate: '', endDate: '' };

  document.getElementById('ck-btn-add').addEventListener('click', function () { openEdit(null); });
  document.getElementById('ck-btn-cancel').addEventListener('click', closeEdit);

  function openEdit(task) {
    editing = task;
    document.getElementById('ck-modal-title').textContent = task ? '编辑事项' : '新增事项';
    document.getElementById('ck-f-name').value = task ? task.name : '';
    form.cycle = task ? task.cycle : 'daily';
    form.weekdays = task ? (task.weekdays || []).slice() : [];
    form.color = task ? task.color : '#4f7cff';
    form.startDate = task ? (task.startDate || '') : '';
    form.endDate = task ? (task.endDate || '') : '';
    document.getElementById('ck-f-cycle').value = form.cycle;
    document.getElementById('ck-f-start').value = form.startDate;
    document.getElementById('ck-f-end').value = form.endDate;
    syncCycleUI();
    syncWeekdayUI();
    syncColorUI();
    editModal.classList.remove('ck-hidden');
  }
  function closeEdit() { editModal.classList.add('ck-hidden'); }

  document.getElementById('ck-f-cycle').addEventListener('change', function (e) {
    form.cycle = e.target.value; syncCycleUI();
  });
  function syncCycleUI() {
    document.getElementById('ck-f-weekdays').classList.toggle('ck-hidden', form.cycle !== 'custom');
  }
  document.querySelectorAll('#ck-f-weekdays button').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = +b.dataset.d, i = form.weekdays.indexOf(d);
      if (i === -1) form.weekdays.push(d); else form.weekdays.splice(i, 1);
      syncWeekdayUI();
    });
  });
  function syncWeekdayUI() {
    document.querySelectorAll('#ck-f-weekdays button').forEach(function (b) {
      b.classList.toggle('ck-on', form.weekdays.indexOf(+b.dataset.d) !== -1);
    });
  }
  document.querySelectorAll('#ck-f-colors i').forEach(function (el) {
    el.style.background = el.dataset.c; // 色块背景取自 data-c
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', function () {
      form.color = el.dataset.c; syncColorUI();
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  });
  function syncColorUI() {
    document.querySelectorAll('#ck-f-colors i').forEach(function (el) {
      el.classList.toggle('ck-on', el.dataset.c === form.color);
    });
  }

  document.getElementById('ck-btn-save').addEventListener('click', function () {
    var name = document.getElementById('ck-f-name').value.trim();
    if (!name) { toast('请填写事项名称'); return; }
    if (form.cycle === 'custom' && !form.weekdays.length) { toast('请至少选择一天'); return; }
    var startDate = document.getElementById('ck-f-start').value || '';
    var endDate = document.getElementById('ck-f-end').value || '';
    if (startDate && endDate && startDate > endDate) { toast('结束日期不能早于开始日期'); return; }
    if (editing) {
      editing.name = name; editing.cycle = form.cycle;
      editing.weekdays = form.weekdays.slice(); editing.color = form.color;
      editing.startDate = startDate; editing.endDate = endDate;
    } else {
      state.tasks.push({
        id: 't' + Date.now(), name: name, cycle: form.cycle,
        weekdays: form.weekdays.slice(), color: form.color,
        startDate: startDate, endDate: endDate, archived: false
      });
    }
    save(); closeEdit();
    showView('ck-view-manage');
    toast('已保存');
  });

  // ---------- 数据备份 ----------
  document.getElementById('ck-btn-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '打卡备份-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出备份文件');
  });
  document.getElementById('ck-btn-import').addEventListener('click', function () {
    document.getElementById('ck-file-import').click();
  });
  document.getElementById('ck-file-import').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(reader.result);
        if (!d.tasks || !d.records) throw new Error('格式不符');
        state = { tasks: d.tasks, records: d.records };
        save(); renderManage(); toast('导入成功');
      } catch (err) { toast('导入失败：' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(f);
  });

  // ---------- 工具 ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('ck-toast');
    el.textContent = msg; el.classList.remove('ck-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('ck-hidden'); }, 1800);
  }

  // 自定义确认弹框（代替浏览器原生 confirm），返回 Promise<boolean>
  var confirmModal = document.getElementById('ck-modal-confirm');
  var confirmResolve = null;
  function ckConfirm(opts) {
    opts = opts || {};
    document.getElementById('ck-confirm-title').textContent = opts.title || '请确认';
    document.getElementById('ck-confirm-msg').textContent = opts.message || '';
    var okBtn = document.getElementById('ck-confirm-ok');
    okBtn.textContent = opts.okText || '确定';
    okBtn.classList.toggle('ck-danger', !!opts.danger);
    var cancelBtn = document.getElementById('ck-confirm-cancel');
    if (opts.cancel === false) {
      cancelBtn.classList.add('ck-hidden'); // 纯提示模式：只留一个确定按钮
    } else {
      cancelBtn.classList.remove('ck-hidden');
      cancelBtn.textContent = opts.cancelText || '取消';
    }
    confirmModal.classList.remove('ck-hidden');
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }
  function closeConfirm(result) {
    confirmModal.classList.add('ck-hidden');
    if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
  }
  document.getElementById('ck-confirm-ok').addEventListener('click', function () { closeConfirm(true); });
  document.getElementById('ck-confirm-cancel').addEventListener('click', function () { closeConfirm(false); });
  // 点击遮罩层取消
  confirmModal.addEventListener('click', function (e) { if (e.target === confirmModal) closeConfirm(false); });
  // ESC 取消
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !confirmModal.classList.contains('ck-hidden')) closeConfirm(false);
  });

  // ---------- 版本戳：确认手机上的文件是否为最新版 + 点击查内核信息 ----------
  var verEl = document.getElementById('ck-version-line');
  if (verEl) {
    verEl.textContent = '轻打卡 Lika · ' + CK_VERSION + ' · 点击查看浏览器信息';
    verEl.addEventListener('click', function () {
      ckConfirm({
        title: '浏览器信息',
        message: navigator.userAgent + '\n\n请把这串信息发给开发者，用于定位内核版本。',
        okText: '知道了', cancel: false
      });
    });
  }

  // ---------- Service Worker（离线支持） ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js')
        .then(function (reg) {
          // 回到前台时主动检查更新，配合 network-first/SWR 策略尽快生效
          document.addEventListener('visibilitychange', function () {
            if (!document.hidden && reg) reg.update();
          });
        })
        .catch(function () { /* file:// 下忽略 */ });
    });
  }

  // ---------- 首次进入：预置一条示例事项，帮助用户快速上手 ----------
  if (!storeGet('ck_seeded')) {
    storeSet('ck_seeded', '1');
    if (!state.tasks.length) {
      state.tasks.push({ id: 't' + Date.now(), name: '晨读 15 分钟', cycle: 'daily', weekdays: [], color: '#4f7cff', startDate: '', endDate: '', archived: false });
      save();
    }
  }

  renderToday();
})();
