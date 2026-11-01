import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.serial_import import receive_course
from app.serial_protocol import FILE_BEGIN, FILE_DATA, FILE_END, ProtocolError, encode_frame, json_payload


class FakeBoardSerial:
    def __init__(self, *args, **kwargs):
        self.rx = bytearray()
        self.acks = []
        self.buffer = bytearray()
        self.duplicate = False
        self.corrupt_duplicate = False
        self.progress = False
        self.corrupt_once = False

    def __enter__(self):
        self.open_config = (getattr(self, 'dtr', None), getattr(self, 'rts', None), getattr(self, 'port', None))
        return self
    def __exit__(self, *args): return None
    def reset_input_buffer(self): pass
    def flush(self): pass
    @property
    def in_waiting(self): return len(self.rx)

    def write(self, data):
        if data == b"PING\n":
            self.rx += b"PONG\n"
        elif data.startswith(b"EXPORT "):
            files = [("marks.json", b'{"marks":[{"time_ms":1200,"type":"confused"}]}'),
                     ("meta.json", b'{"title":"test"}'), ("audio.wav", b"RIFFtest-audio")]
            for name, content in files:
                if self.progress:
                    self.buffer += encode_frame(6, json_payload({"path":name,"hashed":0,"size":len(content)}))
                digest = hashlib.sha256(content).hexdigest()
                meta = {"course_id": "course_001", "path": name, "size": len(content), "sha256": digest}
                self.buffer += encode_frame(FILE_BEGIN, json_payload(meta))
                good_data_frame = encode_frame(FILE_DATA, struct.pack("<I", 0) + content)
                if self.corrupt_once and name == 'audio.wav':
                    bad_data_frame = bytearray(good_data_frame)
                    bad_data_frame[-1] ^= 0x80
                    self.buffer += bad_data_frame
                self.buffer += good_data_frame
                if self.duplicate:
                    repeated = content + b"!" if self.corrupt_duplicate else content
                    self.buffer += encode_frame(FILE_DATA, struct.pack("<I", 0) + repeated)
                self.buffer += encode_frame(FILE_END, json_payload({"course_id": "course_001", "path": name, "sha256": digest}))
        else:
            self.acks.append(bytes(data))
        return len(data)

    def read(self, size):
        if not self.rx and self.buffer:
            self.rx, self.buffer = self.buffer, bytearray()
        count = min(size, 7, len(self.rx))
        result = bytes(self.rx[:count])
        del self.rx[:count]
        return result


class SerialReceiverTests(unittest.TestCase):
    def test_reset_lines_are_configured_before_port_open(self):
        board = FakeBoardSerial()
        with tempfile.TemporaryDirectory() as temp, patch("app.serial_import.serial.Serial", return_value=board) as factory:
            receive_course("course_001", port="COM3", destination=Path(temp))
            self.assertIsNone(factory.call_args.kwargs["port"])
            self.assertIs(board.dtr, False)
            self.assertIs(board.rts, False)
            self.assertEqual(board.port, "COM3")
            self.assertEqual(board.open_config, (False, False, "COM3"))

    def test_hashing_progress_frames_do_not_change_file_integrity(self):
        board = FakeBoardSerial()
        board.progress = True
        with tempfile.TemporaryDirectory() as temp, patch("app.serial_import.serial.Serial", return_value=board):
            result = receive_course("course_001", destination=Path(temp))
            self.assertEqual(len(result["files"]), 3)
            self.assertEqual((Path(result["directory"]) / "audio.wav").read_bytes(), b"RIFFtest-audio")

    def test_corrupt_data_frame_is_not_acked_and_retransmission_is_verified(self):
        board = FakeBoardSerial()
        board.corrupt_once = True
        with tempfile.TemporaryDirectory() as temp, patch("app.serial_import.serial.Serial", return_value=board):
            result = receive_course("course_001", destination=Path(temp))
            self.assertEqual(result['crc_retries'], 1)
            self.assertEqual(len(board.acks), 3)
            self.assertEqual((Path(result["directory"]) / "audio.wav").read_bytes(), b"RIFFtest-audio")

    def test_complete_course_package_is_verified(self):
        board = FakeBoardSerial()
        with tempfile.TemporaryDirectory() as temp, patch("app.serial_import.serial.Serial", return_value=board):
            result = receive_course("course_001", destination=Path(temp))
            directory = Path(result["directory"])
            self.assertEqual((directory / "audio.wav").read_bytes(), b"RIFFtest-audio")
            self.assertEqual(json.loads((directory / "marks.json").read_text())["marks"][0]["time_ms"], 1200)
            self.assertEqual(len(result["files"]), 3)
            self.assertEqual(len(board.acks), 3)

    def test_lost_ack_retransmission_does_not_duplicate_file_data(self):
        board = FakeBoardSerial()
        board.duplicate = True
        with tempfile.TemporaryDirectory() as temp, patch("app.serial_import.serial.Serial", return_value=board):
            result = receive_course("course_001", destination=Path(temp))
            self.assertEqual((Path(result["directory"]) / "audio.wav").read_bytes(), b"RIFFtest-audio")
            self.assertEqual(len(result["files"]), 3)
            self.assertEqual(len(board.acks), 6)

    def test_conflicting_retransmission_is_rejected_and_file_is_closed(self):
        board = FakeBoardSerial()
        board.duplicate = board.corrupt_duplicate = True
        with tempfile.TemporaryDirectory() as temp, patch("app.serial_import.serial.Serial", return_value=board):
            with self.assertRaises(ProtocolError):
                receive_course("course_001", destination=Path(temp))
            # Windows refuses deletion if the exceptional path leaked the handle.
            (Path(temp) / "course_001" / "marks.json.part").unlink()


if __name__ == "__main__":
    unittest.main()
