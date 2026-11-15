"""Synthetic cutouts have no WCS-WAVE table, so the per-pixel wavelength plane is replaced for every test."""
from unittest import mock

import numpy as np
import pytest

SIM_WAVE_BASE = 2.5      # SIMULATED wavelength (um) at x = 0
SIM_WAVE_PER_PIX = 0.001  # SIMULATED change per pixel along x


def simulated_wavelength_map(hdul, hdr, shape):
    ny, nx = shape
    return (SIM_WAVE_BASE + SIM_WAVE_PER_PIX * np.arange(nx, dtype="float32"))[None, :].repeat(ny, axis=0)


@pytest.fixture(autouse=True)
def simulated_wave_map():
    with mock.patch("pipeline.cutout.wavelength_map", simulated_wavelength_map):
        yield
