.PHONY: install dev-backend dev-frontend test lint build test-browser requirements check-requirements check-repo

install:
	cd backend && uv sync --frozen
	cd frontend && npm ci

dev-backend:
	cd backend && uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

dev-frontend:
	cd frontend && npm run dev

test:
	cd backend && uv run --frozen pytest
	cd frontend && npm run typecheck
	cd frontend && npm run test:unit

lint:
	cd backend && uv run --frozen ruff check .
	cd frontend && npm run lint

build:
	cd frontend && npm run build

# backend/pyproject.toml + backend/uv.lock are the source of truth; these files are generated.
requirements:
	cd backend && uv export --locked --no-dev --no-emit-project --format requirements-txt --output-file requirements.txt > /dev/null
	cd backend && uv export --locked --only-group dev --no-emit-project --format requirements-txt --output-file requirements-dev.txt > /dev/null

# Fails when uv.lock is stale or a requirements file no longer matches it.
check-requirements: requirements
	git diff --exit-code -- backend/requirements.txt backend/requirements-dev.txt

# Fails when Git tracks local data, private material or a key-like value.
check-repo:
	bash scripts/check-tracked-files.sh

# First run: cd frontend && npx playwright install chromium
# Browser tests use a synthetic camera. They do not prove physical camera support.
test-browser:
	cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build
	cd frontend && npm run test:e2e
