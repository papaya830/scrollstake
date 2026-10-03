import numpy as np
from tune import recommend

def test_recommend_separable_signal():
    rng = np.random.default_rng(0)
    nh = list(rng.normal(0, 0.01, 800)); ne = list(rng.normal(0, 0.02, 800))
    ph = list(rng.normal(0.12, 0.02, 300)); pe = list(rng.normal(0.25, 0.03, 300))
    r = recommend(nh, ne, ph, pe)
    assert r["HEAD_SIGN"] == 1
    assert r["normal_head_fp_rate"] < 0.01 and r["normal_eye_fp_rate"] < 0.01
    assert r["phone_head_hit_rate"] > 0.9 and r["phone_eye_hit_rate"] > 0.9
    assert r["both_usable"] and not r["notes"]

def test_recommend_flags_inseparable_eye_signal():
    rng = np.random.default_rng(1)
    nh = list(rng.normal(0, 0.01, 800)); ne = list(rng.normal(0, 0.05, 800))
    ph = list(rng.normal(-0.1, 0.02, 300)); pe = list(rng.normal(0.02, 0.05, 300))
    r = recommend(nh, ne, ph, pe)
    assert r["HEAD_SIGN"] == -1
    assert not r["both_usable"] and r["notes"]

if __name__ == "__main__":
    test_recommend_separable_signal(); test_recommend_flags_inseparable_eye_signal(); print("tune ok")
