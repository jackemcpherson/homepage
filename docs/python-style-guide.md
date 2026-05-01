# Python Development Style Guide

Project conventions, tech stack, and design principles for Python development.
Informed by the Google Python Style Guide, the Astral (uv/ruff) philosophy of
fast single-purpose tooling, FastAPI's "validate at the boundary" patterns, and
modern type-driven Python (PEP 484+ with strict checking).

This guide spans three project shapes: **CLI tools and scripts**, **data
pipelines**, and **HTTP / MCP services**. Some sections are scoped to a
specific shape — they're labelled. The principles are universal.

---

## Tech Stack

### Core

| Tool | Role | Why |
|------|------|-----|
| **Python 3.13** | Language | Mature, full ecosystem support, improved error messages |
| **Pydantic v2** | Runtime validation | Define once, get types + validation. The boundary layer. |
| **FastAPI** | Web framework (services) | Pydantic-native, async-capable, the ecosystem default |
| **SQLAlchemy 2.0** | Database ORM (transactional) | Modern declarative, full type support, async via `AsyncSession` |
| **Polars** | DataFrames (pipelines) | Multi-threaded, lazy, no index, columnar Arrow-backed |
| **DuckDB** | Analytical SQL (pipelines) | In-process OLAP — query parquet/CSV folders with SQL |

### Tooling

| Tool | Role | TypeScript equivalent |
|------|------|----------------------|
| **uv** | Package manager + script runner + Python installer | Bun |
| **ruff** | Lint + format (single tool) | Biome |
| **pyright** | Type checker (strict mode) | tsc |
| **pytest** | Test runner | Vitest |
| **structlog** | Structured logging | pino |
| **Typer** | CLI framework | — |
| **httpx** | HTTP client (sync + async) | fetch |
| **pydantic-settings** | Config from env / `.env` files | — |

**Why uv:** single Rust binary that installs Python itself, manages virtual
environments, resolves dependencies, runs scripts, and builds wheels. Replaces
pip, pip-tools, pyenv, virtualenv, pipx, poetry, and pdm. `uv sync` is an order
of magnitude faster than poetry/pip on cold installs and effectively
instantaneous on warm ones. Lock file is `uv.lock` — commit it.

**Why ruff over black + flake8 + isort + pyupgrade:** ruff is a single
Rust-based tool that replaces all of them at much higher speed and with one
config file. Same philosophy as Biome in the TS world.

**Why pyright over mypy:** pyright is what every modern editor (VS Code,
Cursor, Zed via Pylance) already runs in the background, so devs see errors as
they type without extra setup. Inference is meaningfully better than mypy on
generics and type narrowing — fewer `# type: ignore` escape hatches. Pyright
is the de facto strict checker; mypy is the lowest common denominator.

> **Watch this space:** Astral are building [`ty`](https://github.com/astral-sh/ty),
> a Rust-based type checker. As of writing it is in preview. Once it reaches
> stability and feature parity with pyright strict mode, it will likely become
> the recommendation here — same trajectory as ruff replacing flake8.

### Package Configuration

`pyproject.toml` is the single source of truth. Tool configuration lives here,
not in `setup.cfg`, `.flake8`, `tox.ini`, or `pytest.ini`.

```toml
[project]
name = "myapp"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
    "fastapi>=0.115",
    "pydantic>=2.9",
    "pydantic-settings>=2.5",
    "sqlalchemy>=2.0",
    "structlog>=24.4",
    "httpx>=0.27",
    "typer>=0.13",
    "polars>=1.12",
    "duckdb>=1.1",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.24",
    "hypothesis>=6",
    "coverage>=7",
    "ruff>=0.7",
    "pyright>=1.1.380",
    "pre-commit>=4",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

# --- Tool configuration ---

[tool.pyright]
include = ["src", "tests"]
typeCheckingMode = "strict"
pythonVersion = "3.13"
reportMissingTypeStubs = "warning"
reportUnknownMemberType = "warning"   # noisy on third-party libs without stubs
reportUnknownArgumentType = "warning"
reportImplicitOverride = "error"       # require explicit @override
reportMissingImports = "error"
reportUnusedImport = "error"
reportUnusedVariable = "error"

[tool.ruff]
target-version = "py313"
line-length = 100
src = ["src", "tests"]

[tool.ruff.lint]
select = [
    "E", "W",       # pycodestyle
    "F",            # pyflakes
    "I",            # isort
    "N",            # pep8-naming
    "UP",           # pyupgrade
    "B",            # flake8-bugbear
    "A",            # flake8-builtins
    "C4",           # flake8-comprehensions
    "DTZ",          # flake8-datetimez (timezone-aware datetimes)
    "RET",          # flake8-return
    "SIM",          # flake8-simplify
    "TCH",          # flake8-type-checking
    "PTH",          # flake8-use-pathlib (no os.path)
    "PL",           # pylint subset
    "RUF",          # ruff-specific
    "D",            # pydocstyle (Google convention)
    "ANN",          # flake8-annotations (require type hints)
]
ignore = [
    "D203",         # one-blank-line-before-class (conflicts with D211)
    "D213",         # multi-line-summary-second-line (conflicts with D212)
    "PLR0913",      # too-many-arguments (let pyright catch real issues)
]

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["D", "ANN", "PLR2004"]   # tests don't need docstrings or magic-number checks
"**/__init__.py" = ["D104", "F401"]    # package __init__ files

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.coverage.run]
source = ["src/myapp"]
branch = true

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
    "\\.\\.\\.",                # ellipsis in Protocol bodies
]
```

### Project Setup

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Scaffold a new project
uv init --package myapp
cd myapp

# Install dependencies (creates .venv automatically)
uv add fastapi pydantic pydantic-settings sqlalchemy structlog httpx typer polars duckdb
uv add --dev pytest pytest-asyncio hypothesis coverage ruff pyright pre-commit

# Initialise pre-commit hooks
uv run pre-commit install

# Verify everything works
uv run pytest
uv run ruff check .
uv run pyright
```

### Common Commands

| Command | Purpose |
|---------|---------|
| `uv sync` | Install / update dependencies from lock file |
| `uv run <cmd>` | Run a command inside the project venv |
| `uv add <pkg>` | Add a runtime dependency |
| `uv add --dev <pkg>` | Add a dev-only dependency |
| `uv tool install <pkg>` | Install a CLI tool globally (equivalent to `pipx install`) |
| `uvx <cmd>` | Run a one-off command in an ephemeral venv (equivalent to `bunx`) |
| `uv run pytest` | Run tests |
| `uv run ruff check --fix .` | Lint + auto-fix |
| `uv run ruff format .` | Format |
| `uv run pyright` | Type-check |

---

## Pyright Configuration

Always use strict mode. No exceptions. All settings live in `pyproject.toml`
(see Package Configuration above).

### Key Settings

- **`typeCheckingMode = "strict"`** — enables all strict rules. Non-negotiable.
- **`reportImplicitOverride = "error"`** — methods overriding a base class must be marked `@override` (PEP 698). Catches the bug where you rename a base method and silently stop overriding it.
- **`reportMissingTypeStubs = "warning"`** — flag third-party libraries that ship without type stubs, but don't block. `# type: ignore[import-untyped]` is acceptable for those, with a comment.

If a library is genuinely untyped and matters to your business logic, write a
local stub in `typings/<package>.pyi` rather than scattering `Any` through your
code.

---

## Ruff Configuration

All ruff settings live in `pyproject.toml` (see Package Configuration above).
Google-style docstrings are enforced via `[tool.ruff.lint.pydocstyle] convention = "google"`,
and the `"D"` rule set ensures docstring presence and formatting. Tests are
exempted from docstring and annotation requirements via per-file ignores.

---

## Naming Conventions

Follow PEP 8.

| Construct | Convention | Example |
|-----------|-----------|---------|
| Variables, functions, methods | `snake_case` | `fetch_recent_orders`, `customer_id` |
| Classes, type aliases | `PascalCase` | `Order`, `LineItem`, `PaymentsApiClient` |
| Constants (true constants) | `SCREAMING_SNAKE` | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE` |
| Modules / file names | `snake_case` | `payments_api.py`, `line_items.py` |
| Test files | `test_*.py` | `test_payments_api.py` |
| Private members | `_leading_underscore` | `_token_cache` |
| "Really private" (name-mangled) | `__double_underscore` | Rare — only for inheritance protection |
| Type variables | `PascalCase`, single letter or descriptive | `T`, `OrderT`, `ResultT` |

### Naming Principles

- **Be descriptive.** `fetch_orders_for_customer` over `get_orders`. `customer_id` over `cid`.
- **Boolean variables** start with `is_`, `has_`, `should_`, `can_`: `is_paid`, `has_shipped`.
- **Collections** are plural: `orders`, `line_items`, `customers`.
- **Functions that return coroutines** don't need an `async_` prefix or `_async` suffix — `await` at the call site says it.
- **Acronyms in `PascalCase`** are treated as words: `HttpClient`, not `HTTPClient`. `JsonParser`, not `JSONParser`. Same rule as Google's TypeScript style.
- **Don't shadow builtins.** `id`, `type`, `list`, `dict`, `filter`, `map` — ruff's `A` rules will flag these.

---

## Type System

Type hints are **mandatory** on every public function signature, every class
attribute, and every module-level constant. Internal helpers with obvious
inferred return types may omit the return annotation; everything else is
typed.

### Use Modern Syntax

Pyright in strict mode plus `target-version = "py313"` means no compatibility
shims. Use the modern, lowercase, builtin-generic forms.

```python
# Good — modern (PEP 585, PEP 604)
def fetch_orders(customer_id: int) -> list[Order]: ...
def find_order(order_id: int) -> Order | None: ...
def index_by_id(orders: list[Order]) -> dict[int, Order]: ...

# Bad — legacy typing-module forms
from typing import List, Optional, Dict
def fetch_orders(customer_id: int) -> List[Order]: ...
def find_order(order_id: int) -> Optional[Order]: ...
def index_by_id(orders: List[Order]) -> Dict[int, Order]: ...
```

`from __future__ import annotations` is **not** required on 3.13; ruff's `UP`
rules will remove it if accidentally added. Omit it.

### Ban `Any`, Use `object` or a Concrete Type

```python
# Bad — silently disables all type checking
def parse_response(data: Any) -> Order: ...

# Good — forces the caller / callee to narrow before using
def parse_response(data: object) -> Order:
    return Order.model_validate(data)   # Pydantic narrows here
```

`Any` is acceptable in exactly two situations: (1) interfacing with a third-party
library that genuinely accepts arbitrary input (rare), and (2) bridging from
`json.loads` output before validation runs. In both cases, the `Any` should
disappear within a few lines.

### Prefer `dataclass` for Simple Records, Pydantic for Boundaries

Two model layers, used for different jobs:

```python
from dataclasses import dataclass
from datetime import datetime
from pydantic import BaseModel

# Pydantic — for data crossing a trust boundary (HTTP request, API response,
# config, user input). Validates at construction, raises ValidationError on
# bad input.
class CreateOrderRequest(BaseModel):
    customer_id: int
    line_items: list["LineItemInput"]
    currency: str
    notes: str | None = None


class LineItemInput(BaseModel):
    product_id: int
    quantity: int
    unit_price_cents: int


# Dataclass — for in-memory domain objects. No validation, no overhead, just
# a typed bag of fields. Use frozen=True to make it immutable.
@dataclass(frozen=True, slots=True)
class Order:
    id: int
    customer_id: int
    placed_at: datetime
    status: str
    subtotal_cents: int
    tax_cents: int
    total_cents: int
    currency: str
```

**Rule of thumb:** if the data crosses a process boundary or comes from a
human, it's Pydantic. If it lives only inside your code, it's a frozen
dataclass. Don't mix them — using Pydantic everywhere bloats hot loops with
validation overhead; using dataclasses at the boundary loses the validation
that catches bugs.

### Use Pydantic at Boundaries

Every piece of external data (API responses, user input, environment variables,
config files) passes through Pydantic before entering your typed domain.

```python
from datetime import datetime
from pydantic import BaseModel, Field

class PaymentChargeResponse(BaseModel):
    """Raw shape returned by the payments provider's /charges endpoint."""

    charge_id: str = Field(alias="id")
    amount_cents: int = Field(alias="amount")
    currency: str
    status: str
    created_at: datetime = Field(alias="created")
    customer_external_id: str = Field(alias="customer")
    receipt_url: str | None = Field(default=None, alias="receipt_url")

    model_config = {"populate_by_name": True}


# Validate at the boundary
raw = response.json()
charge = PaymentChargeResponse.model_validate(raw)   # raises ValidationError if bad
```

### Discriminated Unions for Mixed Result Types

Use `Literal` discriminants and `TypeAdapter` (or Pydantic discriminated unions)
for sum types.

```python
from typing import Literal
from pydantic import BaseModel, TypeAdapter


class OrderEvent(BaseModel):
    type: Literal["order"] = "order"
    order_id: int
    customer_id: int
    status: str
    total_cents: int


class RefundEvent(BaseModel):
    type: Literal["refund"] = "refund"
    refund_id: int
    original_order_id: int
    amount_cents: int
    reason: str


WebhookEvent = OrderEvent | RefundEvent
WebhookEventAdapter = TypeAdapter(WebhookEvent)


# Pyright narrows on the discriminant
def describe_event(event: WebhookEvent) -> str:
    match event:
        case OrderEvent():
            return f"Order {event.order_id} → {event.status}"
        case RefundEvent():
            return f"Refund {event.refund_id} for order {event.original_order_id}"
```

### Use `Protocol` for Structural Typing

Python's equivalent of TypeScript's structural interfaces. Use `Protocol` when
you want "anything with this shape," not nominal inheritance.

```python
from typing import Protocol

class SupportsFetch(Protocol):
    async def fetch(self, url: str) -> bytes: ...

# Any class with a matching `fetch` signature satisfies this — no need to
# inherit from SupportsFetch.
async def download_all(client: SupportsFetch, urls: list[str]) -> list[bytes]:
    return [await client.fetch(url) for url in urls]
```

Use `ABC` and `abstractmethod` only when you need shared implementation in the
base class. For pure interfaces, `Protocol` is the right tool.

### `NewType` for Domain IDs

When two `int` IDs mean different things, give them distinct types so the
checker catches mix-ups.

```python
from typing import NewType

OrderId = NewType("OrderId", int)
CustomerId = NewType("CustomerId", int)
ProductId = NewType("ProductId", int)


def get_line_items(order_id: OrderId, product_id: ProductId) -> list[LineItem]: ...


# This is now a type error, even though both are ints underneath:
get_line_items(CustomerId(5), ProductId(123))   # pyright: error
```

### `Final` for Constants

```python
from typing import Final

MAX_RETRY_COUNT: Final[int] = 3
DEFAULT_TIMEOUT_SECONDS: Final[float] = 30.0
SUPPORTED_CURRENCIES: Final[tuple[str, ...]] = ("USD", "EUR", "GBP", "AUD", "JPY")
```

`Final` tells pyright the value won't be reassigned, and ruff treats them as
true constants for the SCREAMING_SNAKE naming check.

---

## Documentation (Google-Style Docstrings)

Use Google-style docstrings throughout. Document all public functions, classes,
and modules. Internal helpers get a single-line docstring if their purpose
isn't obvious from the name.

### Function Documentation

```python
async def fetch_recent_orders(
    customer_id: CustomerId,
    since: datetime | None = None,
) -> list[Order]:
    """Fetch a customer's recent orders from the orders service.

    Returns orders placed after `since`, ordered most-recent first. Falls
    back to the read replica if the primary is unreachable.

    Args:
        customer_id: The customer whose orders to fetch.
        since: Earliest order placement time to include. Defaults to 90
            days ago if omitted.

    Returns:
        Orders sorted by placement time, newest first.

    Raises:
        OrdersApiError: If both primary and replica are unreachable.

    Example:
        >>> orders = await fetch_recent_orders(CustomerId(42))
        >>> last_week = await fetch_recent_orders(
        ...     CustomerId(42), since=datetime.now(UTC) - timedelta(days=7)
        ... )
    """
```

### Class Documentation

```python
@dataclass(frozen=True, slots=True)
class LineItem:
    """A single product line within an order.

    One row per product per order. Quantity may be greater than one.
    Prices are stored as integer cents in the order's currency to avoid
    floating-point rounding errors.

    Attributes:
        id: Unique row identifier.
        order_id: Foreign key to the parent order.
        product_id: Foreign key to the product table.
        quantity: Number of units of this product on the order.
        unit_price_cents: Price per unit at the time of order, in the
            order's currency. Captured at order time so historical
            prices remain stable when the product price later changes.
        line_total_cents: ``quantity * unit_price_cents``, denormalised
            for query performance.
    """

    id: int
    order_id: int
    product_id: int
    quantity: int
    unit_price_cents: int
    line_total_cents: int
```

### When to Document

- **Always:** public functions, exported classes, module-level constants, modules themselves (top-of-file docstring).
- **Sometimes:** private methods with non-obvious logic. Complex generic functions.
- **Never:** self-explanatory one-liners, dunder methods with obvious behaviour, properties whose name says everything.

```python
# No doc needed — name says everything
def is_overdue(invoice_due: datetime, now: datetime) -> bool:
    return now > invoice_due


# Doc needed — non-obvious calculation
def calculate_customer_lifetime_value(
    orders: list[Order],
    refunds: list[Refund],
    *,
    discount_rate_annual: float = 0.08,
) -> Decimal:
    """Calculate present value of a customer's net spend.

    Sums all order totals, subtracts refunds, and discounts each
    cash flow back to the customer's first-order date using the
    configured annual discount rate.

    Args:
        orders: All historical orders for the customer.
        refunds: All historical refunds for the customer.
        discount_rate_annual: Annual discount rate as a decimal
            (0.08 = 8%). Defaults to the company's WACC.

    Returns:
        Present value in the orders' currency. Assumes all orders
        share the same currency; raises ValueError otherwise.
    """
```

---

## Error Handling

Idiomatic Python: a custom exception hierarchy for unexpected failures, plus
`T | None` returns for expected absences. **Don't import a `Result` library** —
it produces non-idiomatic Python and `pyright` narrows `T | None` perfectly
well.

### Custom Exception Hierarchy

Build a small hierarchy rooted at one project-specific base. This lets callers
catch project errors without catching every `Exception`.

```python
class AppError(Exception):
    """Base class for all application errors."""


class PaymentsApiError(AppError):
    """The payments API returned an error or was unreachable."""

    def __init__(self, message: str, status_code: int, endpoint: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.endpoint = endpoint


class StaleDataError(AppError):
    """Stored data is older than the configured freshness threshold."""

    def __init__(self, last_update: datetime, threshold_minutes: int) -> None:
        age_minutes = int((datetime.now(UTC) - last_update).total_seconds() // 60)
        super().__init__(
            f"Data is {age_minutes} minutes old (threshold: {threshold_minutes})",
        )
        self.last_update = last_update
        self.threshold_minutes = threshold_minutes


class InsufficientStockError(AppError):
    """An order line item requested more units than are available."""

    def __init__(self, product_id: ProductId, requested: int, available: int) -> None:
        super().__init__(
            f"Product {product_id}: requested {requested}, only {available} available",
        )
        self.product_id = product_id
        self.requested = requested
        self.available = available
```

### `T | None` for Expected Absence

When a function can legitimately "find nothing" (DB lookup miss, optional
config value, search returning no result), return `T | None`. The caller
narrows with a plain `if`.

```python
async def find_order_by_id(session: AsyncSession, order_id: OrderId) -> Order | None:
    """Return the order with this ID, or None if not found."""
    result = await session.execute(select(Order).where(Order.id == order_id))
    return result.scalar_one_or_none()


# Caller — pyright narrows after the check
order = await find_order_by_id(session, OrderId(123))
if order is None:
    return Response(status_code=404)
# from here on, pyright knows `order` is `Order`, not `Order | None`
print(order.total_cents)
```

Reserve exceptions for **unexpected** failures: network errors, malformed
data, contract violations, programmer errors. "Lookup miss" is not unexpected.

### Never Swallow Errors

```python
# Bad — silent failure
try:
    charge = await create_charge(order)
except Exception:
    pass


# Bad — strips context, returns sentinel that may collide with valid data
try:
    charge = await create_charge(order)
except Exception:
    return None


# Good — log with structured context, re-raise as a project error
try:
    charge = await create_charge(order)
except httpx.HTTPError as exc:
    log.error("payments.charge.failed", order_id=order.id, error=str(exc))
    raise PaymentsApiError(
        "Charge creation failed",
        status_code=502,
        endpoint="/v1/charges",
    ) from exc
```

The `raise ... from exc` chain preserves the original traceback. Always use
`from` when re-raising — it makes debugging dramatically easier.

### Use `match` for Exception Dispatch When It Helps

```python
try:
    order = await fetch_order(order_id)
except AppError as exc:
    match exc:
        case PaymentsApiError(status_code=404):
            log.warning("order.not_found", order_id=order_id)
            return None
        case PaymentsApiError(status_code=code) if code >= 500:
            log.error("payments.api_down", order_id=order_id, status=code)
            raise
        case StaleDataError():
            log.warning("order.stale", order_id=order_id)
            return await fetch_from_replica(order_id)
```

---

## Logging (structlog)

`structlog` is the only logger in the codebase. Don't import `logging`
directly. Don't use `print` for diagnostics. Don't use `loguru`.

### Configuration

```python
# src/myapp/logging_config.py
import structlog
import sys

def configure_logging(*, json_output: bool, level: str = "INFO") -> None:
    """Configure structlog for the whole process.

    Call once at application entry point (CLI main, FastAPI lifespan, MCP
    server startup). Subsequent log calls anywhere in the codebase pick up
    this config.

    Args:
        json_output: If True, emit JSON (production). If False, pretty
            console output (development).
        level: Minimum log level.
    """
    processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if json_output:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty()))

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(structlog.stdlib, level)
        ),
        cache_logger_on_first_use=True,
    )
```

### Usage

```python
import structlog

log = structlog.get_logger(__name__)


async def fetch_recent_orders(customer_id: CustomerId) -> list[Order]:
    log.info("orders.fetch.start", customer_id=customer_id)
    try:
        orders = await orders_service.fetch(customer_id)
    except OrdersApiError as exc:
        log.error("orders.fetch.failed", customer_id=customer_id, error=str(exc))
        raise
    log.info("orders.fetch.complete", customer_id=customer_id, count=len(orders))
    return orders
```

### Logging Principles

- **Event names are dotted, lowercase, past-tense or imperative.** `orders.fetch.start`, `order.placed`, `db.query.slow`. Stable identifiers — searchable in production.
- **Pass structured context as kwargs, never f-string into the message.** `log.info("user.login", user_id=user_id)` not `log.info(f"user {user_id} logged in")`. The whole point is structured fields you can filter on.
- **Use `contextvars` for request-scoped fields.** `structlog.contextvars.bind_contextvars(request_id=...)` once per request — every log call inside that request automatically includes it.
- **Don't log sensitive data.** Tokens, passwords, full credit card numbers. Add scrubbing processors if your domain requires it.
- **Choose level by audience.** `DEBUG` = developer diagnosing locally. `INFO` = operator watching production. `WARNING` = something off but not failing. `ERROR` = action required. Don't log every function entry at INFO.

---

## Project Structure

Use the `src/` layout. Tests live next to it under `tests/`. This prevents the
"my import works because the cwd is on `sys.path`" class of bug — your code
only resolves through the installed package.

```
myapp/
├── src/
│   └── myapp/
│       ├── __init__.py
│       ├── __main__.py            # `python -m myapp` entry
│       ├── cli.py                 # Typer app
│       ├── config.py              # pydantic-settings Settings model
│       ├── logging_config.py      # structlog setup
│       ├── types.py               # Shared dataclasses, NewTypes, Protocols
│       ├── exceptions.py          # AppError + subclasses
│       ├── api/                   # FastAPI app (HTTP service)
│       │   ├── __init__.py
│       │   ├── app.py             # FastAPI() + lifespan
│       │   ├── routes/
│       │   │   ├── orders.py
│       │   │   └── customers.py
│       │   └── schemas.py         # Pydantic request/response models
│       ├── db/                    # SQLAlchemy
│       │   ├── __init__.py
│       │   ├── models.py          # Declarative ORM models
│       │   ├── session.py         # Engine + AsyncSession factory
│       │   └── queries.py         # Reusable typed query functions
│       ├── etl/                   # Data pipeline
│       │   ├── __init__.py
│       │   ├── payments_api.py    # Payments provider client (httpx)
│       │   ├── fulfillment_api.py # Fulfillment provider client
│       │   ├── transforms.py      # Pure functions: raw → domain
│       │   └── pipeline.py        # Orchestrator
│       └── analytics/             # DuckDB / Polars
│           ├── __init__.py
│           ├── revenue.py
│           └── customer_cohorts.py
├── tests/
│   ├── etl/
│   │   ├── test_payments_api.py
│   │   └── test_transforms.py
│   ├── api/
│   │   └── test_routes.py
│   ├── fixtures/
│   │   ├── payments_charge.json
│   │   └── orders_export.csv
│   └── conftest.py                # Shared pytest fixtures
├── pyproject.toml
├── uv.lock
├── .pre-commit-config.yaml
├── .python-version                # Pinned by `uv python pin`
└── README.md
```

### Principles

- **`types.py` is written first.** Before any fetch logic, define `Order`, `Customer`, `LineItem` and the `NewType` IDs. The checker guides everything from there.
- **One module per data source.** `payments_api.py`, `fulfillment_api.py` — each owns its HTTP calls, response parsing, and Pydantic validation.
- **`transforms.py` is pure functions.** No I/O, no side effects. Takes raw API shapes, returns domain types. Trivially unit-testable.
- **`pipeline.py` is the orchestrator.** Calls sources in priority order, handles fallback logic, coordinates loading. This is the cron / scheduled-task entry point.
- **Tests mirror `src/` structure.** A test file lives at the same relative path under `tests/` as its target module under `src/myapp/`.
- **`__init__.py` is mostly empty.** Re-export only what is genuinely public API. No logic.

---

## Code Patterns

### Async Where It Pays, Sync Elsewhere

Use `async` when concurrency matters: web/MCP request handlers, code that
makes >2 concurrent network calls, code that holds many open connections.
Use sync everywhere else — CLIs, scripts, pure transforms, one-shot data
loads, anything that runs end-to-end on one thread.

```python
# Good — async pays off, three calls run concurrently
async def load_customer_dashboard(customer_id: CustomerId) -> Dashboard:
    orders, payment_methods, recommendations = await asyncio.gather(
        fetch_recent_orders(customer_id),
        fetch_payment_methods(customer_id),
        fetch_recommendations(customer_id),
    )
    return Dashboard(
        orders=orders,
        payment_methods=payment_methods,
        recommendations=recommendations,
    )


# Good — sync, no concurrency to gain
def calculate_order_total(line_items: list[LineItem], tax_rate: Decimal) -> OrderTotal:
    subtotal_cents = sum(item.line_total_cents for item in line_items)
    tax_cents = int(subtotal_cents * tax_rate)
    return OrderTotal(
        subtotal_cents=subtotal_cents,
        tax_cents=tax_cents,
        total_cents=subtotal_cents + tax_cents,
    )


# Bad — async without concurrency. Just makes the call site harder.
async def calculate_order_total(line_items: list[LineItem], tax_rate: Decimal) -> OrderTotal:
    ...
```

### Use `asyncio.TaskGroup`, Not Bare `gather` for Structured Concurrency

`TaskGroup` (3.11+) is the modern replacement for `asyncio.gather`. It
guarantees that if any task fails, all sibling tasks are cancelled and the
group exits cleanly with an `ExceptionGroup`. `gather` leaves cancelled-task
behaviour ambiguous.

```python
async def enrich_order(order_id: OrderId) -> EnrichedOrder:
    async with asyncio.TaskGroup() as tg:
        order_task = tg.create_task(fetch_order(order_id))
        items_task = tg.create_task(fetch_line_items(order_id))
        ship_task = tg.create_task(fetch_shipment(order_id))

    return EnrichedOrder(
        order=order_task.result(),
        line_items=items_task.result(),
        shipment=ship_task.result(),
    )
```

`gather(..., return_exceptions=True)` remains the right tool for "tolerate
partial failure" — equivalent to `Promise.allSettled`.

### Comprehensions and Generators Over Imperative Loops

```python
# Good — readable, no mutation
def normalise_orders(raw: list[ExternalOrderResponse]) -> list[Order]:
    return [
        _build_order(_normalise_currency(o))
        for o in raw
        if o.placed_at is not None
    ]


# Bad — mutating accumulator, harder to follow
def normalise_orders(raw: list[ExternalOrderResponse]) -> list[Order]:
    result: list[Order] = []
    for o in raw:
        if o.placed_at is None:
            continue
        o = _normalise_currency(o)
        result.append(_build_order(o))
    return result
```
```

For long pipelines, break each stage into a named function — comprehensions
shine for one or two transforms, not five.

### `pathlib.Path`, Never `os.path`

`os.path` is a 1990s string-manipulation API. `Path` is typed, composable,
and platform-correct.

```python
from pathlib import Path

# Good
fixtures_dir = Path(__file__).parent / "fixtures"
config_path = Path.home() / ".config" / "myapp" / "config.toml"
data = json.loads(config_path.read_text(encoding="utf-8"))


# Bad
import os
fixtures_dir = os.path.join(os.path.dirname(__file__), "fixtures")
```

Ruff's `PTH` rules will flag `os.path` usage automatically.

### `dict` for Lookups, with Explicit Types

```python
# Good — typed mapping, idiomatic
CURRENCY_SYMBOLS: Final[dict[str, str]] = {
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "AUD": "A$",
    "JPY": "¥",
}


def format_amount(amount_cents: int, currency: str) -> str:
    symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")
    return f"{symbol}{amount_cents / 100:.2f}"
```

Reach for `collections.ChainMap` if you need layered lookups (defaults +
overrides), and `frozenset` / `dict.keys() | other.keys()` for set algebra
on keys.

### Configuration via `pydantic-settings`

All configuration comes from environment variables, validated on startup.
No reading `os.environ` scattered through the codebase, no mutable globals,
no `dotenv` calls inside functions.

```python
# src/myapp/config.py
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, loaded from environment variables."""

    database_url: str = Field(..., description="SQLAlchemy DSN")
    payments_api_url: str = "https://api.payments.example.com"
    payments_api_key: str = Field(..., description="Bearer token for payments provider")
    log_level: str = "INFO"
    json_logs: bool = True
    request_timeout_seconds: float = 30.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="MYAPP_",
        frozen=True,
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()   # type: ignore[call-arg]
```

```python
# Usage — anywhere in the app
from myapp.config import get_settings

settings = get_settings()
async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
    ...
```

The `lru_cache` makes `get_settings()` a singleton without import-time side
effects, which keeps tests sane (override via dependency injection in
FastAPI, or monkeypatch in pytest).

### Polars: Lazy Where Possible, Eager Where Convenient

```python
import polars as pl

# Good — lazy scan, predicate pushdown, projection pruning
def top_customers_by_revenue(year: int, parquet_dir: Path) -> pl.DataFrame:
    return (
        pl.scan_parquet(parquet_dir / "orders.parquet")
        .filter(pl.col("placed_at").dt.year() == year)
        .filter(pl.col("status") == "completed")
        .group_by("customer_id")
        .agg(
            pl.col("total_cents").sum().alias("revenue_cents"),
            pl.col("id").n_unique().alias("order_count"),
            pl.col("placed_at").min().alias("first_order_at"),
        )
        .filter(pl.col("order_count") >= 3)
        .sort("revenue_cents", descending=True)
        .head(100)
        .collect()
    )
```

**Polars principles:**

- **Lazy by default for files.** `pl.scan_parquet` over `pl.read_parquet` — the optimiser will only read columns you select and push filters down to the file reader.
- **Expressions over loops.** Anything you can write as `pl.col("x").something()` is faster and clearer than iterating.
- **No index.** Polars has columns and rows. If you find yourself wanting an index, you want a `join` or a `sort`.
- **Avoid `to_pandas()` unless required.** It allocates a full copy and loses the type information.

### DuckDB: SQL Over Files

DuckDB is the right tool when the operation reads as SQL, especially across
parquet folders, S3 paths, or large tables that don't need to be in a
service database.

```python
import duckdb
from pathlib import Path

def monthly_revenue_by_product(parquet_dir: Path, year: int) -> pl.DataFrame:
    """Aggregate monthly revenue per product for a given year."""
    conn = duckdb.connect(":memory:")
    return conn.execute(
        """
        SELECT
            DATE_TRUNC('month', o.placed_at) AS month,
            li.product_id,
            SUM(li.line_total_cents) AS revenue_cents,
            SUM(li.quantity) AS units_sold,
            COUNT(DISTINCT o.id) AS order_count
        FROM read_parquet($orders_glob) o
        JOIN read_parquet($items_glob) li ON li.order_id = o.id
        WHERE EXTRACT(year FROM o.placed_at) = $year
          AND o.status = 'completed'
        GROUP BY 1, 2
        ORDER BY 1, revenue_cents DESC
        """,
        {
            "orders_glob": str(parquet_dir / "orders" / "*.parquet"),
            "items_glob": str(parquet_dir / "line_items" / "*.parquet"),
            "year": year,
        },
    ).pl()   # return as Polars DataFrame
```

**When to pick DuckDB over Polars:** the query is more naturally SQL (joins
across many tables, aggregations with HAVING, window functions). DuckDB and
Polars share Arrow memory format — converting between them is free.

**When to pick SQLAlchemy over DuckDB:** you're reading or writing the
service's transactional state. DuckDB is for analytics over files; SQLAlchemy
is for the application database.

### SQLAlchemy 2.0: Modern Declarative

```python
# src/myapp/db/models.py
from datetime import datetime
from sqlalchemy import ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True)
    full_name: Mapped[str]
    created_at: Mapped[datetime]


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    unit_price_cents: Mapped[int]
    currency: Mapped[str]


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    placed_at: Mapped[datetime]
    status: Mapped[str]
    subtotal_cents: Mapped[int]
    tax_cents: Mapped[int]
    total_cents: Mapped[int]
    currency: Mapped[str]

    customer: Mapped[Customer] = relationship()
    line_items: Mapped[list["LineItem"]] = relationship(back_populates="order")


class LineItem(Base):
    __tablename__ = "line_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int]
    unit_price_cents: Mapped[int]
    line_total_cents: Mapped[int]

    order: Mapped[Order] = relationship(back_populates="line_items")
    product: Mapped[Product] = relationship()
```

```python
# src/myapp/db/queries.py
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .models import Order


async def get_orders_for_customer(
    session: AsyncSession,
    *,
    customer_id: int,
    since: datetime,
) -> list[Order]:
    """Return all orders for a customer placed after `since`, newest first."""
    stmt = (
        select(Order)
        .where(Order.customer_id == customer_id, Order.placed_at >= since)
        .order_by(Order.placed_at.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())
```

**Principles:**

- **`Mapped[T]` types are mandatory.** Modern SQLAlchemy infers column types from these. `mapped_column(...)` only when you need extra metadata (PK, FK, server defaults).
- **Wrap raw SQL** in `text()` and parameter-bind — never f-string user input into a query string.
- **One query function per use case** in `db/queries.py`. Don't scatter `select(...)` chains through route handlers.
- **Migrations** with Alembic, generated from model diffs (`alembic revision --autogenerate`). Never hand-write migration SQL.

### FastAPI Patterns

```python
# src/myapp/api/app.py
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from fastapi import FastAPI
from myapp.config import get_settings
from myapp.logging_config import configure_logging
from myapp.api.routes import orders, customers


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(json_output=settings.json_logs, level=settings.log_level)
    # set up DB engine, HTTP clients, etc. on app.state
    yield
    # tear down


app = FastAPI(lifespan=lifespan, title="MyApp")
app.include_router(orders.router)
app.include_router(customers.router)
```

```python
# src/myapp/api/routes/orders.py
from datetime import datetime, timedelta, UTC
from fastapi import APIRouter, Depends, HTTPException
from myapp.api.schemas import OrderOut
from myapp.db.session import get_session
from myapp.db.queries import get_orders_for_customer
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/customers/{customer_id}/orders", tags=["orders"])


@router.get("", response_model=list[OrderOut])
async def list_customer_orders(
    customer_id: int,
    days: int = 90,
    session: AsyncSession = Depends(get_session),
) -> list[OrderOut]:
    since = datetime.now(UTC) - timedelta(days=days)
    orders = await get_orders_for_customer(
        session, customer_id=customer_id, since=since
    )
    if not orders:
        raise HTTPException(status_code=404, detail="No orders in that window")
    return [OrderOut.model_validate(o, from_attributes=True) for o in orders]
```

**Principles:**

- **Pydantic models for every request body and response.** `response_model=` always set — it acts as a serialisation contract independent of your DB models.
- **Query functions stay in `db/queries.py`.** Route handlers orchestrate; they don't write SQL.
- **`Depends()` for cross-cutting concerns.** DB sessions, auth, settings — all injected, never imported as globals inside the handler.
- **`HTTPException` only at the route layer.** Inside the domain, raise `AppError` subclasses; let an exception handler at the app level translate them to HTTP responses.

### Typer for CLIs

```python
# src/myapp/cli.py
import typer
from myapp.config import get_settings
from myapp.logging_config import configure_logging
from myapp.etl.pipeline import run_etl_pipeline

app = typer.Typer(help="MyApp data pipeline + service entry points.")


@app.command()
def etl(
    since: str = typer.Option(..., help="ISO date, e.g. 2026-01-01"),
    full_refresh: bool = typer.Option(False, help="Reload everything from scratch"),
) -> None:
    """Run the ETL pipeline, ingesting orders since the given date."""
    settings = get_settings()
    configure_logging(json_output=settings.json_logs, level=settings.log_level)
    run_etl_pipeline(since=since, full_refresh=full_refresh)


@app.command()
def serve(
    host: str = "0.0.0.0",
    port: int = 8000,
) -> None:
    """Run the FastAPI service."""
    import uvicorn
    uvicorn.run("myapp.api.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    app()
```

Wire it up in `pyproject.toml`:

```toml
[project.scripts]
myapp = "myapp.cli:app"
```

Now `uv run myapp etl --since 2026-01-01` works, and `uv tool install .`
installs the CLI globally.

---

## Testing

### pytest, with `pytest-asyncio` and `hypothesis`

```python
# tests/etl/test_transforms.py
import json
from pathlib import Path
import pytest
from myapp.etl.transforms import build_order

FIXTURES = Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def raw_export() -> dict[str, object]:
    return json.loads((FIXTURES / "orders_export.json").read_text())


def test_build_order_extracts_line_total(raw_export: dict[str, object]) -> None:
    item = raw_export["orders"][0]   # type: ignore[index]
    order = build_order(item)

    assert order.subtotal_cents == 4500
    assert order.tax_cents == 360
    assert order.total_cents == 4860


def test_build_order_handles_missing_tax(raw_export: dict[str, object]) -> None:
    item = dict(raw_export["orders"][0])   # type: ignore[index, arg-type]
    item.pop("tax_amount", None)

    order = build_order(item)

    assert order.tax_cents == 0
    assert order.total_cents == order.subtotal_cents
```

### Async Tests

```python
# tests/api/test_routes.py
import pytest
from httpx import ASGITransport, AsyncClient
from myapp.api.app import app


@pytest.mark.asyncio
async def test_list_orders_returns_404_for_quiet_customer() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/customers/99999/orders?days=30")

    assert response.status_code == 404
```

`pytest-asyncio` is configured in `pyproject.toml` (see Package Configuration)
with `asyncio_mode = "auto"` so async tests don't need the `@pytest.mark.asyncio`
decorator.

### Property-Based Tests with Hypothesis

For pure functions, hypothesis finds edge cases you would never write by hand.

```python
from hypothesis import given, strategies as st
from myapp.pricing import calculate_total_cents


@given(
    subtotal=st.integers(min_value=0, max_value=10_000_000),
    tax_rate_basis_points=st.integers(min_value=0, max_value=2_500),
)
def test_total_is_subtotal_plus_tax(subtotal: int, tax_rate_basis_points: int) -> None:
    total = calculate_total_cents(subtotal, tax_rate_basis_points)
    assert total >= subtotal


@given(subtotal=st.integers(min_value=0, max_value=10_000_000))
def test_zero_tax_rate_yields_subtotal(subtotal: int) -> None:
    assert calculate_total_cents(subtotal, tax_rate_basis_points=0) == subtotal
```

### Test Principles

- **Snapshot external data** into `tests/fixtures/`. Never hit real APIs in tests. Use `respx` or `httpx`'s `MockTransport` to intercept HTTP.
- **Test transforms thoroughly** — they're pure, easy to cover, and the highest-value tests because they encode business rules.
- **Test Pydantic models** against both valid and invalid payloads. The `ValidationError` path matters as much as the happy path.
- **Name tests as sentences.** `def test_build_order_handles_missing_tax(...)`. The test name is the spec.
- **One assertion per concept.** Multiple `assert` lines are fine; multiple unrelated behaviours in one test aren't.
- **Coverage target: 90%+ on `transforms.py`, `etl/`, and `db/queries.py`.** Lower on glue code (route handlers, CLI commands) where integration tests cover more.

### Coverage

```bash
uv run coverage run -m pytest
uv run coverage report --show-missing --fail-under=85
uv run coverage html   # browse htmlcov/index.html
```

Coverage is configured in `pyproject.toml` (see Package Configuration) with
branch coverage enabled and sensible exclusions for `TYPE_CHECKING` blocks,
`NotImplementedError`, and `Protocol` ellipsis bodies.

---

## Pre-commit

Catches the same things at commit time as in CI, so devs don't push code that
will fail the build.

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.7.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/RobertCraigie/pyright-python
    rev: v1.1.380
    hooks:
      - id: pyright

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-added-large-files
        args: [--maxkb=500]
```

```bash
uv run pre-commit install         # one-time setup
uv run pre-commit run --all-files # run against the whole repo
```

---

## Design Principles

### 1. Types First, Code Second

Define your domain types — `dataclass`es, `NewType`s, `Protocol`s — before
writing any logic. Let pyright guide the implementation. The type system is
your first design pass.

### 2. Validate at Boundaries, Trust Internally

Pydantic guards every entry point: HTTP requests, API responses, environment
variables, file reads, MCP tool inputs. Once data has been validated and
turned into a domain object, trust the types. No defensive `isinstance`
checks deep inside business logic.

### 3. Pure Core, Effectful Shell

Keep business logic (transforms, calculations, validation) as pure
functions. Push I/O (HTTP, database, logging, filesystem) to the edges.
This makes the core trivially testable — no mocks, no async setup, just
input → output.

### 4. Fail Loudly, Recover Gracefully

Throw meaningful exceptions with structured context. Catch them at the
appropriate level (route handler, pipeline orchestrator, CLI top-level).
Use `raise ... from exc` to preserve traceback chains. Never `except:` or
`except Exception: pass`.

### 5. Prefer Composition Over Inheritance

Use `Protocol` for interfaces, plain functions for behaviour, and dataclasses
for data. Inheritance is fine for genuine "is-a" relationships (custom
exception hierarchy, SQLAlchemy `Base` subclasses); it's the wrong tool for
sharing implementation between unrelated classes — use a helper function or
a mixin instead.

### 6. Minimise Dependencies

Every dependency is a maintenance burden, a supply-chain risk, and a slower
install. Prefer the standard library (`pathlib`, `dataclasses`, `itertools`,
`functools`, `contextlib`, `collections`) over reaching for a package. Use
third-party libraries for genuine complexity (Pydantic, SQLAlchemy, FastAPI,
Polars), not for things you can write in 10 lines.

### 7. Single Responsibility Modules

One module, one purpose. `payments_api.py` talks to the payments API. `transforms.py`
transforms data. `pipeline.py` orchestrates. If a file is doing two unrelated
things, split it. If two files are always edited together, merge them.

### 8. The Standard Library Is Your Friend

Before adding a dependency, check the stdlib:

| Need | Stdlib answer |
|------|---------------|
| File paths | `pathlib` |
| JSON | `json` |
| Date/time | `datetime` (always timezone-aware: `datetime.now(UTC)`) |
| Functional helpers | `functools`, `itertools` |
| Concurrency primitives | `asyncio`, `concurrent.futures`, `threading` |
| Resource management | `contextlib` |
| Data structures | `collections` (Counter, deque, defaultdict, ChainMap) |
| Subprocess | `subprocess` (with `check=True`, `capture_output=True`) |
| HTTP server (one-off) | `http.server` |
| CLI parsing (tiny scripts) | `argparse` |

Reach outside it when the stdlib answer is genuinely worse, not by default.

---

## References

**Important:** Before setting up project standards, tooling, or writing
application code, read through the documentation linked below. Each link
uses the `defuddle.md` prefix which returns clean, agent-readable markdown.
Read the full documentation — not just the getting started pages — to
understand the conventions, APIs, and patterns available in each tool.

- [Google Python Style Guide](https://defuddle.md/google.github.io/styleguide/pyguide.html)
- [PEP 8 — Style Guide for Python Code](https://defuddle.md/peps.python.org/pep-0008/)
- [PEP 257 — Docstring Conventions](https://defuddle.md/peps.python.org/pep-0257/)
- [PEP 484 — Type Hints](https://defuddle.md/peps.python.org/pep-0484/)
- [PEP 585 — Builtin Generic Types](https://defuddle.md/peps.python.org/pep-0585/)
- [PEP 604 — Union Type Syntax (`X | Y`)](https://defuddle.md/peps.python.org/pep-0604/)
- [PEP 695 — Type Parameter Syntax](https://defuddle.md/peps.python.org/pep-0695/)
- [uv documentation](https://defuddle.md/docs.astral.sh/uv/)
- [ruff documentation](https://defuddle.md/docs.astral.sh/ruff/)
- [pyright documentation](https://defuddle.md/microsoft.github.io/pyright/)
- [Pydantic v2 documentation](https://defuddle.md/docs.pydantic.dev/latest/)
- [pydantic-settings documentation](https://defuddle.md/docs.pydantic.dev/latest/concepts/pydantic_settings/)
- [FastAPI documentation](https://defuddle.md/fastapi.tiangolo.com/)
- [SQLAlchemy 2.0 documentation](https://defuddle.md/docs.sqlalchemy.org/en/20/)
- [Alembic documentation](https://defuddle.md/alembic.sqlalchemy.org/)
- [Polars documentation](https://defuddle.md/docs.pola.rs/)
- [DuckDB Python API](https://defuddle.md/duckdb.org/docs/api/python/overview)
- [structlog documentation](https://defuddle.md/www.structlog.org/en/stable/)
- [Typer documentation](https://defuddle.md/typer.tiangolo.com/)
- [httpx documentation](https://defuddle.md/www.python-httpx.org/)
- [pytest documentation](https://defuddle.md/docs.pytest.org/en/stable/)
- [pytest-asyncio documentation](https://defuddle.md/pytest-asyncio.readthedocs.io/)
- [Hypothesis documentation](https://defuddle.md/hypothesis.readthedocs.io/)
- [pre-commit documentation](https://defuddle.md/pre-commit.com/)
