"""The visitor-facing error texts (T56): plain, no developer words, honest about the cause."""
import re

import pytest

from pipeline import messages

JARGON = re.compile(r"TAP|SIA2?|HTTP|\b[45]\d\d\b|retries|Traceback|Error\b|SPHEREX_LIVE", re.I)
ALL = {k: v for k, v in vars(messages).items() if k.isupper() and isinstance(v, str)}


@pytest.mark.parametrize("name", sorted(ALL))
def test_texts_are_short_plain_sentences(name):
    text = ALL[name]
    assert not JARGON.search(text), text
    assert len(text) < 200 and text.endswith(".")


def test_archive_down_keeps_technical_text_in_detail_only():
    msg, detail = messages.archive_failure("TAP: TAP query failed after retries: HTTP 502", "SIA2 fallback: SIA2 query spherex_dr1 failed after retries: HTTP 502")
    assert msg == messages.ARCHIVE_DOWN and "NASA" in msg and "cached targets still work" in msg
    assert "HTTP 502" in detail and "TAP" in detail and "SIA2" in detail


@pytest.mark.parametrize("cause", ["HTTP 503", "HTTP 504", "ReadTimeout: timed out"])
def test_service_trouble_is_not_available(cause):
    assert messages.archive_failure(f"TAP: {cause}", f"SIA2: {cause}")[0] == messages.ARCHIVE_DOWN


def test_archive_rate_limit_is_told_apart():
    assert messages.archive_failure("TAP: HTTP 429", "SIA2: HTTP 502")[0] == messages.ARCHIVE_BUSY


def test_no_images_is_never_used_for_a_service_failure():
    assert "not available" not in messages.NO_IMAGES and "lists no" in messages.NO_IMAGES
    assert "lists no" not in messages.ARCHIVE_DOWN


def test_failures_are_logged_with_the_detail(caplog):
    with caplog.at_level("WARNING", logger="spherex.live"):
        messages.log_failure("x", "short", "HTTP 502")
    assert "HTTP 502" in caplog.text
