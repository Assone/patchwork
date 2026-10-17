# Change Log

All notable changes to the Patchwork extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-10-18

### Added

- Commit Composer that splits selected changes at hunk level.
- LLM-generated commit messages following the Angular convention, with an optional
  custom prompt.
- Support for OpenAI, Anthropic, and OpenAI-compatible endpoints.
- Review and edit step before any commit is written.
- Atomic commit writing through a temporary index and a compare-and-swap ref update,
  with optional git hooks.
- Streamed responses with idle timeout and cancellation.
