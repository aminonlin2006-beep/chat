const Api = {
  async chat(messages) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: Store.config, messages }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'خطا در ارتباط با مدل');
    return { content: j.content, usage: j.usage || null };
  },

  async summarize(conversation) {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: Store.config, conversation }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'خطا در خلاصه‌سازی');
    return { summary: j.summary, usage: j.usage || null };
  },

  async extract(conversation) {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: Store.config, conversation }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'خطا در استخراج');
    return { observations: j.observations || [], usage: j.usage || null };
  },
};
