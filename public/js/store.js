const WELCOME = 'سلام. من مشاور شما هستم؛ در زمینهی روانشناسی، روانکاوی، روابط، زبان بدن و احساسات همراهتان هستم. هرچه بگویید با دقت میشنوم و تحلیل میکنم — بدون تایید بیجا و بدون حدس بیاساس. آمادهام؛ شروع کنید.';

const Store = (() => {
  const KEYS = {
    config: 'advisor.config',
    memory: 'advisor.memory',
    threads: 'advisor.threads',
    active: 'advisor.activeThread',
  };

  function load(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : def;
    } catch (e) { return def; }
  }

  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  const defaultConfig = () => ({
    baseUrl: 'https://api.openai.com',
    model: '',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 1200,
    specialties: [],
    autoProfile: true,
    autoExportMin: 0,
    lastExport: 0,
    dailyBudget: 50000,
  });

  const defaultMemory = () => ({ golden: [], recent: [], summary: [], usage: { total: 0, day: 0, dayKey: '' } });

  let config = load(KEYS.config, defaultConfig());
  let memory = load(KEYS.memory, defaultMemory());
  let threads = load(KEYS.threads, []);
  let activeThreadId = load(KEYS.active, null);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function persist() {
    save(KEYS.config, config);
    save(KEYS.memory, memory);
    save(KEYS.threads, threads);
    save(KEYS.active, activeThreadId);
  }

  function getActiveThread() {
    return threads.find(t => t.id === activeThreadId) || null;
  }

  function createThread(title, contextSummary, withWelcome) {
    const t = {
      id: uid(),
      title: title || 'گفتگوی جدید',
      createdAt: Date.now(),
      nodes: [],
      leafId: null,
      contextSummary: contextSummary || '',
    };
    threads.push(t);
    activeThreadId = t.id;
    if (withWelcome) {
      const welcome = { id: uid(), parentId: null, role: 'assistant', content: WELCOME, ts: Date.now() };
      t.nodes.push(welcome);
      t.leafId = welcome.id;
    }
    persist();
    return t;
  }

  function activeBranchNodes(thread) {
    if (!thread || !thread.nodes.length) return [];
    const byId = {};
    thread.nodes.forEach(n => { byId[n.id] = n; });
    const pathNodes = [];
    let cur = byId[thread.leafId] || thread.nodes[0];
    while (cur) {
      pathNodes.unshift(cur);
      cur = cur.parentId ? byId[cur.parentId] : null;
    }
    return pathNodes;
  }

  function addMessage(thread, role, content) {
    const node = { id: uid(), parentId: thread.leafId, role, content, ts: Date.now() };
    thread.nodes.push(node);
    thread.leafId = node.id;
    persist();
    return node;
  }

  function branchFrom(thread, nodeId) {
    const parent = thread.nodes.find(n => n.id === nodeId);
    if (!parent) return null;
    const child = {
      id: uid(),
      parentId: nodeId,
      role: 'system',
      content: '— شاخه‌ی جدید از این پیام —',
      ts: Date.now(),
    };
    thread.nodes.push(child);
    thread.leafId = child.id;
    persist();
    return child;
  }

  function setActiveLeaf(thread, leafId) {
    thread.leafId = leafId;
    persist();
  }

  function deleteThread(id) {
    threads = threads.filter(t => t.id !== id);
    if (activeThreadId === id) {
      activeThreadId = threads.length ? threads[threads.length - 1].id : null;
    }
    persist();
  }

  function allLeaves(thread) {
    const parentIds = new Set(thread.nodes.map(n => n.parentId).filter(Boolean));
    return thread.nodes.filter(n => !parentIds.has(n.id));
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function recordUsage(usage) {
    if (!usage) return;
    const u = memory.usage;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const total = prompt + completion;
    if (!total) return;
    u.total += total;
    const key = todayKey();
    if (u.dayKey !== key) { u.dayKey = key; u.day = 0; }
    u.day += total;
    persist();
  }

  function dayTokens() {
    const u = memory.usage;
    if (u.dayKey !== todayKey()) { u.dayKey = todayKey(); u.day = 0; persist(); }
    return u.day;
  }

  return {
    config,
    memory,
    threads,
    get activeThreadId() { return activeThreadId; },
    setActiveThreadId(id) { activeThreadId = id; persist(); },
    persist,
    uid,
    createThread,
    getActiveThread,
    activeBranchNodes,
    addMessage,
    branchFrom,
    setActiveLeaf,
    deleteThread,
    allLeaves,
    recordUsage,
    dayTokens,
    defaultConfig,
    defaultMemory,
  };
})();
