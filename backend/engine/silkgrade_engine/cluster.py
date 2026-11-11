"""Print-colour clustering for printed specimens (k-means in Lab, k by silhouette)."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from . import config


@dataclass
class Clusters:
    k: int
    centers: np.ndarray            # k x 3 Lab, index 0 = ground (largest)
    masks: list[np.ndarray]        # boundary-eroded boolean masks, same order
    shares: list[float]            # area share of each cluster in the valid region
    silhouette: float


def print_colours(lab: np.ndarray, valid: np.ndarray, seed: int = 0) -> Clusters:
    px = lab[valid].astype(np.float64)
    if px.shape[0] < 200:
        return Clusters(1, np.median(px, axis=0, keepdims=True), [valid], [1.0], 0.0)
    rng = np.random.default_rng(seed)
    n = min(config.CLUSTER_SAMPLE, px.shape[0])
    sample = px[rng.choice(px.shape[0], n, replace=False)]

    best = None
    k_lo, k_hi = config.CLUSTER_K_RANGE
    for k in range(k_lo, k_hi + 1):
        km = KMeans(n_clusters=k, n_init=2, random_state=seed).fit(sample)
        shares = np.bincount(km.labels_, minlength=k) / n
        if shares.min() < config.CLUSTER_MIN_SHARE:
            continue
        sil = silhouette_score(sample, km.labels_, sample_size=min(2000, n), random_state=seed)
        if best is None or sil > best[0] + 1e-3:
            best = (sil, km)
    if best is None:
        return Clusters(1, np.median(px, axis=0, keepdims=True), [valid], [1.0], 0.0)

    sil, km = best
    centers = km.cluster_centers_
    # label every valid pixel by nearest centre
    flat = lab.reshape(-1, 3).astype(np.float32)
    d = np.stack([np.sum((flat - c.astype(np.float32)) ** 2, axis=1) for c in centers], axis=1)
    labels = np.argmin(d, axis=1).reshape(lab.shape[:2])
    labels[~valid] = -1

    counts = np.array([(labels == i).sum() for i in range(len(centers))])
    order = np.argsort(-counts)  # largest first = ground
    total = max(1, int(valid.sum()))
    kernel = np.ones((2 * config.CLUSTER_BOUNDARY_ERODE_PX + 1,) * 2, np.uint8)
    masks, shares = [], []
    for i in order:
        m = labels == i
        shares.append(float(m.sum()) / total)
        masks.append(cv2.erode(m.astype(np.uint8), kernel).astype(bool))
    return Clusters(len(centers), centers[order], masks, shares, float(sil))
