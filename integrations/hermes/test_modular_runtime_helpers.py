import unittest

from doctor_modular import (
    materialize_split_turn_context,
    split_runtime_helpers_contract,
)
from test_doctor import TURN_CONTEXT_PATCHED


TURN_CONTEXT_PUBLISH = TURN_CONTEXT_PATCHED.replace(
    "set_runtime_main(agent.provider, agent.model)", "_publish_runtime_main(agent)"
) + '''

def _publish_runtime_main(agent):
    from agent.auxiliary_client import set_runtime_main
    set_runtime_main({"model": agent.model, "provider": agent.provider})
'''

RUNTIME_HELPERS_SPLIT = '''
def try_recover_primary_transport(agent, api_error, *, retry_count, max_retries):
    if getattr(agent, "_transient_route_activated", False):
        return False
    return True

def restore_primary_runtime(agent):
    transient_route_activated = bool(
        getattr(agent, "_transient_route_activated", False)
    )
    if not agent._fallback_activated and not transient_route_activated:
        return False
    if not transient_route_activated and agent._rate_limited_until:
        return False
    if transient_route_activated:
        blocked = False
    else:
        blocked = primary_reset_gate(agent)
    if blocked:
        return False
    if transient_route_activated:
        agent._config_context_length = getattr(
            agent, "_transient_primary_config_context_length", None
        )
    agent._fallback_activated = False
    agent._transient_route_activated = False
    agent._transient_primary_config_context_length = None
    return True

def _finish_switch(agent, old_norm, new_norm, *, prune_fallback_chain=True):
    fallback_chain = list(agent._fallback_chain)
    if prune_fallback_chain and old_norm != new_norm:
        fallback_chain = []
    agent._fallback_chain = fallback_chain

def _persist_switch_billing_route(agent):
    agent._session_db.update_session_billing_route(agent.session_id)

def switch_model(
    agent, new_model, new_provider, api_key='', base_url='', api_mode='',
    capabilities=None, *, persist_primary=True, prune_fallback_chain=True,
):
    snapshot = {"_config_context_length": agent._config_context_length}
    if not persist_primary:
        agent._transient_route_activated = True
        agent._transient_primary_config_context_length = snapshot.get(
            "_config_context_length"
        )
        agent._fallback_activated = False
        return
    agent._transient_route_activated = False
    agent._transient_primary_config_context_length = None
    agent._primary_runtime = build_primary_runtime(agent)
    _finish_switch(
        agent, "old", "new", prune_fallback_chain=prune_fallback_chain
    )
    _persist_switch_billing_route(agent)
'''


class ModularRuntimeHelpersTest(unittest.TestCase):
    def test_prompt_snapshot_preparation_is_exact_and_not_an_extra_route(self):
        updated = RUNTIME_HELPERS_SPLIT.replace(
            '    if not persist_primary:\n',
            '    if not persist_primary:\n'
            '        from agent.model_routing import snapshot_prompt_state\n'
            '        transient_prompt_state = snapshot_prompt_state(agent)\n'
            '    if not persist_primary:\n'
            '        agent._transient_primary_prompt_state = transient_prompt_state\n',
        )
        self.assertTrue(split_runtime_helpers_contract(updated))
        for old, new in (
            ("from agent.model_routing", "from agent.other_routing"),
            ("snapshot_prompt_state(agent)", "snapshot_prompt_state(other_agent)"),
            ("agent._transient_primary_prompt_state = transient_prompt_state",
             "agent._transient_primary_prompt_state = None"),
            ("transient_prompt_state = snapshot_prompt_state(agent)", "return"),
        ):
            with self.subTest(change=old):
                self.assertFalse(split_runtime_helpers_contract(updated.replace(old, new, 1)))

    def test_publish_wrapper_materializes_only_when_it_calls_runtime_main(self):
        materialized = materialize_split_turn_context(TURN_CONTEXT_PUBLISH)
        self.assertTrue(materialized.detected)
        self.assertTrue(materialized.valid)
        self.assertIn("set_runtime_main(agent)", materialized.source)

        wrong = TURN_CONTEXT_PUBLISH.replace(
            "from agent.auxiliary_client import set_runtime_main",
            "from agent.auxiliary_client import unrelated",
        )
        self.assertFalse(materialize_split_turn_context(wrong).valid)

        dead = TURN_CONTEXT_PUBLISH.replace(
            '    set_runtime_main({"model": agent.model, "provider": agent.provider})\n',
            '    if False:\n'
            '        set_runtime_main({"model": agent.model, "provider": agent.provider})\n',
        )
        self.assertFalse(materialize_split_turn_context(dead).valid)

    def test_refactored_runtime_helper_contract_is_fail_closed(self):
        self.assertTrue(split_runtime_helpers_contract(RUNTIME_HELPERS_SPLIT))
        missing_restore = RUNTIME_HELPERS_SPLIT.replace(
            "    agent._transient_route_activated = False\n", "", 1
        )
        self.assertFalse(split_runtime_helpers_contract(missing_restore))
        wrong_prune = RUNTIME_HELPERS_SPLIT.replace(
            "prune_fallback_chain=prune_fallback_chain",
            "prune_fallback_chain=True",
        )
        self.assertFalse(split_runtime_helpers_contract(wrong_prune))

        dead_transient_state = RUNTIME_HELPERS_SPLIT.replace(
            '        agent._transient_route_activated = True\n'
            '        agent._transient_primary_config_context_length = snapshot.get(\n'
            '            "_config_context_length"\n'
            '        )\n'
            '        agent._fallback_activated = False\n',
            '        if False:\n'
            '            agent._transient_route_activated = True\n'
            '            agent._transient_primary_config_context_length = snapshot.get(\n'
            '                "_config_context_length"\n'
            '            )\n'
            '            agent._fallback_activated = False\n',
        )
        self.assertFalse(split_runtime_helpers_contract(dead_transient_state))


if __name__ == "__main__":
    unittest.main()
