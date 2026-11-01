"""SCF1 wired course-package protocol shared with the T5 firmware."""
from __future__ import annotations

import json
import struct
import zlib
from dataclasses import dataclass

MAGIC = b"SCF1"
FILE_BEGIN = 1
FILE_DATA = 2
FILE_END = 3
ACK = 4
ERROR = 5
PROGRESS = 6  # Hashing activity; receivers may ignore the payload.
MAX_PAYLOAD = 64 * 1024


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class Frame:
    kind: int
    payload: bytes


def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def encode_frame(kind: int, payload: bytes = b"") -> bytes:
    if not 0 <= kind <= 255:
        raise ProtocolError("Frame type must fit in one byte")
    if len(payload) > MAX_PAYLOAD:
        raise ProtocolError("Payload is too large")
    header = bytes([kind]) + struct.pack("<I", len(payload))
    return MAGIC + header + payload + struct.pack("<I", crc32(header + payload))


def json_payload(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def data_payload(sequence: int, data: bytes) -> bytes:
    return struct.pack("<I", sequence) + data


class FrameParser:
    """Incremental parser that resynchronizes after noise or partial reads."""

    def __init__(self, *, strict: bool = True) -> None:
        self._buffer = bytearray()
        self.strict = strict
        self.crc_errors = 0

    def feed(self, data: bytes) -> list[Frame]:
        self._buffer.extend(data)
        frames: list[Frame] = []
        while True:
            start = self._buffer.find(MAGIC)
            if start < 0:
                keep = min(len(self._buffer), len(MAGIC) - 1)
                if keep:
                    del self._buffer[:-keep]
                else:
                    self._buffer.clear()
                break
            if start:
                del self._buffer[:start]
            if len(self._buffer) < 13:
                break
            kind = self._buffer[4]
            length = struct.unpack("<I", self._buffer[5:9])[0]
            if length > MAX_PAYLOAD:
                del self._buffer[:4]
                continue
            total = 13 + length
            if len(self._buffer) < total:
                break
            payload = bytes(self._buffer[9:9 + length])
            expected = struct.unpack("<I", self._buffer[9 + length:total])[0]
            actual = crc32(bytes(self._buffer[4:9 + length]))
            del self._buffer[:total]
            if expected != actual:
                self.crc_errors += 1
                if self.strict:
                    raise ProtocolError("CRC32 mismatch")
                # No ACK is sent for this discarded frame. The board retries DATA.
                continue
            frames.append(Frame(kind, payload))
        return frames
