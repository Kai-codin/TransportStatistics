# Contributing

## Development Setup
1. Fork and clone the repository.
2. Create a virtual environment and install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and adjust values.
4. Run migrations:
   ```bash
   python manage.py migrate
   ```

## Pull Request Guidelines
- Keep changes focused and scoped.
- Add or update tests when behavior changes.
- Run relevant checks before opening a PR.
- Include a clear summary of what changed and why.

## Code Style
- Prefer clear names and small functions.
- Remove commented-out code and stale comments.
- Keep comments for non-obvious behavior only.
- Use project logging instead of ad-hoc `print` in app/runtime code.
