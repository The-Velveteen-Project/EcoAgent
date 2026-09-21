# LLM guardrail-fidelity evaluation

Supplementary material for the ALLO systems paper: does the number computed by the simulation
engine survive the language layer unchanged?

| File | Content |
|---|---|
| `llm_fidelity_harness.py` | The test bench. Replays the deployed guardrail system prompt and the simulation data contract against a bench of alert cases and audits every number in each generated explanation. The guardrail strings are transcriptions of `src/application/prompts/buildSystemPrompt.ts` and `src/application/tools/agentTools.ts`. |
| `llm_fidelity_methods.md` | Method: bench construction, extraction rules, error categories and their definitions. |
| `llm_fidelity_cases.csv` | One row per generation, with the full explanation text and the per-category flags, so any error criterion can be re-applied independently. |
| `llm_fidelity_results.json` | Aggregated rates and intervals, run-to-run stability and the tool-failure arm. |

These files were produced outside this repository and are archived here unchanged. The harness
header records the reference calibration in force when it was written; see the paper for the
recalibration that supersedes it.

What is and is not re-runnable from these files: the harness is a library, not a script. It builds
the bench (`build_bench`, `build_failure_bench`), the exact chat turns sent to the model
(`build_system_prompt`, `build_tool_turns`) and the audit (`audit_case`, `audit_failure_case`,
`wilson`). The driver that sent those turns to a model endpoint and wrote the CSV is not part of
it. Re-applying any error criterion to the 596 archived generations in `llm_fidelity_cases.csv`
needs no network and no key; producing new generations needs a driver and an OpenAI-compatible
endpoint of your own.
