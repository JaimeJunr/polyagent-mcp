# Evidence and limitations

**Reduced Claude Code subscription usage has not been demonstrated.** Existing local studies
measure tool adoption and worker correctness/latency, not an end-to-end comparison with and
without Polyagent. Returned characters and API-equivalent dollar estimates do not establish
subscription quota savings. Cross-model review through `fan_out` is a separate capability;
its quality benefit also needs a controlled comparison.

A [controlled local pilot](../research/2026-11-15-piloto-controlado.md) found lower reported Claude
API-equivalent cost when implementation was delegated before exploration (two repetitions per
task). Making Polyagent available alone increased cost in that sample. These results support
selective delegation; they do not establish subscription quota savings or generalize to long sessions.

See the [evidence assessment and evaluation protocol](../research/2026-11-15-evidencia-economia-cota.md)
for supporting artifacts, limitations, and the criteria for making stronger claims.

