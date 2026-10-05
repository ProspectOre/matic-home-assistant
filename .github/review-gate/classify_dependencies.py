#!/usr/bin/env python3
"""Compatibility entrypoint: dependency changes require ordinary review.

Exit 3 retains the loader protocol during rolling upgrades. No package content,
network input, or bot identity can authorize a review exemption.
"""
import sys

if __name__ == "__main__":
    sys.exit(3)
