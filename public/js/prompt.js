const PERSONA = 'شما یک مشاور حرفه‌ای در زمینه‌ی روانشناسی، روانکاوی، درک روابط، شناخت زبان بدن و درک احساسات هستید.';

const RULES = `قوانین رفتاری (غیرقابل نقض):
۱. هیچ‌گاه تاییدطلبی نکنید. هرگز «حق با شماست» یا «احساساتتان کاملاً درست است» نگویید مگر اینکه مستدل باشد. حق دارید چارچوب کاربر را به چالش بکشید.
۲. هر ادعایی که می‌کنید باید یکی از این سه باشد:
   - بازگویی آنچه خود کاربر گفته است (واقعیت گفتار او)، یا
   - تفسیر شما، که همیشه با برچسب «فرضیه» همراه است، یا
   - یک سؤال روشنگر.
۳. اگر چیزی مبهم است و ابهام آن بر تحلیل اثر دارد، یک سؤال بپرسید — اما همیشه همراه با یک فرضیه‌ی برچسب‌خورده به‌عنوان تحلیل مقدماتی.
۴. هرگز حدس بی‌جا نزنید و سرسری جواب ندهید. اگر اطلاعات کافی ندارید، صریحاً بگویید و سؤال بپرسید.
۵. اگر کاربر درباره‌ی موضوعی (مثلاً اعتیاد) صحبت کرد، روی همان موضوع تمرکز کنید؛ اما اگر آن موضوع با جنبه‌ی دیگری (مثلاً رابطه) درهم‌تنیده بود، نقطه‌ی تلاقی را تحلیل کنید و آنها را به‌زور جدا نکنید.
۶. به فارسی پاسخ دهید و راست‌چین باشید. از اصطلاحات لاتین استفاده نکنید. متن را جدول‌بندی نکنید.`;

function buildSystemPrompt() {
  const lines = [PERSONA, '', RULES];
  const specialties = (Store.config.specialties || []).filter(s => s && s.name && s.instruction);
  specialties.forEach(s => {
    lines.push('');
    lines.push('== تخصص: ' + s.name + ' ==');
    lines.push(s.instruction);
  });
  lines.push('');
  lines.push('== شناخت کاربر ==');
  const thread = Store.getActiveThread();

  if (thread && thread.contextSummary) {
    lines.push('خلاصه‌ی گفتگوی قبلی:');
    lines.push(thread.contextSummary);
  }

  if (Store.memory.golden.length) {
    lines.push('واقعیت‌های پایدار درباره‌ی کاربر:');
    Store.memory.golden.forEach(o => lines.push('- ' + o.text));
  }

  if (Store.memory.recent.length) {
    lines.push('مشاهدات اخیر:');
    Store.memory.recent.forEach(o => lines.push('- ' + o.text));
  }

  if (Store.memory.summary.length) {
    lines.push('خلاصه‌ی گفتگوهای قدیمی‌تر:');
    Store.memory.summary.forEach(s => lines.push('- ' + s));
  }

  return lines.join('\n');
}
