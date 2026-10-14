"""Native SDK regression checks; no server, credentials or network involved."""
import unittest

from cigar_sdk import LocalContextGraph, LocalContextError


class NativeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.graph = LocalContextGraph("demo-native-regression")
        self.graph.replace_source("invoice", [{"id": "invoice", "source": "invoice", "text": "Invoice amount: 48200 EUR."}])
        self.graph.replace_source("policy", [{"id": "policy", "source": "policy", "text": "Payment ceiling: 50000 EUR."}])
        self.graph.replace_source("private", [{"id": "private", "source": "private", "text": "Private payroll."}])
        self.graph.link("invoice", "policy", "requires")
        self.view = self.graph.create_view({"id": "agent", "allowed_sources": ["invoice", "policy"], "policy_revision": "v1"})
        self.request = {"required": ["invoice"], "max_tokens": 512}

    def tearDown(self):
        self.graph.close()
        self.assertTrue(self.graph.cleanup_complete)

    def draft_and_review(self, context):
        draft = {"snapshot_id": context["snapshot"]["id"], "claims": [{"text": "Invoice amount: 48200 EUR.", "citations": ["invoice"]}]}
        reviews = [{"claim_key": key, "verdict": "supported"} for key in self.view.review_keys(draft)]
        return draft, reviews

    def test_view_request_cannot_widen_host_permissions(self):
        with self.assertRaises(LocalContextError):
            self.view.compile({"required": ["private"], "allowed": ["invoice", "policy", "private"], "max_tokens": 512})

    def test_empty_allowed_never_means_everything(self):
        with self.assertRaises(LocalContextError):
            self.view.compile(self.request | {"allowed": []})

    def test_required_closure_cannot_omit_policy(self):
        with self.assertRaises(LocalContextError):
            self.view.compile(self.request | {"allowed": ["invoice"]})

    def test_missing_review_abstains(self):
        context = self.view.compile(self.request)["context"]
        draft, reviews = self.draft_and_review(context)
        self.assertEqual(self.view.check_answer(context, draft, reviews)["assessment"]["decision"], "release")
        self.assertEqual(self.view.check_answer(context, draft, [])["assessment"]["decision"], "abstain")

    def test_changed_readable_source_invalidates_previous_review(self):
        context = self.view.compile(self.request)["context"]
        draft, reviews = self.draft_and_review(context)
        self.graph.replace_source("policy", [{"id": "policy", "source": "policy", "text": "Payment ceiling: 1000 EUR."}])
        with self.assertRaises(LocalContextError):
            self.view.check_answer(context, draft, reviews)

    def test_outside_scope_update_does_not_invalidate_review(self):
        context = self.view.compile(self.request)["context"]
        draft, reviews = self.draft_and_review(context)
        self.graph.replace_source("private", [{"id": "private", "source": "private", "text": "Changed private payroll."}])
        self.assertEqual(self.view.check_answer(context, draft, reviews)["assessment"]["decision"], "release")

    def test_revoked_view_cannot_compile(self):
        self.graph.revoke_view("agent")
        with self.assertRaises(LocalContextError):
            self.view.compile(self.request)


if __name__ == "__main__":
    unittest.main()
