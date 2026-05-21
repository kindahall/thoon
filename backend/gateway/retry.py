from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar


T = TypeVar("T")


async def retry_on_invalid(
    operation: Callable[[int, str | None], Awaitable[T]],
    *,
    max_retries: int,
    base_delay_seconds: float = 0.4,
) -> T:
    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            return await operation(attempt, str(last_error) if last_error else None)
        except ValueError as error:
            last_error = error
            if attempt >= max_retries:
                break
            delay = base_delay_seconds * (2**attempt) + random.uniform(0, 0.2)
            await asyncio.sleep(delay)

    raise ValueError(f"structured output invalid after {max_retries + 1} attempt(s): {last_error}") from last_error
