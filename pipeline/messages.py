"""Visitor-facing error texts (T56).

Every error a visitor can see is one plain sentence that says what happened and what to do, with no service names
for developers (TAP, SIA2), status codes or "retries". The technical text is kept apart as `detail`: the API returns it
as `error.detail`, the page shows it only in an "i" popover, and the server logs it.
The texts say only what is known: "not available right now" is not "no data", and no downtime is promised.
"""
import logging
from typing import Optional, Tuple

log = logging.getLogger("spherex.live")

CACHED_STILL_WORK = "The cached targets still work."

ARCHIVE_DOWN = ("The search failed because NASA's data archive (IRSA) is not available right now. "
                "Try again in a few minutes. " + CACHED_STILL_WORK)
ARCHIVE_BUSY = ("NASA's data archive (IRSA) is asking for fewer requests right now, so this position could not be searched. "
                "Try again in a few minutes. " + CACHED_STILL_WORK)
NO_IMAGES = "The archive lists no SPHEREx images covering this position. Try another position or one of the cached targets."
NONE_READABLE = ("The archive listed images for this position, but none of them could be downloaded right now. "
                 "Try again in a few minutes. " + CACHED_STILL_WORK)
SERVER_BUSY = "Many positions are being built right now. Try again in a few minutes. " + CACHED_STILL_WORK
SERVER_MEMORY = "The server is holding as much data as it can right now. Try again in a few minutes. " + CACHED_STILL_WORK
TOO_MANY_REQUESTS = "You are sending requests too fast. Wait a minute and try again."
UNEXPECTED = "Something went wrong while building this position. Try again, or pick another position. " + CACHED_STILL_WORK
PIXELS_RELEASED = "The data for this position was released to save memory. Load the position again."
NO_LIVE = "This server only shows its cached targets; other positions cannot be built here."
NO_LIVE_SPECTRUM = "Clicking a point needs live data, which this server does not build."
CATALOGUE_DOWN = "The WISE star catalogue could not be fetched from NASA's archive right now. The images are not affected."
CATALOGUE_UNREADABLE = "The WISE star catalogue answer could not be read. The images are not affected."
CATALOGUE_OFF = "The WISE star catalogue overlay is not available on this server."


def archive_failure(*causes: str) -> Tuple[str, str]:
    """(message, detail) when the archive search failed. `causes` are the technical texts of the services that failed.
    HTTP 429 from the archive is told apart (it asks for fewer requests); everything else is "not available"."""
    detail = "; ".join(c for c in causes if c)
    return (ARCHIVE_BUSY if any("HTTP 429" in c for c in causes) else ARCHIVE_DOWN), detail


def log_failure(where: str, message: str, detail: Optional[str]) -> None:
    """The server log keeps the technical text that the visitor does not see."""
    log.warning("%s: %s | detail: %s", where, message, detail or "-")
