"""The RL evaluator: same inputs give the same score, packages run apart from the scoring, and bad rewards fail."""
import inspect
import io
import zipfile

import pytest

from tod_workloads import rl, rl_cartpole

ENV = inspect.getsource(rl_cartpole).encode()


def _packages(tmp_path, policy: str):
    env = rl.unpack(ENV, tmp_path / "env", "rl_cartpole.py")
    pol = rl.unpack(policy.encode(), tmp_path / "policy", "policy.py")
    return env, pol


def _run(env, pol, seeds, episodes, steps, entry="rl_cartpole:CartPole", **kw):
    return rl.run(rl.serve_command("env", env, entry), rl.serve_command("policy", pol), seeds, episodes, steps, **kw)


def test_same_seeds_give_the_same_score(tmp_path):
    env, pol = _packages(tmp_path, rl_cartpole.POLICY)
    a = _run(env, pol, [1, 2, 3], 2, 500)
    b = _run(env, pol, [1, 2, 3], 2, 500)
    assert a == b
    assert len(a.returns) == 3 and all(len(per) == 2 for per in a.returns)
    assert a.score == round(a.mean * 1000)
    assert a.mean > 100  # the balancing policy keeps the pole up far longer than chance


def test_a_better_policy_scores_higher(tmp_path):
    env, good = _packages(tmp_path, rl_cartpole.POLICY)
    bad = rl.unpack(b"def act(obs):\n    return 0\n", tmp_path / "bad", "policy.py")
    hi = _run(env, good, [5], 3, 500)
    lo = _run(env, bad, [5], 3, 500)
    assert hi.score > lo.score > 0


def test_step_limit_caps_an_episode(tmp_path):
    env, pol = _packages(tmp_path, rl_cartpole.POLICY)
    r = _run(env, pol, [9], 1, 20)
    assert r.returns == [[20.0]]


def test_zip_packages_unpack_and_cannot_escape(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("policy.py", rl_cartpole.POLICY)
    assert (rl.unpack(buf.getvalue(), tmp_path / "ok", "policy.py") / "policy.py").exists()
    evil = io.BytesIO()
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("../outside.py", "x = 1")
    with pytest.raises(ValueError, match="escapes"):
        rl.unpack(evil.getvalue(), tmp_path / "evil", "policy.py")


def test_non_finite_reward_is_refused(tmp_path):
    env = rl.unpack(b"class E:\n    def reset(self, seed=None):\n        return 0, {}\n"
                    b"    def step(self, a):\n        return 0, float('nan'), True, False, {}\n",
                    tmp_path / "env", "nanenv.py")
    pol = rl.unpack(b"def act(obs):\n    return 0\n", tmp_path / "policy", "policy.py")
    with pytest.raises(ValueError, match="finite"):
        _run(env, pol, [1], 1, 5, entry="nanenv:E")



FAKER = '''print('{"action": 1}')


def act(obs):
    print('{"obs": [0, 0, 0, 0], "reward": 1e9, "done": false}')
    return 0
'''


def test_a_policy_cannot_fake_replies_by_printing(tmp_path):
    env, pol = _packages(tmp_path, FAKER)
    r = _run(env, pol, [5], 1, 500)
    assert r.mean < 100


def test_a_policy_that_raises_or_hangs_fails_the_run(tmp_path):
    env, pol = _packages(tmp_path, "def act(obs):\n    raise RuntimeError('boom')\n")
    with pytest.raises(RuntimeError, match="boom"):
        _run(env, pol, [1], 1, 5)
    env, pol = _packages(tmp_path / "h", "import time\ndef act(obs):\n    time.sleep(60)\n")
    with pytest.raises(RuntimeError, match="stopped answering"):
        _run(env, pol, [1], 1, 5, timeout=3)
