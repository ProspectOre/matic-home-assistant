"""Trace grid boundaries shared by room and semantic map projections."""

from __future__ import annotations

import numpy as np


def mask_contours(mask: np.ndarray) -> tuple[tuple[tuple[int, int], ...], ...]:
    """Trace closed pixel-edge contours with occupied cells on the right."""
    height, width = mask.shape
    edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for y, x in np.argwhere(mask):
        x = int(x)
        y = int(y)
        if y == 0 or not mask[y - 1, x]:
            edges.add(((x, y), (x + 1, y)))
        if x == width - 1 or not mask[y, x + 1]:
            edges.add(((x + 1, y), (x + 1, y + 1)))
        if y == height - 1 or not mask[y + 1, x]:
            edges.add(((x + 1, y + 1), (x, y + 1)))
        if x == 0 or not mask[y, x - 1]:
            edges.add(((x, y + 1), (x, y)))

    outgoing: dict[tuple[int, int], set[tuple[int, int]]] = {}
    for start, end in edges:
        outgoing.setdefault(start, set()).add(end)
    directions = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    contours: list[tuple[tuple[int, int], ...]] = []
    while edges:
        first = min(edges)
        edges.remove(first)
        points = [first[0], first[1]]
        while points[-1] != points[0]:
            current = points[-1]
            candidates = [
                (current, end)
                for end in outgoing.get(current, ())
                if (current, end) in edges
            ]
            incoming = directions[
                (
                    current[0] - points[-2][0],
                    current[1] - points[-2][1],
                )
            ]
            candidate = min(
                candidates,
                key=lambda edge: (
                    (
                        directions[
                            (
                                edge[1][0] - edge[0][0],
                                edge[1][1] - edge[0][1],
                            )
                        ]
                        - incoming
                    )
                    % 4
                ),
            )
            edges.remove(candidate)
            points.append(candidate[1])
        contour = points[:-1]
        simplified = tuple(
            point
            for index, point in enumerate(contour)
            if (
                contour[index - 1][0] - point[0],
                contour[index - 1][1] - point[1],
            )
            != (
                point[0] - contour[(index + 1) % len(contour)][0],
                point[1] - contour[(index + 1) % len(contour)][1],
            )
        )
        contours.append(simplified)
    return tuple(contours)
