"""Read-only draft inspection and stateless allocation validation."""

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .specification import load_spec, validate_allocations

app = FastAPI(title="VCTR local specification checker", version="0.1.0")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


class Allocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: StrictStr = Field(min_length=1, max_length=100)
    amount_tokens: StrictStr = Field(min_length=1, max_length=11)


class AllocationDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allocations: list[Allocation] = Field(max_length=6)


@app.get("/health")
def health():
    return {"status": "ok", "mode": "local-specification-only", "chain_connected": False}


@app.get("/spec")
def specification():
    spec = load_spec()
    return {"specification": spec, "validation": validate_allocations(spec["allocations"])}


@app.post("/allocations/validate")
def check_allocations(draft: AllocationDraft):
    return validate_allocations([row.model_dump() for row in draft.allocations])
