import unittest

from app.asr import marked_context
from app.parsers import chunk_pages
from app.pipeline import _terms


class PipelineTests(unittest.TestCase):
    def test_marked_context_includes_surrounding_segments(self):
        segments = [
            {"start_ms": 0, "end_ms": 10000, "text": "前文"},
            {"start_ms": 40000, "end_ms": 50000, "text": "这里没听懂"},
            {"start_ms": 200000, "end_ms": 201000, "text": "后文"},
        ]
        self.assertEqual(marked_context(segments, 45000), "前文这里没听懂")

    def test_document_chunks_keep_page_numbers(self):
        chunks = chunk_pages([{"page": 7, "text": "第一段。" * 200}], target_chars=100, overlap=10)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(c["page"] == 7 for c in chunks))

    def test_chinese_terms_include_bigrams(self):
        self.assertIn("极限", _terms("函数极限"))


if __name__ == "__main__":
    unittest.main()
