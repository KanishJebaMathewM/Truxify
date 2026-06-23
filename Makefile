# Load environment variables from .env
ifneq (,$(wildcard .env))
    include .env
    export
endif

.PHONY: help run-driver run-customer

help:
	@echo "Available commands:"
	@echo "  make run-driver      - Run the driver application with .env configuration"
	@echo "  make run-customer    - Run the customer application with .env configuration"

run-driver:
	cd apps/driver && flutter run \
		--dart-define=TRUXIFY_API_BASE_URL=$(TRUXIFY_API_BASE_URL) \
		--dart-define=SUPABASE_URL=$(SUPABASE_URL) \
		--dart-define=SUPABASE_ANON_KEY=$(SUPABASE_ANON_KEY)

run-customer:
	cd apps/customer && flutter run \
		--dart-define=TRUXIFY_API_BASE_URL=$(TRUXIFY_API_BASE_URL) \
		--dart-define=SUPABASE_URL=$(SUPABASE_URL) \
		--dart-define=SUPABASE_ANON_KEY=$(SUPABASE_ANON_KEY)
