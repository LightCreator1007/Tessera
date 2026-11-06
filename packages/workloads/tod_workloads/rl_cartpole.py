"""A reference RL environment, classic cart-pole in plain Python, for tests and the local demo of RL competitions."""
import math
import random

# Packaged as an environment, this file alone is the package: entrypoint "rl_cartpole:CartPole".
GRAVITY, CART, POLE, LENGTH, FORCE, TAU = 9.8, 1.0, 0.1, 0.5, 10.0, 0.02
TOTAL = CART + POLE
X_LIMIT, THETA_LIMIT = 2.4, 12 * 2 * math.pi / 360


class CartPole:
    """Gymnasium's CartPole-v1 dynamics: reward 1 per step the pole stays up, actions 0 (left) and 1 (right)."""

    def __init__(self):
        self.rng = random.Random()
        self.state = (0.0, 0.0, 0.0, 0.0)

    def reset(self, seed: int | None = None):
        if seed is not None:
            self.rng = random.Random(seed)
        self.state = tuple(self.rng.uniform(-0.05, 0.05) for _ in range(4))
        return list(self.state), {}

    def step(self, action):
        x, x_dot, theta, theta_dot = self.state
        force = FORCE if int(action) == 1 else -FORCE
        cos, sin = math.cos(theta), math.sin(theta)
        temp = (force + POLE * LENGTH * theta_dot**2 * sin) / TOTAL
        theta_acc = (GRAVITY * sin - cos * temp) / (LENGTH * (4.0 / 3.0 - POLE * cos**2 / TOTAL))
        x_acc = temp - POLE * LENGTH * theta_acc * cos / TOTAL
        x, x_dot = x + TAU * x_dot, x_dot + TAU * x_acc
        theta, theta_dot = theta + TAU * theta_dot, theta_dot + TAU * theta_acc
        self.state = (x, x_dot, theta, theta_dot)
        done = abs(x) > X_LIMIT or abs(theta) > THETA_LIMIT
        return list(self.state), 1.0, done, False, {}


# A policy for it, as the one-file policy.py an entrant would upload: push toward where the pole is falling.
POLICY = "def act(obs):\n    return 1 if obs[2] + 0.5 * obs[3] > 0 else 0\n"
Env = CartPole  # the name an environment package exposes in env.py
