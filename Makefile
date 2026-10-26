.PHONY: install dev-backend dev-frontend test lint build test-browser

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

lint:
	cd backend && uv run --frozen ruff check .
	cd frontend && npm run lint

build:
	cd frontend && npm run build

# First run: cd frontend && npx playwright install chromium
# Browser tests use a synthetic camera. They do not prove physical camera support.
test-browser:
	cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build
	cd frontend && npm run test:e2e
