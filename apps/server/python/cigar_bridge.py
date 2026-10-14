"""One isolated scenario, executed by the published hol-cigar native worker.

stdin/stdout is a bounded JSON protocol with the trusted Node host. No files,
credentials, remote service or model provider are discovered. The host supplies
already-authorized records. Each run owns its graph, view and reviews and closes
the native worker before returning. Business authority remains in the demo host.
"""

from __future__ import annotations

import json
import sys
from importlib.metadata import version

from cigar_sdk import LocalContextError, LocalContextGraph

EXPECTED_VERSION = "0.14.0"
INVOICE = "erp://invoices/INV-2026-0918"
POLICY = "policy://treasury/payment-authority"
DEPENDENCIES = [
    POLICY,
    "erp://goods-receipt/GR-55021",
    "erp://vendors/meridian-components",
    "erp://payments/ledger",
]


def compile_run(payload: dict) -> dict:
    installed = version("hol-cigar")
    if installed != EXPECTED_VERSION:
        raise ValueError(f"Expected hol-cigar {EXPECTED_VERSION}; installed {installed}")
    records = payload["records"]
    contract = payload["contract"]
    allowed = [record["source_id"] for record in records]
    if INVOICE not in allowed:
        raise ValueError("The current invoice is not authorized")

    with LocalContextGraph(payload.get("domain", "northwind-settlement-fixture"), timeout=10.0) as graph:
        for record in records:
            graph.replace_source(record["source_id"], [{
                "id": record["source_id"],
                "source": record["source_id"],
                "text": json.dumps(record["content"], sort_keys=True, separators=(",", ":"), ensure_ascii=False),
            }])
        # A missing or unauthorized dependency must block compilation, even
        # when the requested root invoice itself would fit in the budget.
        for dependency in DEPENDENCIES:
            graph.link(INVOICE, dependency, "requires")
        view = graph.create_view({
            "id": "treasury-settlement",
            "allowed_sources": allowed,
            "writable_sources": [],
            "policy_revision": "northwind-treasury/4.2",
        })
        request = {
            "query": contract["task"],
            "required": [INVOICE],
            "allowed": allowed,
            "max_tokens": contract["budget"]["max_tokens"],
            "reserve_tokens": contract["budget"].get("reserve_tokens", 512),
            "max_blocks": contract["budget"]["max_records"],
            "policy_revision": "northwind-treasury/4.2",
        }
        compiled = view.compile(request)
        context = compiled["context"]
        snapshot = context["snapshot"]
        verified = graph.verify(snapshot)
        if verified["snapshot"] != snapshot or verified["rendered"] != compiled["rendered"]:
            raise ValueError("CIGAR snapshot verification failed")
        selection = view.explain(context)
        selected = {}
        for block in snapshot["blocks"]:
            for citation in block["citations"]:
                selected[citation["node_id"]] = json.loads(block["text"])
        invoice = selected[INVOICE]
        claim = f"Invoice {invoice['invoice']} totals {invoice['amount']} {invoice['currency']}."
        draft = {"snapshot_id": snapshot["id"], "claims": [{"text": claim, "citations": [INVOICE]}]}

        # A separately authored fixture reviewer, NOT an LLM or a general
        # semantic judge. Mutating the compiled invoice does not change these
        # expected facts. Only the assessed statement is released.
        expected_amount = "68400.00" if payload["scenario"] == "policy-block" else "48200.00"
        expected = f"Invoice INV-2026-0918 totals {expected_amount} EUR."
        reviews = [{
            "claim_key": key,
            "verdict": "supported" if claim == expected else "contradicted",
        } for key in view.review_keys(draft)]
        missing_review = view.check_answer(context, draft, [])
        assessment = view.check_answer(context, draft, reviews)
        if assessment["assessment"]["decision"] != "release":
            raise ValueError("CIGAR withheld the invoice statement: fixture review did not support it")
        if missing_review["assessment"]["decision"] != "abstain":
            raise ValueError("CIGAR accepted an unreviewed claim")
        # Recheck immediately before returning to the synchronous host effect
        # gate. This assessment itself never grants payment authority.
        assessment = view.check_answer(context, draft, reviews)
        return {
            "schema": "cigar-aac-native-execution/v1",
            "package": "hol-cigar",
            "version": installed,
            "capabilities": graph.capabilities(),
            "compiled": compiled,
            "selection": selection,
            "draft": draft,
            "reviews": reviews,
            "assessment": assessment,
            "missing_review": missing_review,
            "selected": selected,
            "snapshot_verified": True,
            "reviewer": "scripted-fixture",
        }


def main() -> None:
    try:
        raw = sys.stdin.buffer.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("Scenario input exceeds 1 MiB")
        result = compile_run(json.loads(raw))
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, separators=(",", ":")))
    except (LocalContextError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "code": getattr(error, "code", "InvalidScenario"), "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
