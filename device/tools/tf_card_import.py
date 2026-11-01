"""TF reader import: native folder picker, local ASR, existing website results."""
from __future__ import annotations
import argparse
import ctypes
import json
from pathlib import Path
import queue
import sys
import threading
import time
import wave
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if sys.stdout is not None:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from app.card_import import discover_card_courses, import_card_course
from app.card_report import publish_card_report
from app.db import connection, init_db
from app.generator import _llm_available, generate_course_posts
from app.pipeline import transcribe_course


def website_url():
    import httpx
    with httpx.Client(timeout=.4, trust_env=False) as client:
        for port in [8769, *range(8765, 8769), *range(8770, 8785)]:
            base = f'http://127.0.0.1:{port}'
            try:
                health = client.get(base + '/api/health').json()
                if isinstance(health, dict) and health.get('service') == 'zhiliu':
                    return base
            except (httpx.HTTPError, ValueError):
                pass
    return None


def process_courses(paths, emit, *, transcribe=True):
    init_db()
    base = website_url()
    results = []
    for index, path in enumerate(paths, 1):
        emit(f'{index}/{len(paths)} · 正在导入并校验 {path.name}')
        result = import_card_course(path)
        course_id = result['course_id']
        with connection() as db:
            course = db.execute('SELECT transcript_status FROM courses WHERE id=?', (course_id,)).fetchone()
        if transcribe and course['transcript_status'] != 'ready':
            emit(f'{index}/{len(paths)} · 正在本地转写 {path.name}，长录音请耐心等待')
            result['segment_count'] = transcribe_course(course_id)
        with connection() as db:
            segment_count = db.execute('SELECT COUNT(*) FROM transcripts WHERE course_id=?', (course_id,)).fetchone()[0]
            post_count = db.execute('SELECT COUNT(*) FROM posts WHERE course_id=?', (course_id,)).fetchone()[0]
        result['segment_count'] = segment_count
        if segment_count and result['mark_count'] and not post_count and not _llm_available():
            emit(f'{index}/{len(paths)} · 正在生成本地模板学习流')
            result['generation'] = generate_course_posts(course_id)
        report = publish_card_report(course_id)
        result['result_page'] = str(report)
        result['url'] = (base + '/static/card_results/' + course_id + '.html') if base else report.as_uri()
        result['source_directory'] = str(path)
        results.append(result)
    folder = ROOT / 'reproduction/card-reader'
    folder.mkdir(parents=True, exist_ok=True)
    log = folder / ('import-' + time.strftime('%Y%m%d-%H%M%S') + '.json')
    log.write_text(json.dumps({'ok':True,'courses':results},ensure_ascii=False,indent=2),encoding='utf-8')
    return results


def removable_roots():
    if sys.platform != 'win32': return []
    kernel = ctypes.windll.kernel32
    kernel.GetLogicalDrives.restype = ctypes.c_uint32
    kernel.GetDriveTypeW.argtypes = [ctypes.c_wchar_p]
    kernel.GetDriveTypeW.restype = ctypes.c_uint32
    mask = kernel.GetLogicalDrives()
    return [Path(f'{chr(65+i)}:/') for i in range(26) if mask & (1<<i)
            and kernel.GetDriveTypeW(f'{chr(65+i)}:\\') == 2]


def gui():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    root = tk.Tk()
    root.title('知流 · 读卡器导入并转写')
    root.geometry('650x430')
    root.minsize(560, 360)
    root.option_add('*Font', ('Microsoft YaHei UI', 10))
    paths = []
    events = queue.Queue()
    busy = False
    frame = ttk.Frame(root, padding=20)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame,text='从 TF 卡导入课堂录音',font=('Microsoft YaHei UI',16,'bold')).pack(anchor='w')
    ttk.Label(frame,text='选择卡里的 courses 文件夹，或其中的一节课。导入时保留卡上原文件。',wraplength=590).pack(anchor='w',pady=(8,12))
    location = tk.StringVar(value='请先接入读卡器，再选择文件夹')
    status = tk.StringVar(value='选择课程后，点击“导入并转写”。可按 Ctrl 多选。')
    ttk.Label(frame,textvariable=location,wraplength=590).pack(anchor='w')
    listing = tk.Listbox(frame, selectmode='extended', exportselection=False, height=9)
    listing.pack(fill='both',expand=True,pady=12)
    controls = ttk.Frame(frame)
    controls.pack(fill='x')
    def select():
        if busy: return
        drives=removable_roots()
        selected=filedialog.askdirectory(parent=root,title='选择 TF 卡的 courses 或 course_xxx 文件夹',
                                         initialdir=str(drives[0]) if drives else str(Path.home()))
        if not selected: return
        try:
            found=discover_card_courses(Path(selected))
            paths[:] = found
            listing.delete(0,'end')
            for path in paths:
                try:
                    with wave.open(str(path/'audio.wav'),'rb') as w: seconds=round(w.getnframes()/w.getframerate())
                    label=f'{path.name}  ·  {seconds//60:02d}:{seconds%60:02d}'
                except (OSError,wave.Error,EOFError,ZeroDivisionError): label=path.name+'  ·  待检查'
                listing.insert('end',label)
            if len(paths)==1: listing.selection_set(0)
            location.set(selected)
            status.set(f'发现 {len(paths)} 节已保存课程，请选择要转写的课程。' if paths else '没有找到 audio.wav 和 marks.json，请选择正确的课程文件夹。')
        except Exception as exc: messagebox.showerror('读取失败',str(exc),parent=root)
    def start():
        nonlocal busy
        chosen=[paths[i] for i in listing.curselection()]
        if not chosen:
            messagebox.showinfo('选择课程','请先选择要导入的课程。',parent=root); return
        busy=True;choose_button.config(state='disabled');start_button.config(state='disabled')
        def worker():
            try: events.put(('done',process_courses(chosen,lambda text:events.put(('status',text)))))
            except Exception as exc: events.put(('error',str(exc)))
        threading.Thread(target=worker,daemon=True).start()
    choose_button=ttk.Button(controls,text='选择读卡器/课程文件夹',command=select)
    choose_button.pack(side='left')
    start_button=ttk.Button(controls,text='导入并转写',command=start)
    start_button.pack(side='right')
    ttk.Label(frame,textvariable=status,wraplength=590).pack(anchor='w',pady=(14,0))
    def poll():
        nonlocal busy
        try:
            while True:
                kind,payload=events.get_nowait()
                if kind=='status': status.set(payload)
                else:
                    busy=False;choose_button.config(state='normal');start_button.config(state='normal')
                    if kind=='error':
                        status.set('未完成：'+payload)
                        messagebox.showerror('导入未完成',payload,parent=root)
                    else:
                        status.set(f'已完成 {len(payload)} 节，网页已打开。卡上原文件已保留。')
                        for item in payload: webbrowser.open(item['url'])
        except queue.Empty: pass
        root.after(100,poll)
    def close():
        if busy:
            messagebox.showinfo('正在处理','请等当前导入转写完成后再关闭。',parent=root)
        else: root.destroy()
    root.protocol('WM_DELETE_WINDOW',close)
    root.after(100,poll)
    root.mainloop()


def main():
    p=argparse.ArgumentParser(description='读卡器课程导入与本地转写')
    p.add_argument('--source',type=Path)
    p.add_argument('--all',action='store_true')
    p.add_argument('--no-open',action='store_true')
    p.add_argument('--skip-transcribe',action='store_true')
    a=p.parse_args()
    if a.source is None:
        gui();return
    paths=discover_card_courses(a.source)
    if not paths: p.error('没有找到已保存的课程文件夹')
    if len(paths)>1 and not a.all: p.error('请选择单节课文件夹，或指定 --all 导入全部课程')
    result=process_courses(paths,lambda text:print(text,flush=True),transcribe=not a.skip_transcribe)
    print(json.dumps({'ok':True,'courses':result},ensure_ascii=False,indent=2))
    if not a.no_open:
        for item in result: webbrowser.open(item['url'])


if __name__=='__main__': main()
