"""Catalogue overlay: query text, row parsing, and the failure path. FAKE transport, no network."""
import json
from pathlib import Path

from jsonschema import Draft202012Validator

from pipeline import catalogue
from pipeline.irsa import IrsaClient, Response

SCHEMA = Draft202012Validator(json.loads((Path(__file__).resolve().parents[2] / "contracts" / "catalogue.schema.json").read_text()))
CSV = ("designation,ra,dec,w1mpro,w1mjdmean\n"
       "J085510.83-071442.5,133.795,-7.2451,17.3,55300.5\n"
       "J085511.00-071500.0,133.80,-7.25,,\n")  # SIMULATED rows in the catalogue's column layout


def client(status=200, body=CSV, seen=None):
    def transport(method, url, data, timeout=300):
        if seen is not None:
            seen.append((url, data))
        return Response(status, {}, body.encode())
    return IrsaClient(transport=transport, sleep=lambda s: None)


def test_ok_document_matches_schema_and_query():
    seen = []
    doc = catalogue.catalogue_document(133.8, -7.25, 0.2, client(seen=seen))
    assert not list(SCHEMA.iter_errors(doc))
    assert doc["status"] == "ok" and len(doc["sources"]) == 2 and not doc["truncated"]
    assert doc["sources"][1]["w1_mag"] is None and doc["sources"][0]["mjd"] == 55300.5
    q = seen[0][1]["QUERY"]
    assert "allwise_p3as_psd" in q and "CIRCLE('ICRS', 133.800000, -7.250000, 0.150000)" in q


def test_truncated_when_more_than_max():
    rows = "designation,ra,dec,w1mpro,w1mjdmean\n" + "".join(f"s{i},1.0,2.0,10,55000\n" for i in range(catalogue.MAX_SOURCES + 1))
    doc = catalogue.catalogue_document(1, 2, 0.2, client(body=rows))
    assert doc["truncated"] and len(doc["sources"]) == catalogue.MAX_SOURCES


def test_service_down_is_an_error_document_not_an_exception():
    doc = catalogue.catalogue_document(1, 2, 0.2, client(status=502))
    assert doc["status"] == "error" and "could not be fetched" in doc["error"]["message"] and "HTTP 502" in doc["error"]["detail"] and "TAP" not in doc["error"]["message"] and doc["sources"] == []
    assert not list(SCHEMA.iter_errors(doc))


def test_unreadable_answer_is_an_error_document():
    def transport(method, url, data, timeout=300):
        raise ValueError("boom")
    doc = catalogue.catalogue_document(1, 2, 0.2, IrsaClient(transport=transport, sleep=lambda s: None))
    assert doc["status"] == "error"


def test_query_text_at_the_poles_and_across_ra_wrap():
    # CIRCLE on the sphere handles both; the text must keep the position as given (RA folded into 0..360) and the radius.
    assert "CIRCLE('ICRS', 359.990000, 0.000000, 0.150000)" in catalogue.query_text(359.99, 0.0, 0.2)
    assert "CIRCLE('ICRS', 0.010000, 0.000000, 0.150000)" in catalogue.query_text(0.01, 0.0, 0.2)
    assert "CIRCLE('ICRS', 10.000000, 90.000000, 0.750000)" in catalogue.query_text(10.0, 90.0, 1.0)
    assert "CIRCLE('ICRS', 10.000000, -90.000000, 0.075000)" in catalogue.query_text(10.0, -90.0, 0.1)


def test_one_attempt_and_own_gate():
    calls = []
    def transport(method, url, data, timeout=300):
        calls.append(timeout)
        return Response(502, {}, b"")
    doc = catalogue.catalogue_document(1, 2, 0.2, IrsaClient(transport=transport, sleep=lambda s: None))
    assert doc["status"] == "error" and calls == [catalogue.TIMEOUT_S]  # no retry
