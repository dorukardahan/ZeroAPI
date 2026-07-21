# Hermes v0.19 regression fixture

`agent/turn_context.py` is an unmodified fixture from NousResearch/hermes-agent commit `3ef6bbd201263d354fd83ec55b3c306ded2eb72a` (release tag `v2026.7.20`, Hermes v0.19.0).

Source: https://github.com/NousResearch/hermes-agent/blob/3ef6bbd201263d354fd83ec55b3c306ded2eb72a/agent/turn_context.py

SHA-256: `fa273c7496c4e06a8c1834f835acdf8b0b12e7302d9ed9048118f4a3f442178d`

The fixture verifies that runtime planning recognizes the v0.19 turn owner and validates the post-route auxiliary-runtime synchronization even though an earlier synchronization call already exists in the same function.
