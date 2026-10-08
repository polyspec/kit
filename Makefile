# The kit repository: its own tests and the shared targets of scripts/kit/kit.mk.
include scripts/kit/kit.mk

.DEFAULT_GOAL := kit-test

.PHONY: kit-fixture-record
kit-fixture-record: ## Write the review record of tests/kit/fixture with the stub registries
	node tests/kit/record-fixture.mjs
