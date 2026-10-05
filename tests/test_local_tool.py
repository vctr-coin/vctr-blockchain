import unittest

from fastapi.testclient import TestClient

from local_tool.app import app


class LocalToolTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        # Synthetic arithmetic fixture, not proposed tokenomics.
        self.rows = [
            {"name": f"Test {index}", "amount_tokens": str(amount)}
            for index, amount in enumerate([1, 1, 1, 1, 1, 9_999_999_995])
        ]

    def validate(self, rows):
        return self.client.post("/allocations/validate", json={"allocations": rows})

    def test_missing_terms_are_not_ready(self):
        result = self.client.get("/spec")
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()["validation"]["arithmetic_valid"])
        self.assertFalse(result.json()["validation"]["deployment_ready"])

    def test_exact_total_does_not_imply_deployment_approval(self):
        result = self.validate(self.rows).json()
        self.assertTrue(result["arithmetic_valid"])
        self.assertEqual(result["allocated_tokens"], "10000000000")
        self.assertFalse(result["deployment_ready"])

    def test_under_and_over_allocation(self):
        for amount in ["9999999994", "9999999996"]:
            with self.subTest(amount=amount):
                self.rows[-1]["amount_tokens"] = amount
                self.assertFalse(self.validate(self.rows).json()["arithmetic_valid"])

    def test_duplicate_names(self):
        self.rows[1]["name"] = " test 0 "
        self.assertFalse(self.validate(self.rows).json()["arithmetic_valid"])

    def test_missing_allocation(self):
        self.assertFalse(self.validate(self.rows[:-1]).json()["arithmetic_valid"])

    def test_invalid_amounts(self):
        for amount in ["-1", "0", "1.5", "1e9", " 1", "NaN"]:
            with self.subTest(amount=amount):
                self.rows[0]["amount_tokens"] = amount
                self.assertFalse(self.validate(self.rows).json()["arithmetic_valid"])

    def test_numeric_json_rejected(self):
        for amount in [1, 1.5, True, None]:
            with self.subTest(amount=amount):
                self.rows[0]["amount_tokens"] = amount
                self.assertEqual(self.validate(self.rows).status_code, 422)

    def test_unknown_fields_and_oversized_values_rejected(self):
        self.rows[0]["private_key"] = "not-a-key"
        self.assertEqual(self.validate(self.rows).status_code, 422)
        del self.rows[0]["private_key"]
        self.rows[0]["amount_tokens"] = "9" * 100
        self.assertEqual(self.validate(self.rows).status_code, 422)

    def test_validation_does_not_save_draft(self):
        before = self.client.get("/spec").json()
        self.validate(self.rows)
        self.assertEqual(self.client.get("/spec").json(), before)

    def test_untrusted_host_rejected(self):
        self.assertEqual(self.client.get("/health", headers={"host": "example.com"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
