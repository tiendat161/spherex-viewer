# Updating the data when SPHEREx releases new images

Two things go stale when the archive gets new images: the cached targets in `static/series/`, and the saved archive searches in `.cache/tap/`. Live positions (any position that is not a cached target) look after themselves: their saved search expires after 7 days (`TTL_S` in `pipeline/tapcache.py`), after which the archive is asked again.

## Refreshing the cached targets

```bash
.venv/bin/python -m pipeline.tapcount   # optional: image counts and release names per target, straight from the archive
make refresh                            # ask the archive again, download only images not yet in .cache/, rebuild static/series/
make verify                             # check the rebuilt series against the contract and the acceptance targets
```

`make refresh` contacts IRSA. A new release's files have new names (the release and pipeline version are in the path), so they are downloaded fresh; old downloads stay in `.cache/cutouts/` and are not reused for them. Review the `git diff --stat static/series/` before committing: frame counts, dates and stretch values will change.

## Which release wins

The same observation can be listed under more than one release path (for example `dr1` and `qr3`). `RELEASE_PREFERENCE` in `pipeline/select.py` says which one is used: earlier in the list wins, and a release not in the list ranks last. It currently reads `("dr1", "qr3")`. When a newer release should win, put it first. I did not check how IRSA names future releases or whether a newer release supersedes `dr1`; check the archive's release notes before changing the list.

## Not automated

Nothing checks the archive on a schedule, and `make refresh` is run by hand. `make refresh` also rebuilds every target, not only those whose image list changed.
