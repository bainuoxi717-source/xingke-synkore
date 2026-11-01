// Presentation-only redaction. Source records, request IDs and saved files stay intact.
export const showcasePrivacy = true;

export function displayTeacher(value = '') {
  if (!showcasePrivacy) return value;
  if (!String(value).trim()) return '课程老师';
  if (['课程老师', '教师待补充', '未知教师'].includes(value)) return value;
  return [...new Set(String(value).split(/[、,，;；/\s]+/).filter(Boolean).map((name) => {
    if (!/^[\u4e00-\u9fff]{2,8}$/.test(name)) return '课程老师';
    const surname = /^(欧阳|司马|上官|诸葛|东方|夏侯|皇甫|尉迟|公孙|慕容|司徒|司空)/.exec(name)?.[1] || name[0];
    return `${surname}老师`;
  }))].join('、');
}

export function redactShowcaseText(value = '', knownNames = []) {
  let text = String(value ?? '');
  if (!showcasePrivacy) return text;
  for (const name of knownNames.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const part of String(name).split(/[、,，;；/\s]+/).filter(Boolean)) text = text.split(part).join(displayTeacher(part));
  }
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '邮箱已隐藏')
    .replace(/(?:\+?86[ -]?)?1[3-9]\d{9}/g, '手机号已隐藏')
    .replace(/(?:学号|工号|学生编号)\s*[:：]?\s*[A-Za-z0-9-]+/g, '编号已隐藏')
    .replace(/\b\d{8,}\b/g, '编号已隐藏')
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)*sjtu\.edu\.cn(?:\/[^\s)\]<>]*)?/gi, '校内链接已隐藏')
    .replace(/上海交通大学|上海交大|交大|SJTU/gi, '某高校')
    .replace(/[A-Z]:[\\/](?:Users|用户)[\\/][^\s\n<>]+/gi, '本地路径已隐藏');
}

export const displayCourse = (name = '') => showcasePrivacy
  ? redactShowcaseText(name).replace(/[（(][ABＣABCＤDＡＢ]类[）)]/g, '').trim()
  : name;
export const displayLocation = (location = '') => showcasePrivacy ? (location ? '校内教室' : '地点待补充') : location;
export const displayFilename = (name = '', kind) => redactShowcaseText(String(name).split(/[\\/]/).at(-1) || '学习资料');
export function displayAttachmentName(attachment = {}) {
  if (!showcasePrivacy) return attachment.name || '学习资料';
  if (attachment.kind === 'lecture-note') {
    const lesson = attachment.leti || /第([^·\s]+)节/.exec(attachment.name || '')?.[1];
    return `${displayCourse(attachment.courseName || '课程笔记')}${lesson ? ` · 第${lesson}节` : ''}`;
  }
  return redactShowcaseText(displayFilename(attachment.name), [attachment.teacher]);
}
export const displayAssignmentTitle = (title = '') => redactShowcaseText(title);
