// DeepSeek API 调用助手
// 2026-07 起 deepseek-chat / deepseek-reasoner 已停用，现用 v4 系列：
//   deepseek-v4-flash（快、省，1M 上下文） / deepseek-v4-pro（更强）
// 注意：v4 默认开启「思考模式」，思考 token 计入输出且拖慢响应；
//       简单任务用 thinking:{type:'disabled'} 实测可省约 80% token。

export const DEFAULT_MODEL = 'deepseek-v4-flash';

export async function askDeepSeek(apiKey, system, user, opts = {}) {
  const {
    temperature = 0.7,
    maxTokens = 3000,
    thinking = 'off', // 'off' | 'auto'
    model = DEFAULT_MODEL,
  } = opts;

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (thinking === 'off') body.thinking = { type: 'disabled' };

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    let hint = '';
    if (res.status === 401) hint = 'API Key 无效，请检查「导入与设置」里的 Key';
    else if (res.status === 402) hint = 'DeepSeek 账户余额不足，请到 platform.deepseek.com 充值';
    else if (res.status === 429) hint = '请求过于频繁，请稍后再试';
    const err = new Error(hint || `DeepSeek API 错误 (HTTP ${res.status})`);
    err.detail = t.slice(0, 300);
    err.status = res.status;
    throw err;
  }

  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

// 流式调用：边生成边回调，用于把"首字等待"从十几秒压到 1 秒级
// onDelta(text) 每收到一段增量文本就调用一次；返回完整文本
export async function askDeepSeekStream(apiKey, system, user, opts = {}, onDelta = () => {}) {
  const {
    temperature = 0.7,
    maxTokens = 3000,
    thinking = 'off',
    model = DEFAULT_MODEL,
    signal,
  } = opts;

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };
  if (thinking === 'off') body.thinking = { type: 'disabled' };

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const t = await res.text();
    let hint = '';
    if (res.status === 401) hint = 'API Key 无效，请检查「导入与设置」里的 Key';
    else if (res.status === 402) hint = 'DeepSeek 账户余额不足，请到 platform.deepseek.com 充值';
    else if (res.status === 429) hint = '请求过于频繁，请稍后再试';
    const err = new Error(hint || `DeepSeek API 错误 (HTTP ${res.status})`);
    err.detail = t.slice(0, 300);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const piece = j.choices?.[0]?.delta?.content ?? '';
        if (piece) { full += piece; onDelta(piece); }
      } catch { /* 忽略半包 */ }
    }
  }
  return full;
}
