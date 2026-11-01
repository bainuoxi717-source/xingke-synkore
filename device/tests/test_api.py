import unittest

from fastapi.testclient import TestClient

from app.main import app


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_demo_feed_and_feedback(self):
        seeded = self.client.post("/api/demo/seed")
        self.assertEqual(seeded.status_code, 200)
        course_id = seeded.json()["course_id"]
        feed = self.client.get("/api/feed", params={"course_id": course_id})
        self.assertEqual(feed.status_code, 200)
        posts = feed.json()
        self.assertGreaterEqual(len(posts), 3)
        self.assertEqual(posts[0]["knowledge_point"], "函数极限的去心邻域定义")
        response = self.client.post("/api/feedback", json={"post_id": posts[0]["id"], "status": "confused"})
        self.assertEqual(response.status_code, 200)
        updated = self.client.get("/api/feed", params={"course_id": course_id}).json()
        self.assertEqual(updated[0]["feedback"], "confused")
        priority = updated[0]["priority"]
        self.client.post("/api/feedback", json={"post_id": posts[0]["id"], "status": "confused"})
        repeated = self.client.get("/api/feed", params={"course_id": course_id}).json()
        self.assertEqual(repeated[0]["priority"], priority)

    def test_generation_pipeline(self):
        course_id = self.client.post("/api/demo/seed").json()["course_id"]
        response = self.client.post(f"/api/courses/{course_id}/generate")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["post_count"], 4)
        self.assertEqual(response.json()["mode"], "template")
        feed = self.client.get("/api/feed", params={"course_id": course_id}).json()
        self.assertEqual(len(feed), 4)
        self.assertTrue(all(post["source_excerpt"] for post in feed))

    def test_home_page_and_health(self):
        self.assertTrue(self.client.get("/api/health").json()["ok"])
        home = self.client.get("/")
        self.assertEqual(home.status_code, 200)
        self.assertIn("知流", home.text)

    def test_invalid_feedback_is_rejected(self):
        response = self.client.post("/api/feedback", json={"post_id": "missing", "status": "unknown"})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
