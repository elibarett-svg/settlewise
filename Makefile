# Common tasks.  `make help` lists them.
PY ?= backend/.venv/bin/python

.PHONY: help setup api seed test lint mobile ios android traceability check-sources up

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-15s %s\n", $$1, $$2}'

setup: ## Create the Python venv and install the API and the mobile app
	cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
	cd mobile && npm install

api: ## Run the API with demo data and every phase enabled (http://localhost:8000/docs)
	cd backend && SETTLEWISE_SEED_DEMO_DATA=true SETTLEWISE_ENABLED_PHASES='["MVP","Growth","Enterprise"]' .venv/bin/settlewise serve --reload

seed: ## Create the synthetic demo accounts
	cd backend && .venv/bin/settlewise seed

test: ## Run backend tests
	cd backend && .venv/bin/pytest -q

lint: ## Lint the backend and typecheck the app
	cd backend && .venv/bin/ruff check settlewise tests scripts && .venv/bin/ruff format --check settlewise tests scripts
	cd mobile && npx tsc --noEmit

mobile: ## Start Expo (scan the QR code with Expo Go on iPhone or Android)
	cd mobile && npx expo start

ios: ## Build and run on the iOS Simulator (needs Xcode)
	cd mobile && npx expo run:ios

android: ## Build and run on an Android emulator or device (needs Android Studio)
	cd mobile && npx expo run:android

traceability: ## Regenerate docs/TRACEABILITY.md from the plugin registry
	cd backend && .venv/bin/python scripts/traceability.py > ../docs/TRACEABILITY.md

check-sources: ## Check assistant source links (content review)
	cd backend && .venv/bin/python scripts/check_sources.py

up: ## Run PostgreSQL + API in Docker
	docker compose up --build
