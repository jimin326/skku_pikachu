from __future__ import annotations

import copy

from schema import assert_disjoint, validate_default_manifests


def main() -> None:
    manifests = validate_default_manifests()
    bad_seed = copy.deepcopy(manifests["validation"])
    bad_seed["seeds"][0] = manifests["train"]["seeds"][0]
    try:
        assert_disjoint(manifests["train"], bad_seed, manifests["registry"])
        raise AssertionError("seed overlap was accepted")
    except ValueError as error:
        assert "seed overlap" in str(error)

    bad_family = copy.deepcopy(manifests["validation"])
    bad_family["opponents"] = ["lion_v4"]
    bad_family["benchmarkOpponents"] = []
    try:
        assert_disjoint(manifests["train"], bad_family, manifests["registry"])
        raise AssertionError("family overlap was accepted")
    except ValueError as error:
        assert "family overlap" in str(error)
    print("opponent/split schema tests PASS")


if __name__ == "__main__":
    main()
