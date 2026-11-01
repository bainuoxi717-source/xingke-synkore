from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import struct
import time
from contextlib import ExitStack
from pathlib import Path

import serial

from .config import COURSES_DIR, IMPORTS_DIR, SERIAL_BAUD, SERIAL_PORT
from .serial_protocol import (
    ACK, ERROR, FILE_BEGIN, FILE_DATA, FILE_END,
    FrameParser, ProtocolError, encode_frame,
)

SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
ALLOWED_FILES = {"audio.wav", "audio.pcm", "marks.json", "meta.json", "transcript.json"}


def _safe_course_id(value: str) -> str:
    if not SAFE_NAME.fullmatch(value) or value in {".", ".."}:
        raise ProtocolError("Invalid course id")
    return value


def _decode_json(payload: bytes) -> dict:
    value = json.loads(payload.decode("utf-8"))
    if not isinstance(value, dict):
        raise ProtocolError("JSON frame must contain an object")
    return value


def receive_course(course_id: str, port: str = SERIAL_PORT, baud: int = SERIAL_BAUD,
                   destination: Path = IMPORTS_DIR, timeout_s: int = 300) -> dict:
    course_id = _safe_course_id(course_id)
    target_dir = destination / course_id
    target_dir.mkdir(parents=True, exist_ok=True)
    parser = FrameParser(strict=False)
    active = None
    completed = []
    started = time.monotonic()
    # Configure modem lines before opening: CH340 RTS is wired to board reset.
    handle = serial.Serial(port=None, baudrate=baud, timeout=0.25, write_timeout=3)
    handle.dtr = False
    handle.rts = False
    handle.port = port
    with ExitStack() as files, handle as port_handle:
        port_handle.reset_input_buffer()
        # USB/UART drivers can pulse RTS while opening despite its requested state.
        # Wait for the sketch instead of losing EXPORT during a possible reboot.
        ready_deadline = time.monotonic() + 15
        next_ping = 0.0
        ready_bytes = bytearray()
        while time.monotonic() < ready_deadline:
            if time.monotonic() >= next_ping:
                port_handle.write(b"PING\n")
                next_ping = time.monotonic() + 1
            ready_bytes.extend(port_handle.read(port_handle.in_waiting or 1))
            if b"PONG\n" in ready_bytes or b"PONG\r\n" in ready_bytes:
                break
            if len(ready_bytes) > 4096:
                del ready_bytes[:-256]
        else:
            raise TimeoutError("开发板未回应 PING，请确认连接及固件启动状态")
        started = time.monotonic()
        port_handle.write(f"EXPORT {course_id}\n".encode("ascii"))
        port_handle.flush()
        while time.monotonic() - started < timeout_s:
            incoming = port_handle.read(port_handle.in_waiting or 1)
            if not incoming:
                continue
            started = time.monotonic()  # Activity timeout, not a total file-size limit.
            for frame in parser.feed(incoming):
                if frame.kind == ERROR:
                    raise ProtocolError(frame.payload.decode("utf-8", errors="replace"))
                if frame.kind == FILE_BEGIN:
                    if active is not None:
                        raise ProtocolError("A file transfer is already active")
                    meta = _decode_json(frame.payload)
                    if _safe_course_id(meta.get("course_id", "")) != course_id:
                        raise ProtocolError("Course id mismatch")
                    name = meta.get("path", "")
                    if name not in ALLOWED_FILES:
                        raise ProtocolError(f"Unsupported file: {name}")
                    size = int(meta["size"])
                    if size < 0 or size > 2 * 1024**3:
                        raise ProtocolError("Invalid file size")
                    part_path = target_dir / f"{name}.part"
                    active = {
                        "name": name, "size": size, "expected_sha": meta["sha256"].lower(),
                        "sequence": 0, "received": 0, "hash": hashlib.sha256(),
                        "handle": files.enter_context(part_path.open("wb")), "part_path": part_path,
                        "last_data": None,
                    }
                elif frame.kind == FILE_DATA:
                    if active is None or len(frame.payload) < 4:
                        raise ProtocolError("Unexpected FILE_DATA")
                    sequence = struct.unpack("<I", frame.payload[:4])[0]
                    data = frame.payload[4:]
                    if sequence == active["sequence"] - 1 and data == active["last_data"]:
                        # The board retries the last block when its ACK was lost.
                        port_handle.write(encode_frame(ACK, struct.pack("<I", sequence)))
                        continue
                    if sequence != active["sequence"]:
                        raise ProtocolError(f"Unexpected chunk sequence: {sequence}")
                    active["handle"].write(data)
                    active["hash"].update(data)
                    active["received"] += len(data)
                    if active["received"] > active["size"]:
                        raise ProtocolError("Received more data than declared")
                    port_handle.write(encode_frame(ACK, struct.pack("<I", sequence)))
                    active["sequence"] += 1
                    active["last_data"] = data
                elif frame.kind == FILE_END:
                    if active is None:
                        raise ProtocolError("Unexpected FILE_END")
                    ending = _decode_json(frame.payload)
                    active["handle"].close()
                    actual_sha = active["hash"].hexdigest()
                    if active["received"] != active["size"] or actual_sha != active["expected_sha"]:
                        active["part_path"].unlink(missing_ok=True)
                        raise ProtocolError("File size or SHA-256 mismatch")
                    if ending.get("sha256", "").lower() != actual_sha:
                        raise ProtocolError("FILE_END digest mismatch")
                    final_path = target_dir / active["name"]
                    os.replace(active["part_path"], final_path)
                    completed.append({"path": active["name"], "size": active["received"], "sha256": actual_sha})
                    active = None
                    if {item["path"] for item in completed} >= {"audio.wav", "marks.json"} or \
                       {item["path"] for item in completed} >= {"audio.pcm", "marks.json"}:
                        return {"ok": True, "course_id": course_id, "directory": str(target_dir), "files": completed,
                                "crc_retries": parser.crc_errors}
            if active is None and completed and port_handle.in_waiting == 0:
                time.sleep(0.05)
    if active is not None:
        active["handle"].close()
    raise TimeoutError("串口接收超时；请确认开发板已进入导出模式且波特率一致")


def main() -> None:
    parser = argparse.ArgumentParser(description="通过 SCF1 串口协议导入 T5 课程包")
    parser.add_argument("course_id")
    parser.add_argument("--port", default=SERIAL_PORT)
    parser.add_argument("--baud", type=int, default=SERIAL_BAUD)
    args = parser.parse_args()
    print(json.dumps(receive_course(args.course_id, args.port, args.baud), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
