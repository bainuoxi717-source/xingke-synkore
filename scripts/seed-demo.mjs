import fs from 'node:fs';
import { q1, run, nowISO } from '../server/src/db.js';
const examples = JSON.parse(fs.readFileSync(new URL('../examples/courses.json', import.meta.url), 'utf8'));
for (const example of examples) {
  if (q1('SELECT id FROM lectures WHERE cour_id=?', example.courId)) continue;
  let course = q1('SELECT id FROM courses WHERE code=?', 'PUBLIC-DEMO');
  if (!course) {
    run('INSERT INTO courses(code,name,teacher,category) VALUES(?,?,?,?)', 'PUBLIC-DEMO', '实验设计入门（公开示例）', '林老师（虚构）', '示例');
    course = q1('SELECT id FROM courses WHERE code=?', 'PUBLIC-DEMO');
  }
  run(`INSERT INTO lectures(cour_id,course_id,subj_code,subj_name,teacher,leti_number,begin_time,end_time,duration_sec,transcript,transcript_json,speakers,fetched_at,note)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, example.courId, course.id, 'PUBLIC-DEMO', '实验设计入门（公开示例）', '林老师（虚构）', example.number,
    example.date + ' 09:00:00', example.date + ' 09:05:00', 300, example.segments.map(x => x.text).join('\n'),
    JSON.stringify(example.segments.map(x => ({ start: x.at * 1000, end: (x.at + 18) * 1000, text: x.text }))),
    JSON.stringify(example.segments.map(() => 'T')), nowISO(), '人工编写的虚构教学示例，不是真实课堂记录');
}
console.log('公开示例课程已就绪（重复运行不会覆盖已有课次）。');
