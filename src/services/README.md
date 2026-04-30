# Services

Business logic lives here: safety checks, retrieval orchestration, review ingestion, scheduler state, HITL sync, and eval runners.

Services may call adapters. UI components should call services only through route handlers or server actions added in later phases.
