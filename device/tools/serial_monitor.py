from __future__ import annotations

import argparse
import time

import serial


def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor T5 recorder button and state messages")
    parser.add_argument("--port", default="COM5")
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--seconds", type=int, default=45)
    args = parser.parse_args()
    deadline = time.monotonic() + args.seconds
    received = bytearray()
    with serial.Serial(args.port, args.baud, timeout=0.2) as handle:
        handle.reset_input_buffer()
        print(f"LISTENING {args.port}; press a user button now", flush=True)
        while time.monotonic() < deadline:
            chunk = handle.read(handle.in_waiting or 1)
            if chunk:
                received.extend(chunk)
                print(chunk.decode("utf-8", errors="replace"), end="", flush=True)
    (received and print(f"\nRAW {bytes(received)!r}"))


if __name__ == "__main__":
    main()
