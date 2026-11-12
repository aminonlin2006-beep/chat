(function () {
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function currentThread() { return Store.getActiveThread(); }

  function ensureThread() {
    let t = currentThread();
    if (!t) t = Store.createThread('', false, true);
    return t;
  }

  function render() {
    renderThreadList();
    renderBranches();
    renderMessages();
    updateTokenCounter();
  }

  let searchQuery = '';

  function renderThreadList() {
    const ul = $('#thread-list');
    ul.innerHTML = '';
    const q = searchQuery.trim().toLowerCase();
    let list = Store.threads.slice().reverse();
    if (q) {
      list = list.filter(t => {
        if (t.title.toLowerCase().includes(q)) return true;
        return t.nodes.some(n => n.content && n.content.toLowerCase().includes(q));
      });
    }
    list.forEach(t => {
      const li = document.createElement('li');
      li.className = 'thread-item' + (t.id === Store.activeThreadId ? ' active' : '');
      const span = document.createElement('span');
      span.className = 'thread-title';
      span.textContent = t.title;
      li.appendChild(span);
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.textContent = '✕';
      del.title = 'حذف گفتگو';
      del.onclick = e => {
        e.stopPropagation();
        if (confirm('این گفتگو حذف شود؟')) { Store.deleteThread(t.id); render(); }
      };
      li.appendChild(del);
      li.onclick = () => { Store.setActiveThreadId(t.id); render(); };
      ul.appendChild(li);
    });
  }

  function renderBranches() {
    const ul = $('#branch-list');
    const t = currentThread();
    ul.innerHTML = '';
    if (!t) return;
    Store.allLeaves(t).forEach(leaf => {
      const li = document.createElement('li');
      li.className = 'branch-item' + (leaf.id === t.leafId ? ' active' : '');
      li.textContent = leaf.content.slice(0, 40) || '(بدون پیام)';
      li.onclick = () => { Store.setActiveLeaf(t, leaf.id); render(); };
      ul.appendChild(li);
    });
  }

  function renderMessages() {
    const container = $('#messages');
    const t = currentThread();
    container.innerHTML = '';
    if (!t) {
      container.innerHTML = '<div class="empty-state">برای شروع، پیامی بنویسید.</div>';
      return;
    }
    const nodes = Store.activeBranchNodes(t);
    nodes.forEach(node => {
      if (node.role === 'system') return; // نشانگر شاخه
      const div = document.createElement('div');
      div.className = 'msg ' + (node.role === 'user' ? 'user' : 'assistant');
      const inner = document.createElement('div');
      inner.className = 'bubble';
      inner.textContent = node.content;
      div.appendChild(inner);

      if (node.role === 'user') {
        const actions = document.createElement('div');
        actions.className = 'msg-actions';
        const branchBtn = document.createElement('button');
        branchBtn.className = 'link-btn';
        branchBtn.textContent = 'شاخه از اینجا';
        branchBtn.onclick = () => { Store.branchFrom(t, node.id); render(); };
        actions.appendChild(branchBtn);
        div.appendChild(actions);
      }
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'msg assistant';
    div.id = 'typing';
    div.innerHTML = '<div class="bubble typing">در حال فکر کردن…</div>';
    $('#messages').appendChild(div);
    $('#messages').scrollTop = $('#messages').scrollHeight;
  }

  function removeTyping() {
    const el = $('#typing');
    if (el) el.remove();
  }

  async function sendMessage() {
    const input = $('#input');
    const text = input.value.trim();
    if (!text) return;

    if (!Store.config.model || !Store.config.apiKey) {
      alert('ابتدا در «تنظیمات» نام مدل و کلید API را وارد کنید.');
      openSettings();
      return;
    }

    const budget = Store.config.dailyBudget || 0;
    if (budget > 0 && Store.dayTokens() >= budget) {
      alert('به سقف بودجهی روزانهی توکن رسیدهاید (' + budget.toLocaleString('fa-IR') + ' توکن). در «تنظیمات» سقف را بالا ببرید یا فردا ادامه دهید.');
      return;
    }

    let t = ensureThread();
    if (!t.title || t.title === 'گفتگوی جدید') {
      t.title = text.slice(0, 40);
      Store.persist();
    }

    Store.addMessage(t, 'user', text);
    input.value = '';
    render();

    const nodes = Store.activeBranchNodes(t);
    const MAX_MSGS = 24;
    const KEEP = 12;
    let messages;

    setBusy(true);
    addTyping();
    try {
      if (nodes.length > MAX_MSGS) {
        const oldNodes = nodes.slice(0, nodes.length - KEEP);
        const recentNodes = nodes.slice(nodes.length - KEEP);
        const conv = oldNodes.map(n => ({
          role: n.role === 'user' ? 'user' : 'assistant',
          content: n.content,
        }));
        let summary = '';
        try {
          const r = await Api.summarize(conv);
          summary = r.summary;
          Store.recordUsage(r.usage);
          t.autoSummary = summary;
          Store.persist();
        } catch (e) { /* در صورت خطا، بدون خلاصه ادامه میدهد */ }
        messages = [];
        if (summary) messages.push({ role: 'system', content: 'خلاصهی بخشهای قبلی گفتگو:\n' + summary });
        messages = messages.concat(recentNodes.map(n => ({
          role: n.role === 'user' ? 'user' : 'assistant',
          content: n.content,
        })));
        messages.unshift({ role: 'system', content: buildSystemPrompt() });
      } else {
        messages = nodes.map(n => ({
          role: n.role === 'user' ? 'user' : 'assistant',
          content: n.content,
        }));
        messages.unshift({ role: 'system', content: buildSystemPrompt() });
      }

      const reply = await Api.chat(messages);
      removeTyping();
      Store.addMessage(t, 'assistant', reply.content);
      Store.recordUsage(reply.usage);
      render();
      updateTokenCounter();
      if (Store.config.autoProfile) updateProfileSnapshot();
    } catch (e) {
      removeTyping();
      alert('خطا: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function continueInNewChat() {
    const t = currentThread();
    if (!t || !t.nodes.length) { alert('ابتدا یک گفتگو داشته باشید.'); return; }
    if (!Store.config.model || !Store.config.apiKey) {
      alert('ابتدا در «تنظیمات» نام مدل و کلید API را وارد کنید.');
      openSettings();
      return;
    }

    const conversation = Store.activeBranchNodes(t).map(n => ({
      role: n.role === 'user' ? 'user' : 'assistant',
      content: n.content,
    }));

    setBusy(true);
    try {
      const sr = await Api.summarize(conversation);
      const er = await Api.extract(conversation);
      Store.recordUsage(sr.usage);
      Store.recordUsage(er.usage);
      mergeObservations(er.observations);
      Store.createThread(null, sr.summary);
      render();
      updateTokenCounter();
      alert('گفتگوی جدید با حفظ حافظه ساخته شد.');
    } catch (e) {
      alert('خطا: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  function mergeObservations(obs) {
    const mem = Store.memory;
    (obs || []).forEach(o => {
      const text = String(o.text || '').trim();
      if (!text) return;
      const kind = o.kind === 'hypothesis' ? 'hypothesis' : 'explicit';
      if (kind === 'explicit') {
        const existing = mem.recent.find(r => r.text === text);
        if (existing) {
          existing.count = (existing.count || 1) + 1;
          if (existing.count >= 2 && !mem.golden.find(g => g.text === text)) {
            mem.golden.push({ text });
          }
        } else {
          mem.recent.push({ text, count: 1 });
        }
      } else {
        mem.recent.push({ text, count: 1 });
      }
    });
    if (mem.recent.length > 15) mem.recent = mem.recent.slice(-15);
    Store.persist();
  }

  function buildProfileText() {
    const mem = Store.memory;
    const lines = [];
    lines.push('شناخت کاربر (خروجی قابل حمل)');
    lines.push('====================');
    if (mem.golden.length) {
      lines.push('واقعیتهای پایدار:');
      mem.golden.forEach(o => lines.push('- ' + o.text));
    }
    if (mem.recent.length) {
      lines.push('مشاهدات اخیر:');
      mem.recent.forEach(o => lines.push('- ' + o.text));
    }
    if (mem.summary.length) {
      lines.push('خلاصهی گفتگوهای قبلی:');
      mem.summary.forEach(s => lines.push('- ' + s));
    }
    return lines.join('\n');
  }

  function updateProfileSnapshot() {
    Store.memory.profileSnapshot = buildProfileText();
    Store.persist();
  }

  function newChat() {
    Store.createThread('', false, true);
    render();
  }

  function setBusy(on) {
    const b = $('#btn-send');
    b.disabled = on;
    b.textContent = on ? 'در حال ارسال…' : 'ارسال';
  }

  function updateTokenCounter() {
    const el = $('#token-counter');
    if (!el) return;
    const day = Store.dayTokens();
    const budget = Store.config.dailyBudget || 0;
    el.textContent = '🔢 ' + day.toLocaleString('fa-IR');
    el.className = 'token-counter';
    if (budget > 0) {
      const pct = day / budget;
      if (pct >= 1) el.classList.add('crit');
      else if (pct >= 0.8) el.classList.add('warn');
    }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function exportProfileSnapshot() {
    const mem = Store.memory;
    mem.profileSnapshot = buildProfileText();
    mem.exports = mem.exports || [];
    mem.exports.push({ ts: Date.now(), text: mem.profileSnapshot });
    if (mem.exports.length > 50) mem.exports = mem.exports.slice(-50);
    Store.persist();
    toast('پروفایل به‌صورت خودکار ذخیره شد.');
  }

  function checkAutoExport() {
    const min = Store.config.autoExportMin || 0;
    if (!min) return;
    const now = Date.now();
    const last = Store.config.lastExport || 0;
    if (now - last >= min * 60000) {
      Store.config.lastExport = now;
      exportProfileSnapshot();
    }
  }

  function modal(html) {
    const root = $('#modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = html;
    overlay.appendChild(box);
    root.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    return overlay;
  }

  function openSettings() {
    const c = Store.config;
    const m = modal(`
      <h3>تنظیمات مدل</h3>
      <label>آدرس پایه API
        <input id="cfg-base" value="${esc(c.baseUrl)}" placeholder="https://api.openai.com">
      </label>
      <label>نام مدل
        <input id="cfg-model" value="${esc(c.model)}" placeholder="gpt-4o-mini">
      </label>
      <label>کلید API
        <input id="cfg-key" type="password" value="${esc(c.apiKey)}">
      </label>
      <label>دما (۰ تا ۱)
        <input id="cfg-temp" type="number" min="0" max="1" step="0.1" value="${c.temperature}">
      </label>
      <label class="check">
        <input id="cfg-auto" type="checkbox" ${c.autoProfile ? 'checked' : ''}>
        بهروزرسانی خودکار پروفایل بعد از هر پاسخ
      </label>
      <label>خروجی خودکار پروفایل (هر چند دقیقه؛ ۰ = غیرفعال)
        <input id="cfg-autoexport" type="number" min="0" step="5" value="${c.autoExportMin}">
      </label>
      <label>سقف بودجهی روزانه (توکن؛ ۰ = بدون محدودیت)
        <input id="cfg-budget" type="number" min="0" step="1000" value="${c.dailyBudget || 0}">
      </label>

      <h3 class="sub">تخصصهای اضافی</h3>
      <p class="hint">هر تخصص یک بلوک جداگانه به پیام سیستم اضافه میکند. میتوانید هر تعداد که بخواهید بسازید؛ مرز و دستورالعمل هر تخصص را بنویسید.</p>
      <div id="spec-list"></div>
      <button id="spec-add" class="btn">+ افزودن تخصص</button>

      <div class="modal-actions">
        <button id="cfg-save" class="btn primary">ذخیره</button>
        <button id="cfg-cancel" class="btn">انصراف</button>
      </div>
    `);

    const specList = $('#spec-list');
    function renderSpecs() {
      specList.innerHTML = '';
      const arr = Store.config.specialties || [];
      arr.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'spec-row';
        row.innerHTML = `
          <input class="spec-name" data-i="${i}" placeholder="نام تخصص" value="${esc(s.name)}">
          <textarea class="spec-instr" data-i="${i}" rows="2" placeholder="دستورالعمل و مرز این تخصص...">${esc(s.instruction)}</textarea>
          <button class="icon-btn spec-del" data-i="${i}" title="حذف">✕</button>
        `;
        specList.appendChild(row);
      });
      specList.querySelectorAll('.spec-del').forEach(b => {
        b.onclick = () => { Store.config.specialties.splice(+b.dataset.i, 1); renderSpecs(); };
      });
      specList.querySelectorAll('.spec-name').forEach(inp => {
        inp.oninput = () => { (Store.config.specialties[+inp.dataset.i] || {}).name = inp.value; };
      });
      specList.querySelectorAll('.spec-instr').forEach(inp => {
        inp.oninput = () => { (Store.config.specialties[+inp.dataset.i] || {}).instruction = inp.value; };
      });
    }
    renderSpecs();

    $('#spec-add').onclick = () => {
      if (!Store.config.specialties) Store.config.specialties = [];
      Store.config.specialties.push({ name: '', instruction: '' });
      renderSpecs();
    };

    $('#cfg-save').onclick = () => {
      Store.config.baseUrl = $('#cfg-base').value.trim() || Store.defaultConfig().baseUrl;
      Store.config.model = $('#cfg-model').value.trim();
      Store.config.apiKey = $('#cfg-key').value.trim();
      Store.config.temperature = parseFloat($('#cfg-temp').value) || 0.7;
      Store.config.autoProfile = $('#cfg-auto').checked;
      Store.config.autoExportMin = parseInt($('#cfg-autoexport').value, 10) || 0;
      Store.config.dailyBudget = parseInt($('#cfg-budget').value, 10) || 0;
      Store.config.specialties = (Store.config.specialties || []).filter(s => s.name.trim());
      Store.persist();
      m.remove();
    };
    $('#cfg-cancel').onclick = () => m.remove();
  }

  function openProfile() {
    const mem = Store.memory;

    function refresh() {
      $('#profile-text').value = buildProfileText();
    }

    const m = modal(`
      <h3>خروجی پروفایل</h3>
      <label>واقعیتهای پایدار (یکی در هر خط)
        <textarea id="prof-golden" rows="4"></textarea>
      </label>
      <label>مشاهدات اخیر (یکی در هر خط)
        <textarea id="prof-recent" rows="5"></textarea>
      </label>
      <label>پیشنمایش خروجی قابل حمل
        <textarea id="profile-text" readonly rows="8"></textarea>
      </label>
      <h3 class="sub">نسخههای زماندار</h3>
      <p class="hint">نسخههای خودکار ذخیرهشدهی پروفایل. روی هرکدام بزنید تا در پیشنمایش بالا نمایش داده شود.</p>
      <div id="prof-history"></div>
      <div class="modal-actions">
        <button id="prof-save" class="btn primary">ذخیره ویرایشها</button>
        <button id="prof-copy" class="btn">کپی متن</button>
        <button id="prof-dl-txt" class="btn">دانلود متن</button>
        <button id="prof-dl-json" class="btn">دانلود JSON</button>
        <button id="prof-close" class="btn">بستن</button>
      </div>
    `);

    $('#prof-golden').value = mem.golden.map(o => o.text).join('\n');
    $('#prof-recent').value = mem.recent.map(o => o.text).join('\n');
    refresh();

    const hist = $('#prof-history');
    const exports = mem.exports || [];
    if (!exports.length) {
      hist.innerHTML = '<p class="hint">هنوز نسخهی زمانداری ذخیره نشده است. خروجی خودکار را در تنظیمات فعال کنید.</p>';
    } else {
      exports.slice().reverse().forEach((ex, idx) => {
        const d = new Date(ex.ts);
        const stamp = d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR');
        const row = document.createElement('button');
        row.className = 'btn hist-row';
        row.style.cssText = 'display:block;width:100%;text-align:right;margin-bottom:6px;font-size:12px;';
        row.textContent = '#' + (exports.length - idx) + ' — ' + stamp + ' — ' + ex.text.length + ' کاراکتر';
        row.onclick = () => { $('#profile-text').value = ex.text; };
        hist.appendChild(row);
      });
    }

    $('#prof-save').onclick = () => {
      mem.golden = $('#prof-golden').value.split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ text }));
      mem.recent = $('#prof-recent').value.split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ text, count: 1 }));
      updateProfileSnapshot();
      refresh();
      alert('ویرایشها ذخیره شد.');
    };
    $('#prof-copy').onclick = () => { navigator.clipboard.writeText(buildProfileText()); alert('کپی شد.'); };
    $('#prof-dl-txt').onclick = () => download('profile.txt', buildProfileText());
    $('#prof-dl-json').onclick = () => download('profile.json', JSON.stringify({ golden: mem.golden, recent: mem.recent, summary: mem.summary }, null, 2));
    $('#prof-close').onclick = () => m.remove();
  }

  function download(name, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // رویدادها
  $('#btn-send').onclick = sendMessage;
  $('#input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('#btn-new-chat').onclick = newChat;
  $('#btn-continue').onclick = continueInNewChat;
  $('#btn-settings').onclick = openSettings;
  $('#btn-profile').onclick = openProfile;
  $('#btn-branches').onclick = () => $('#sidebar').classList.toggle('hidden');
  $('#search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderThreadList();
  });

  setInterval(checkAutoExport, 30000);

  render();
})();
