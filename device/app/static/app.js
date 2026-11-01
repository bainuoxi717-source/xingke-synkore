const state = { courses: [], courseId: "", feed: [] };
const $ = (selector) => document.querySelector(selector);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function notify(message, error = false) {
  const box = $("#notice");
  box.textContent = message;
  box.classList.toggle("error", error);
  box.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { box.hidden = true; }, error ? 6000 : 3500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData
      ? (options.headers || {})
      : { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    let detail = `请求失败（${response.status}）`;
    try { detail = (await response.json()).detail || detail; } catch (_) { /* no JSON */ }
    throw new Error(detail);
  }
  return response.json();
}

async function loadCourses(preferredId) {
  state.courses = await api("/api/courses");
  const select = $("#course-select");
  select.replaceChildren();
  if (!state.courses.length) {
    select.append(new Option("暂无课程", ""));
    $("#feed-list").replaceChildren();
    $("#empty-state").hidden = false;
    $("#mark-count").textContent = "";
    return;
  }
  $("#empty-state").hidden = true;
  state.courseId = preferredId && state.courses.some(c => c.id === preferredId)
    ? preferredId
    : (state.courseId && state.courses.some(c => c.id === state.courseId) ? state.courseId : state.courses[0].id);
  for (const course of state.courses) select.append(new Option(course.title, course.id));
  select.value = state.courseId;
  updateCourseSummary();
  await loadFeed();
}

function updateCourseSummary() {
  const course = state.courses.find(c => c.id === state.courseId);
  $("#mark-count").textContent = course ? `${course.mark_count} 个薄弱标记` : "";
}

async function loadFeed() {
  if (!state.courseId) return;
  $("#feed-list").replaceChildren(node("div", "notice", "正在整理你的学习信息流…"));
  try {
    state.feed = await api(`/api/feed?course_id=${encodeURIComponent(state.courseId)}`);
    renderFeed();
  } catch (error) {
    $("#feed-list").replaceChildren();
    notify(error.message, true);
  }
}

function createSource(post) {
  const source = node("details", "source");
  source.append(node("summary", "", `课件原文${post.source_page ? ` · 第 ${post.source_page} 页` : ""}`));
  source.append(node("p", "", post.source_excerpt || "暂无匹配的课件原文，请检查课件与课堂内容是否对应。"));
  return source;
}

function createReplies(post) {
  const wrapper = node("div", "replies");
  wrapper.hidden = true;
  post.replies.forEach((reply, index) => {
    const item = node("div", "reply");
    item.append(node("span", "reply-label", `详解 ${index + 1}`));
    item.append(document.createTextNode(reply.body));
    wrapper.append(item);
  });
  return wrapper;
}

function createMyth(post) {
  const box = node("div", "myth-box");
  box.append(node("p", "myth-statement", post.myth.statement));
  const choices = node("div", "myth-choices");
  const result = node("p", "myth-result");
  result.hidden = true;
  [true, false].forEach(value => {
    const button = node("button", "myth-choice", value ? "这句话对" : "这句话错");
    button.type = "button";
    button.addEventListener("click", () => {
      choices.querySelectorAll("button").forEach(b => { b.disabled = true; });
      button.classList.add("selected");
      const correct = value === post.myth.answer;
      result.classList.add(correct ? "correct" : "incorrect");
      result.textContent = `${correct ? "判断正确。" : "再想一想。"} 正确答案：这句话${post.myth.answer ? "对" : "错"}。${post.myth.explanation}`;
      result.hidden = false;
    });
    choices.append(button);
  });
  box.append(choices, result);
  return box;
}

async function sendFeedback(post, status, button) {
  button.disabled = true;
  try {
    await api("/api/feedback", { method: "POST", body: JSON.stringify({ post_id: post.id, status }) });
    notify(status === "mastered" ? "已记录掌握，后续会降低同类内容优先级。" : "已标记仍不懂，会增加同类内容推荐。");
    await loadFeed();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

function createPost(post, index) {
  const card = node("article", "post");
  card.style.animationDelay = `${Math.min(index * 45, 240)}ms`;
  card.dataset.knowledgePoint = post.knowledge_point;
  const top = node("div", "post-top");
  top.append(node("div", "avatar", post.kind === "myth" ? "辨" : "知"));
  const meta = node("div", "post-meta");
  meta.append(node("strong", "", post.knowledge_point || "课程知识点"));
  meta.append(node("span", "", post.kind === "myth" ? "主动判断 · 误区帖" : "薄弱点复习 · 知识帖"));
  top.append(meta);
  if (post.priority >= 85) top.append(node("span", "priority-badge", "优先补弱"));
  card.append(top, node("h2", "", post.title), node("p", "post-body", post.body));
  if (post.myth) card.append(createMyth(post));
  card.append(createSource(post));
  const replies = createReplies(post);
  card.append(replies);
  const actions = node("div", "post-actions");
  if (post.replies.length) {
    const expand = node("button", "action-button", `展开详解 ${post.replies.length}`);
    expand.type = "button";
    expand.setAttribute("aria-expanded", "false");
    expand.addEventListener("click", () => {
      replies.hidden = !replies.hidden;
      expand.textContent = replies.hidden ? `展开详解 ${post.replies.length}` : "收起详解";
      expand.setAttribute("aria-expanded", String(!replies.hidden));
    });
    actions.append(expand);
  }
  actions.append(node("span", "action-spacer"));
  const mastered = node("button", `action-button mastered${post.feedback === "mastered" ? " active" : ""}`, "✓ 已掌握");
  const confused = node("button", `action-button confused${post.feedback === "confused" ? " active" : ""}`, "? 仍不懂");
  mastered.type = confused.type = "button";
  mastered.addEventListener("click", () => sendFeedback(post, "mastered", mastered));
  confused.addEventListener("click", () => sendFeedback(post, "confused", confused));
  actions.append(mastered, confused);
  card.append(actions);
  return card;
}

function renderFeed() {
  const list = $("#feed-list");
  list.replaceChildren();
  if (!state.feed.length) {
    list.append(node("p", "empty-state", "这门课还没有生成学习内容。"));
    return;
  }
  state.feed.forEach((post, index) => list.append(createPost(post, index)));
}

async function seedDemo(button) {
  button.disabled = true;
  try {
    const result = await api("/api/demo/seed", { method: "POST", body: "{}" });
    await loadCourses(result.course_id);
    notify("演示课程已生成：可以体验主帖、详解和误区判断。");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

function showWeakPoints() {
  const first = document.querySelector(".priority-badge");
  if (first) first.closest(".post").scrollIntoView({ behavior: "smooth", block: "center" });
  else notify("当前没有优先补弱内容。");
}

function importProgress(message, error = false) {
  const box = $("#import-progress");
  box.textContent = message;
  box.classList.toggle("error", error);
}

function openDeviceDialog() {
  $("#post-import").hidden = !state.courseId;
  if (state.courseId) $("#import-course-id").value = state.courseId;
  $("#device-dialog").showModal();
}

$("#serial-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#import-submit");
  const courseId = $("#import-course-id").value.trim();
  const port = $("#import-port").value.trim();
  button.disabled = true;
  $("#post-import").hidden = true;
  importProgress(`正在通过 ${port} 接收 ${courseId}，长录音可能需要几分钟…`);
  try {
    const result = await api("/api/import/serial", {
      method: "POST", body: JSON.stringify({ course_id: courseId, port }),
    });
    importProgress(`导入完成：${result.mark_count} 个标记，${result.files.length} 个文件已通过完整性校验。`);
    $("#post-import").hidden = false;
    await loadCourses(courseId);
  } catch (error) { importProgress(error.message, true); }
  finally { button.disabled = false; }
});

$("#upload-document").addEventListener("click", async event => {
  const file = $("#document-file").files[0];
  if (!file) { importProgress("请先选择与课堂录音对应的课件。", true); return; }
  const button = event.currentTarget;
  const data = new FormData();
  data.append("upload", file);
  button.disabled = true;
  importProgress("正在提取课件文字并建立检索索引…");
  try {
    const result = await api(`/api/courses/${encodeURIComponent(state.courseId)}/document`, { method: "POST", body: data });
    importProgress(`课件处理完成，共建立 ${result.chunk_count} 个可检索片段。`);
  } catch (error) { importProgress(error.message, true); }
  finally { button.disabled = false; }
});

$("#transcribe-course").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  importProgress("正在进行本地语音识别。首次运行可能需要下载模型，长录音请耐心等待…");
  try {
    const result = await api(`/api/courses/${encodeURIComponent(state.courseId)}/transcribe`, { method: "POST", body: "{}" });
    importProgress(`语音识别完成，共 ${result.segment_count} 个带时间戳片段。`);
  } catch (error) { importProgress(error.message, true); }
  finally { button.disabled = false; }
});

$("#generate-feed").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  importProgress("正在检索课件并优先整理你的薄弱知识点…");
  try {
    const result = await api(`/api/courses/${encodeURIComponent(state.courseId)}/generate`, { method: "POST", body: "{}" });
    await loadCourses(state.courseId);
    importProgress(`已生成 ${result.post_count} 条学习内容。`);
    $("#device-dialog").close();
    notify("学习信息流已更新。 ");
  } catch (error) { importProgress(error.message, true); }
  finally { button.disabled = false; }
});

$("#close-dialog").addEventListener("click", () => $("#device-dialog").close());
$("#device-dialog").addEventListener("click", event => {
  if (event.target === $("#device-dialog")) $("#device-dialog").close();
});

$("#course-select").addEventListener("change", async event => {
  state.courseId = event.target.value;
  updateCourseSummary();
  await loadFeed();
});
$("#demo-button").addEventListener("click", event => seedDemo(event.currentTarget));
$("#empty-demo-button").addEventListener("click", event => seedDemo(event.currentTarget));
["#weak-nav", "#mobile-weak"].forEach(id => $(id).addEventListener("click", showWeakPoints));
["#device-nav", "#mobile-device"].forEach(id => $(id).addEventListener("click", openDeviceDialog));
$("#courses-nav").addEventListener("click", async () => {
  if (!state.courseId) { notify("请先导入一节课。"); return; }
  const url = `/static/card_results/${encodeURIComponent(state.courseId)}.html`;
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok) window.location.assign(url);
    else { openDeviceDialog(); notify("使用读卡器导入器处理后，即可查看录音与完整转写。"); }
  } catch (error) { notify(error.message, true); }
});

(async function start() {
  try {
    const health = await api("/api/health");
    $("#import-port").value = health.serial_port || "COM5";
    $("#connection-status").textContent = "本地服务已连接";
    $("#connection-status").classList.add("online");
    await loadCourses(new URLSearchParams(window.location.search).get("course"));
  } catch (error) {
    $("#connection-status").textContent = "服务连接失败";
    notify(`${error.message}。请确认本地后端已经启动。`, true);
    $("#empty-state").hidden = false;
  }
})();
