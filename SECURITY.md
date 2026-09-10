# Security

This is a single-user local application, not a hosted multi-user service. The server binds to `127.0.0.1`, checks Host/Origin and cross-site requests, and serves an explicit allowlist of static/media routes. JSON write endpoints reject non-JSON bodies.

API keys are server-side only. On POSIX, secret files are written with mode 0600 in a 0700 directory. This is file permission protection, not encryption; any process running as the same OS user may read them. Keys never belong in Git, browser localStorage, logs or exported worlds/stories. `store: false` controls Responses storage; it does not imply no provider-side processing or exempt a request from OpenAI's data policies.

Downloads use predefined sources or explicitly configured Hugging Face repository IDs and full commit hashes. MLX loading disables remote tokenizer code. RVC conversion uses upstream `weights_only=True`. Do not load untrusted model files or execute untrusted Python environments. Automatic downloads do not mean that a model has a permissive license.

Removal applies only to exact studio-managed model paths. External model paths cannot be deleted through the manager. The installers run subprocesses without a shell. User-configured Python executables are trusted local executable configuration.

If you find a vulnerability, use GitHub's private vulnerability reporting when available. Do not include API keys, user stories or local private paths in public issues. This project does not yet provide multi-user authentication, a public deployment mode, or OS keychain integration.
