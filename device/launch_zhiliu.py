"""Start the local app on an available port, then open its actual address."""
from __future__ import annotations

import argparse
import os
import socket
import threading
import time
import urllib.request
import webbrowser


def main() -> None:
    parser = argparse.ArgumentParser(description="启动知流本地服务")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    from serial.tools import list_ports

    ports = list(list_ports.comports())
    if len(ports) == 1:
        os.environ.setdefault("ZHILIU_SERIAL_PORT", ports[0].device)
    port = args.port
    while port < args.port + 20:
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
                break
            except OSError:
                port += 1
    else:
        raise SystemExit("没有可用的本地端口，请通过 --port 指定其他端口。")
    url = f"http://127.0.0.1:{port}"
    print(f"知流地址：{url}", flush=True)
    if not args.no_browser:
        def open_when_ready():
            local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(100):
                try:
                    with local_http.open(f"{url}/api/health", timeout=1) as response:
                        if response.status == 200:
                            webbrowser.open(url)
                            return
                except OSError:
                    time.sleep(0.1)
        threading.Thread(target=open_when_ready, daemon=True).start()
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
