"""Per-model token prices in USD per million tokens, used to report what each turn cost."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Price:
    input: float
    output: float
    cache_read: float

    @property
    def cache_write_5m(self) -> float:
        return self.input * 1.25

    @property
    def cache_write_1h(self) -> float:
        return self.input * 2.0


PRICES = {
    "claude-haiku-5-5": Price(0.10, 0.50, 0.01),
    "claude-sonnet-5-5": Price(2.00, 10.00, 0.20),
    "claude-opus-5-5": Price(4.00, 20.00, 0.20),
    "claude-opus-5": Price(5.00, 25.00, 0.50),
    "claude-opus-4-8": Price(5.00, 25.00, 0.50),
}


def empty_usage() -> dict[str, int]:
    return {"input": 0, "output": 0, "cache_read": 0, "cache_write_5m": 0, "cache_write_1h": 0, "calls": 0}


def add_usage(total: dict[str, int], usage) -> None:
    total["calls"] += 1
    total["input"] += usage.input_tokens or 0
    total["output"] += usage.output_tokens or 0
    total["cache_read"] += usage.cache_read_input_tokens or 0
    creation = getattr(usage, "cache_creation", None)
    if creation is not None:
        total["cache_write_5m"] += getattr(creation, "ephemeral_5m_input_tokens", 0) or 0
        total["cache_write_1h"] += getattr(creation, "ephemeral_1h_input_tokens", 0) or 0
    else:
        total["cache_write_5m"] += usage.cache_creation_input_tokens or 0


def cost(model: str, usage: dict[str, int]) -> float:
    price = PRICES.get(model)
    if price is None:
        return 0.0
    return (
        usage["input"] * price.input
        + usage["output"] * price.output
        + usage["cache_read"] * price.cache_read
        + usage["cache_write_5m"] * price.cache_write_5m
        + usage["cache_write_1h"] * price.cache_write_1h
    ) / 1_000_000
