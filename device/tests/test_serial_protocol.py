import unittest

from app.serial_protocol import (
    FILE_BEGIN, FILE_DATA, FrameParser, ProtocolError,
    data_payload, encode_frame, json_payload,
)


class SerialProtocolTests(unittest.TestCase):
    def test_round_trip_across_fragmented_reads(self):
        wire = encode_frame(FILE_BEGIN, json_payload({"path": "audio.wav"}))
        wire += encode_frame(FILE_DATA, data_payload(7, b"pcm-data"))
        parser = FrameParser()
        frames = []
        for byte in wire:
            frames.extend(parser.feed(bytes([byte])))
        self.assertEqual(frames[0].kind, FILE_BEGIN)
        self.assertEqual(frames[1].payload[4:], b"pcm-data")

    def test_parser_recovers_from_line_noise(self):
        parser = FrameParser()
        self.assertEqual(parser.feed(b"DEBUG: boot\r\n"), [])
        frames = parser.feed(encode_frame(FILE_DATA, data_payload(0, b"abc")))
        self.assertEqual(len(frames), 1)

    def test_crc_failure_is_rejected(self):
        frame = bytearray(encode_frame(FILE_DATA, b"abc"))
        frame[10] ^= 1
        with self.assertRaises(ProtocolError):
            FrameParser().feed(bytes(frame))


if __name__ == "__main__":
    unittest.main()
